/**
 * NFC名刺（カード）取得API
 * 外部iframeから呼び出されるエンドポイント
 * 
 * GET /api/card/get?code=XXX
 * - 未ログイン: ログインページへリダイレクト（ログイン後に自動取得）
 * - ログイン済み: カードを保存して完了ページへリダイレクト
 */

import { Request, Response } from "express";
import { getCardByCode, addUserCard, incrementCardScans, incrementCardSaves, hasUserCard } from "../db";
import { sdk } from "../_core/sdk";
import type { User } from "../../drizzle/schema";

// リクエストからユーザーを取得（エラーを投げずにnullを返す）
async function getUserFromRequest(req: Request): Promise<User | null> {
  try {
    return await sdk.authenticateRequest(req);
  } catch {
    return null;
  }
}

// カード取得エンドポイント
export async function handleCardAcquire(req: Request, res: Response) {
  const { code, method = "nfc_scan" } = req.query;
  
  if (!code || typeof code !== "string") {
    return res.redirect("/cards?error=invalid_code");
  }
  
  try {
    // カードを取得
    const card = await getCardByCode(code);
    if (!card) {
      return res.redirect("/cards?error=card_not_found");
    }
    
    // スキャン回数をインクリメント
    await incrementCardScans(card.id);
    
    // ユーザーがログインしているか確認
    const user = await getUserFromRequest(req);
    
    if (!user) {
      // 未ログイン: ログインページへリダイレクト（カードコードをセッションに保存）
      const loginUrl = process.env.VITE_OAUTH_PORTAL_URL || "https://login.manus.im";
      const appId = process.env.VITE_APP_ID;
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const callbackUrl = `${origin}/api/card/callback?code=${code}&method=${method}`;
      
      // ログイン後にカード取得ページにリダイレクト
      return res.redirect(`${loginUrl}?app_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}`);
    }
    
    // ログイン済み: カードを保存
    const alreadyHas = await hasUserCard(user.id, card.id);
    
    if (alreadyHas) {
      // 既に持っている場合は詳細ページへ
      return res.redirect(`/cards/${card.id}?already_owned=true`);
    }
    
    // カードを追加
    const validMethods = ["nfc_scan", "qr_scan", "link", "manual"] as const;
    const acquireMethod = validMethods.includes(method as any) ? (method as typeof validMethods[number]) : "nfc_scan";
    
    await addUserCard({
      userId: user.id,
      cardId: card.id,
      acquiredMethod: acquireMethod,
    });
    
    // 保存回数をインクリメント
    await incrementCardSaves(card.id);
    
    // 完了ページへリダイレクト
    return res.redirect(`/cards/${card.id}?acquired=true`);
    
  } catch (error) {
    console.error("[Card API] Error:", error);
    return res.redirect("/cards?error=server_error");
  }
}

// ログイン後のコールバック
export async function handleCardCallback(req: Request, res: Response) {
  const { code, method = "nfc_scan" } = req.query;
  
  if (!code || typeof code !== "string") {
    return res.redirect("/cards?error=invalid_code");
  }
  
  // ユーザーがログインしているか確認
  const user = await getUserFromRequest(req);
  
  if (!user) {
    // まだログインしていない場合は再度リダイレクト
    return res.redirect(`/api/card/get?code=${code}&method=${method}`);
  }
  
  try {
    const card = await getCardByCode(code);
    if (!card) {
      return res.redirect("/cards?error=card_not_found");
    }
    
    // 既に持っているか確認
    const alreadyHas = await hasUserCard(user.id, card.id);
    
    if (alreadyHas) {
      return res.redirect(`/cards/${card.id}?already_owned=true`);
    }
    
    // カードを追加
    const validMethods = ["nfc_scan", "qr_scan", "link", "manual"] as const;
    const acquireMethod = validMethods.includes(method as any) ? (method as typeof validMethods[number]) : "nfc_scan";
    
    await addUserCard({
      userId: user.id,
      cardId: card.id,
      acquiredMethod: acquireMethod,
    });
    
    // 保存回数をインクリメント
    await incrementCardSaves(card.id);
    
    // 完了ページへリダイレクト
    return res.redirect(`/cards/${card.id}?acquired=true`);
    
  } catch (error) {
    console.error("[Card Callback] Error:", error);
    return res.redirect("/cards?error=server_error");
  }
}

// カード情報をJSON形式で取得（iframe内での表示用）
export async function handleCardInfo(req: Request, res: Response) {
  const { code } = req.query;
  
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "invalid_code" });
  }
  
  try {
    const card = await getCardByCode(code);
    if (!card) {
      return res.status(404).json({ error: "card_not_found" });
    }
    
    // 公開情報のみ返す
    return res.json({
      id: card.id,
      code: card.code,
      cardType: card.cardType,
      title: card.title,
      subtitle: card.subtitle,
      description: card.description,
      imageUrl: card.imageUrl,
      thumbnailUrl: card.thumbnailUrl,
      contactInfo: card.contactInfo,
      businessInfo: card.businessInfo,
      customFields: card.customFields,
      totalScans: card.totalScans,
      totalSaves: card.totalSaves,
    });
    
  } catch (error) {
    console.error("[Card Info] Error:", error);
    return res.status(500).json({ error: "server_error" });
  }
}

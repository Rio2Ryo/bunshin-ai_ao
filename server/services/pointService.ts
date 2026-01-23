import { getDb } from "../db";
import { 
  userPoints, 
  pointTransactions, 
  pointSettings, 
  redeemableProducts,
  pointRedemptions 
} from "../../drizzle/schema";
import { eq, and, sql, desc, lte } from "drizzle-orm";

// ポイント付与アクションの定義
export const POINT_ACTIONS = {
  // 診断系（中程度の労力）
  BIG_FIVE_COMPLETE: { type: "big_five_complete", name: "ビッグファイブ診断完了", category: "診断", difficulty: "medium", defaultPoints: 10 },
  MBTI_COMPLETE: { type: "mbti_complete", name: "MBTI診断完了", category: "診断", difficulty: "medium", defaultPoints: 10 },
  
  // シナリオ回答系（軽い労力）
  SCENARIO_ANSWER: { type: "scenario_answer", name: "価値観シナリオ回答", category: "評価", difficulty: "easy", defaultPoints: 3 },
  
  // 評価系（軽い労力）
  FRIEND_PREDICTION: { type: "friend_prediction", name: "友達の予測評価", category: "評価", difficulty: "easy", defaultPoints: 2 },
  WAVEFORM_UPDATE: { type: "waveform_update", name: "波形更新", category: "評価", difficulty: "easy", defaultPoints: 1 },
  
  // 対話系（中程度の労力）
  CHAT_SESSION: { type: "chat_session", name: "分身AIとのチャット", category: "対話", difficulty: "medium", defaultPoints: 5 },
  MATCHING_COMPLETE: { type: "matching_complete", name: "マッチング完了", category: "対話", difficulty: "hard", defaultPoints: 15 },
  
  // プロフィール系（軽い労力）
  PROFILE_UPDATE: { type: "profile_update", name: "プロフィール更新", category: "プロフィール", difficulty: "easy", defaultPoints: 2 },
  TWIN_CREATE: { type: "twin_create", name: "分身AI作成", category: "プロフィール", difficulty: "medium", defaultPoints: 20 },
  
  // ソーシャル系（軽い労力）
  FRIEND_ADD: { type: "friend_add", name: "友達追加", category: "ソーシャル", difficulty: "easy", defaultPoints: 5 },
  
  // 特別ボーナス
  DAILY_LOGIN: { type: "daily_login", name: "デイリーログイン", category: "ボーナス", difficulty: "easy", defaultPoints: 1 },
  FIRST_TIME_BONUS: { type: "first_time_bonus", name: "初回登録ボーナス", category: "ボーナス", difficulty: "easy", defaultPoints: 100 },
} as const;

export type PointActionType = keyof typeof POINT_ACTIONS;

/**
 * ポイント設定を初期化（デフォルト値を挿入）
 */
export async function initializePointSettings(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (const action of Object.values(POINT_ACTIONS)) {
    try {
      await db.insert(pointSettings).values({
        actionType: action.type,
        actionName: action.name,
        actionDescription: `${action.name}を完了するとポイントが付与されます`,
        points: action.defaultPoints,
        category: action.category,
        difficulty: action.difficulty as "easy" | "medium" | "hard",
        isActive: 1,
      }).onDuplicateKeyUpdate({
        set: {
          actionName: action.name,
          category: action.category,
          difficulty: action.difficulty as "easy" | "medium" | "hard",
        }
      });
    } catch (e) {
      // Already exists, skip
    }
  }
}

/**
 * アクションに対するポイント数を取得
 */
export async function getPointsForAction(actionType: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const setting = await db
    .select()
    .from(pointSettings)
    .where(and(
      eq(pointSettings.actionType, actionType),
      eq(pointSettings.isActive, 1)
    ))
    .limit(1);
  
  if (setting.length === 0) {
    // デフォルト値を返す
    const defaultAction = Object.values(POINT_ACTIONS).find(a => a.type === actionType);
    return defaultAction?.defaultPoints ?? 1;
  }
  
  return setting[0].points;
}

/**
 * ユーザーのポイント残高を取得（なければ作成）
 */
export async function getUserPoints(userId: number): Promise<typeof userPoints.$inferSelect> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await db
    .select()
    .from(userPoints)
    .where(eq(userPoints.userId, userId))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0];
  }
  
  // 新規作成
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  
  await db.insert(userPoints).values({
    userId,
    balance: 0,
    totalEarned: 0,
    totalSpent: 0,
    totalExpired: 0,
    lastActivityAt: new Date(),
    expiresAt: oneYearFromNow,
  });
  
  const created = await db
    .select()
    .from(userPoints)
    .where(eq(userPoints.userId, userId))
    .limit(1);
  
  return created[0];
}

/**
 * ポイントを付与
 */
export async function awardPoints(
  userId: number,
  actionType: string,
  referenceId?: string,
  description?: string
): Promise<{ success: boolean; pointsAwarded: number; newBalance: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // ポイント数を取得
  const points = await getPointsForAction(actionType);
  
  // 現在の残高を取得
  const userPoint = await getUserPoints(userId);
  const newBalance = userPoint.balance + points;
  
  // 有効期限を更新（最終活動日から1年）
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  
  // ユーザーポイントを更新
  await db
    .update(userPoints)
    .set({
      balance: newBalance,
      totalEarned: userPoint.totalEarned + points,
      lastActivityAt: new Date(),
      expiresAt: oneYearFromNow,
    })
    .where(eq(userPoints.userId, userId));
  
  // 取引履歴を記録
  const actionName = Object.values(POINT_ACTIONS).find(a => a.type === actionType)?.name ?? actionType;
  await db.insert(pointTransactions).values({
    userId,
    type: "earn",
    amount: points,
    balanceAfter: newBalance,
    actionType,
    referenceId,
    description: description ?? `${actionName}で${points}ポイント獲得`,
  });
  
  return {
    success: true,
    pointsAwarded: points,
    newBalance,
  };
}

/**
 * ポイントを消費
 */
export async function spendPoints(
  userId: number,
  amount: number,
  referenceId?: string,
  description?: string
): Promise<{ success: boolean; error?: string; newBalance?: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 現在の残高を取得
  const userPoint = await getUserPoints(userId);
  
  // 残高チェック
  if (userPoint.balance < amount) {
    return {
      success: false,
      error: `ポイントが不足しています（残高: ${userPoint.balance}pt、必要: ${amount}pt）`,
    };
  }
  
  const newBalance = userPoint.balance - amount;
  
  // 有効期限を更新（最終活動日から1年）
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  
  // ユーザーポイントを更新
  await db
    .update(userPoints)
    .set({
      balance: newBalance,
      totalSpent: userPoint.totalSpent + amount,
      lastActivityAt: new Date(),
      expiresAt: oneYearFromNow,
    })
    .where(eq(userPoints.userId, userId));
  
  // 取引履歴を記録
  await db.insert(pointTransactions).values({
    userId,
    type: "spend",
    amount,
    balanceAfter: newBalance,
    referenceId,
    description: description ?? `${amount}ポイント使用`,
  });
  
  return {
    success: true,
    newBalance,
  };
}

/**
 * ポイント取引履歴を取得
 */
export async function getPointTransactions(
  userId: number,
  limit: number = 50
): Promise<typeof pointTransactions.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return db
    .select()
    .from(pointTransactions)
    .where(eq(pointTransactions.userId, userId))
    .orderBy(desc(pointTransactions.createdAt))
    .limit(limit);
}

/**
 * 期限切れポイントを失効させる
 */
export async function expirePoints(): Promise<{ usersAffected: number; totalExpired: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 期限切れのユーザーを取得
  const expiredUsers = await db
    .select()
    .from(userPoints)
    .where(and(
      lte(userPoints.expiresAt, new Date()),
      sql`${userPoints.balance} > 0`
    ));
  
  let totalExpired = 0;
  
  for (const user of expiredUsers) {
    const expiredAmount = user.balance;
    totalExpired += expiredAmount;
    
    // ポイントを失効
    await db
      .update(userPoints)
      .set({
        balance: 0,
        totalExpired: user.totalExpired + expiredAmount,
      })
      .where(eq(userPoints.userId, user.userId));
    
    // 取引履歴を記録
    await db.insert(pointTransactions).values({
      userId: user.userId,
      type: "expire",
      amount: expiredAmount,
      balanceAfter: 0,
      description: `${expiredAmount}ポイントが有効期限切れで失効しました`,
    });
  }
  
  return {
    usersAffected: expiredUsers.length,
    totalExpired,
  };
}

/**
 * ポイント設定を取得
 */
export async function getAllPointSettings(): Promise<typeof pointSettings.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(pointSettings);
}

/**
 * ポイント設定を更新
 */
export async function updatePointSetting(
  actionType: string,
  points: number,
  isActive?: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Partial<typeof pointSettings.$inferInsert> = { points };
  if (isActive !== undefined) {
    updateData.isActive = isActive ? 1 : 0;
  }
  
  await db
    .update(pointSettings)
    .set(updateData)
    .where(eq(pointSettings.actionType, actionType));
}

/**
 * 交換可能な製品一覧を取得
 */
export async function getRedeemableProducts(): Promise<typeof redeemableProducts.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return db
    .select()
    .from(redeemableProducts)
    .where(eq(redeemableProducts.isActive, 1))
    .orderBy(redeemableProducts.sortOrder);
}

/**
 * 製品をポイントで交換
 */
export async function redeemProduct(
  userId: number,
  productId: number,
  shippingInfo?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    notes?: string;
  }
): Promise<{ success: boolean; error?: string; redemptionId?: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 製品を取得
  const product = await db
    .select()
    .from(redeemableProducts)
    .where(and(
      eq(redeemableProducts.id, productId),
      eq(redeemableProducts.isActive, 1)
    ))
    .limit(1);
  
  if (product.length === 0) {
    return { success: false, error: "製品が見つかりません" };
  }
  
  const productData = product[0];
  
  // 在庫チェック
  if (productData.stock !== null && productData.stock <= 0) {
    return { success: false, error: "在庫切れです" };
  }
  
  // ポイントを消費
  const spendResult = await spendPoints(
    userId,
    productData.pointsCost,
    `product_${productId}`,
    `${productData.name}と交換`
  );
  
  if (!spendResult.success) {
    return { success: false, error: spendResult.error };
  }
  
  // 在庫を減らす
  if (productData.stock !== null) {
    await db
      .update(redeemableProducts)
      .set({ stock: productData.stock - 1 })
      .where(eq(redeemableProducts.id, productId));
  }
  
  // 交換履歴を記録
  const result = await db.insert(pointRedemptions).values({
    userId,
    productId,
    pointsUsed: productData.pointsCost,
    status: "pending",
    shippingInfo,
  });
  
  return {
    success: true,
    redemptionId: Number(result[0].insertId),
  };
}

/**
 * ユーザーの交換履歴を取得
 */
export async function getUserRedemptions(
  userId: number
): Promise<(typeof pointRedemptions.$inferSelect & { productName: string })[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const redemptions = await db
    .select({
      redemption: pointRedemptions,
      productName: redeemableProducts.name,
    })
    .from(pointRedemptions)
    .leftJoin(redeemableProducts, eq(pointRedemptions.productId, redeemableProducts.id))
    .where(eq(pointRedemptions.userId, userId))
    .orderBy(desc(pointRedemptions.createdAt));
  
  return redemptions.map(r => ({
    ...r.redemption,
    productName: r.productName ?? "不明な製品",
  }));
}

/**
 * 初期製品データを挿入
 */
export async function initializeProducts(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const defaultProducts = [
    {
      name: "カタオモイカード",
      description: "名刺型デジタル名刺サービス「Kataomoi（片思い）」のカード。NFCタッチで瞬時にプロフィール共有が可能。",
      pointsCost: 5500,
      priceYen: 5500,
      category: "デジタル名刺",
      sortOrder: 1,
    },
  ];
  
  for (const product of defaultProducts) {
    try {
      await db.insert(redeemableProducts).values({
        ...product,
        isActive: 1,
      }).onDuplicateKeyUpdate({
        set: {
          description: product.description,
          pointsCost: product.pointsCost,
        }
      });
    } catch (e) {
      // Already exists, skip
    }
  }
}

import type { Env } from "./trpc";

/** Send Slack webhook notification */
export async function sendSlackNotification(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch { return false; }
}

/** Send LINE notification to connected user */
export async function sendLineNotification(db: D1Database, userId: number, message: string, accessToken: string): Promise<boolean> {
  try {
    const conn = await db.prepare(
      `SELECT lineUserId FROM line_connections WHERE userId=? AND status='active'`
    ).bind(userId).first<any>();
    if (!conn?.lineUserId) return false;

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: conn.lineUserId,
        messages: [{ type: "text", text: message }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

/** Create in-app notification */
export async function createNotification(db: D1Database, userId: number, type: string, title: string, message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    await db.prepare(`INSERT INTO notifications (userId, type, title, message, data) VALUES (?,?,?,?,?)`).bind(userId, type, title, message, data ? JSON.stringify(data) : null).run();
  } catch { /* ignore notification errors */ }
}

/** Send WebPush notification to all subscriptions for a user */
export async function sendWebPush(
  db: D1Database,
  userId: number,
  payload: { title: string; body: string; url?: string; icon?: string },
  env: Env,
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  try {
    const subs = await db.prepare(`SELECT * FROM push_subscriptions WHERE userId=?`).bind(userId).all<any>();
    for (const sub of subs.results ?? []) {
      try {
        // Use the Web Push protocol via fetch (simplified — no external library)
        // The actual push sending requires JWT signing with VAPID keys.
        // For CF Workers, we use a self-signed JWT approach.
        const pushPayload = JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: payload.url || "/",
          icon: payload.icon || "/icons/icon-192x192.png",
        });

        // Build VAPID JWT
        const now = Math.floor(Date.now() / 1000);
        const audience = new URL(sub.endpoint).origin;

        const header = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        const claims = btoa(JSON.stringify({
          aud: audience,
          exp: now + 3600,
          sub: `mailto:noreply@bunshin-ai.pages.dev`,
        })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

        // Import the VAPID private key for signing
        const privateKeyRaw = Uint8Array.from(atob(env.VAPID_PRIVATE_KEY.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
        const privateKey = await crypto.subtle.importKey(
          "pkcs8",
          privateKeyRaw,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"]
        ).catch(() => null);

        if (!privateKey) continue;

        const signInput = new TextEncoder().encode(`${header}.${claims}`);
        const signature = await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          privateKey,
          signInput
        );
        const sig = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signature)))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        const jwt = `${header}.${claims}.${sig}`;

        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            "TTL": "3600",
            "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
          },
          body: new TextEncoder().encode(pushPayload),
        });

        // 404 or 410 = subscription expired, clean up
        if (res.status === 404 || res.status === 410) {
          await db.prepare(`DELETE FROM push_subscriptions WHERE id=?`).bind(sub.id).run();
        }
      } catch { /* individual push failure */ }
    }
  } catch { /* ignore push errors */ }
}

/** Notify friend about matching room invitation */
export async function notifyMatchingInvite(
  db: D1Database,
  friendId: number,
  initiatorName: string,
  sessionTheme: string,
  sessionId: number,
  env: Env,
): Promise<void> {
  const settings = await db.prepare(`SELECT * FROM notification_settings WHERE userId=?`).bind(friendId).first<any>();
  const message = `【分身AI】${initiatorName}さんがマッチング対話にあなたを招待しました\nテーマ: ${sessionTheme}\nリアルタイムで観戦できます`;

  if (settings?.slackWebhookUrl) {
    await sendSlackNotification(settings.slackWebhookUrl, message);
  }
  if (settings?.lineNotify && env.LINE_CHANNEL_ACCESS_TOKEN) {
    await sendLineNotification(db, friendId, message, env.LINE_CHANNEL_ACCESS_TOKEN);
  }
  // In-app notification
  await createNotification(db, friendId, 'matching_invite', 'マッチング招待', `${initiatorName}さんからの招待: ${sessionTheme}`, { link: `/matching/${sessionId}` });
  // WebPush
  await sendWebPush(db, friendId, { title: "マッチング招待", body: `${initiatorName}さんからの招待: ${sessionTheme}`, url: `/matching/${sessionId}` }, env);
}

/** Notify user about matching completion */
export async function notifyMatchingComplete(
  db: D1Database,
  userId: number,
  sessionTheme: string,
  score: number,
  env: Env,
): Promise<void> {
  const settings = await db.prepare(`SELECT * FROM notification_settings WHERE userId=?`).bind(userId).first<any>();
  if (!settings || !settings.matchingComplete) return;

  const message = `【分身AI】マッチング対話が完了しました\nテーマ: ${sessionTheme}\n相性スコア: ${score}%\nhttps://bunshin-ai.pages.dev/matching`;

  if (settings.slackWebhookUrl) {
    await sendSlackNotification(settings.slackWebhookUrl, message);
  }
  if (settings.lineNotify && env.LINE_CHANNEL_ACCESS_TOKEN) {
    await sendLineNotification(db, userId, message, env.LINE_CHANNEL_ACCESS_TOKEN);
  }
  // In-app notification
  await createNotification(db, userId, 'matching_complete', 'マッチング完了', `テーマ「${sessionTheme}」のスコア: ${score}%`, { link: '/matching' });
  // WebPush
  await sendWebPush(db, userId, { title: "マッチング完了", body: `テーマ「${sessionTheme}」 スコア: ${score}%`, url: "/matching" }, env);
}

/** Send matching report HTML email to a user via Resend API */
export async function sendMatchingReportEmail(
  db: D1Database,
  userId: number,
  sessionTheme: string,
  score: number,
  reportHtml: string,
  env: Env,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const user = await db.prepare(`SELECT email, name FROM users WHERE id=?`).bind(userId).first<any>();
    if (!user?.email) return false;

    const fromEmail = env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.pages.dev";
    const frontendUrl = env.FRONTEND_URL || "https://bunshin-ai.pages.dev";

    const emailHtml = `
<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px;border-radius:12px 12px 0 0;color:#fff;text-align:center">
  <h1 style="margin:0;font-size:24px">マッチングレポート</h1>
  <p style="margin:8px 0 0;opacity:0.9">テーマ: ${sessionTheme}</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e5e7eb;border-top:0">
  <div style="text-align:center;margin-bottom:20px">
    <span style="font-size:48px;font-weight:bold;color:#6366f1">${score}%</span>
    <p style="color:#6b7280;margin:4px 0 0">相性スコア</p>
  </div>
  <p style="color:#374151">${user.name || "ユーザー"}さん、マッチング対話が完了しました。</p>
  <p style="color:#6b7280;font-size:14px">詳細なレポートを添付しています。</p>
  <div style="text-align:center;margin:24px 0">
    <a href="${frontendUrl}/matching" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">レポートを見る</a>
  </div>
</div>
<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">
  分身AI マッチングレポート | <a href="${frontendUrl}" style="color:#6366f1">bunshin-ai.pages.dev</a>
</div>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `分身AI <${fromEmail}>`,
        to: [user.email],
        subject: `【分身AI】マッチングレポート: ${sessionTheme} (スコア: ${score}%)`,
        html: emailHtml,
        attachments: [{
          filename: `matching-report-${sessionTheme.slice(0, 20)}.html`,
          content: Buffer.from(reportHtml).toString("base64"),
          content_type: "text/html",
        }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

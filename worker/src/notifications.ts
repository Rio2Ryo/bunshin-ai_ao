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
}

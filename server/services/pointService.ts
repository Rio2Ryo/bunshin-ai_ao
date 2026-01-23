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
  // ===== 基本アクション =====
  // 分身AIとの会話（毎回）
  CHAT_MESSAGE: { type: "chat_message", name: "分身AIと会話", category: "対話", difficulty: "easy", defaultPoints: 1 },
  CHAT_SESSION: { type: "chat_session", name: "チャットセッション開始", category: "対話", difficulty: "easy", defaultPoints: 2 },
  
  // プロフィール系
  PROFILE_UPDATE: { type: "profile_update", name: "プロフィール更新", category: "プロフィール", difficulty: "easy", defaultPoints: 5 },
  AVATAR_SET: { type: "avatar_set", name: "アバター設定", category: "プロフィール", difficulty: "easy", defaultPoints: 10 },
  TWIN_CREATE: { type: "twin_create", name: "分身AI作成", category: "プロフィール", difficulty: "medium", defaultPoints: 20 },
  TWIN_UPDATE: { type: "twin_update", name: "分身AI更新", category: "プロフィール", difficulty: "easy", defaultPoints: 3 },
  
  // ===== データ蓄積系 =====
  // ナレッジ（知識）追加
  KNOWLEDGE_ADD: { type: "knowledge_add", name: "ナレッジ追加", category: "データ蓄積", difficulty: "easy", defaultPoints: 2 },
  KNOWLEDGE_BULK: { type: "knowledge_bulk", name: "ナレッジ10件追加", category: "データ蓄積", difficulty: "medium", defaultPoints: 25 },
  
  // ファイルアップロード
  FILE_UPLOAD: { type: "file_upload", name: "ファイルアップロード", category: "データ蓄積", difficulty: "easy", defaultPoints: 3 },
  FILE_UPLOAD_10: { type: "file_upload_10", name: "ファイル10件アップロード", category: "データ蓄積", difficulty: "medium", defaultPoints: 40 },
  
  // ===== 診断系 =====
  BIG_FIVE_COMPLETE: { type: "big_five_complete", name: "ビッグファイブ診断完了", category: "診断", difficulty: "medium", defaultPoints: 10 },
  MBTI_COMPLETE: { type: "mbti_complete", name: "MBTI診断完了", category: "診断", difficulty: "medium", defaultPoints: 10 },
  INTEGRATED_ANALYSIS: { type: "integrated_analysis", name: "統合性格分析完了", category: "診断", difficulty: "hard", defaultPoints: 30 },
  
  // ===== 価値観シナリオ系 =====
  SCENARIO_ANSWER: { type: "scenario_answer", name: "価値観シナリオ回答", category: "評価", difficulty: "easy", defaultPoints: 3 },
  SCENARIO_CATEGORY_COMPLETE: { type: "scenario_category_complete", name: "カテゴリ全問回答", category: "評価", difficulty: "medium", defaultPoints: 20 },
  SCENARIO_ALL_COMPLETE: { type: "scenario_all_complete", name: "全シナリオ回答完了", category: "評価", difficulty: "hard", defaultPoints: 100 },
  WAVEFORM_UPDATE: { type: "waveform_update", name: "波形更新", category: "評価", difficulty: "easy", defaultPoints: 1 },
  
  // ===== ソーシャル系 =====
  FRIEND_ADD: { type: "friend_add", name: "友達追加", category: "ソーシャル", difficulty: "easy", defaultPoints: 5 },
  FRIEND_INVITE_SUCCESS: { type: "friend_invite_success", name: "友達招待成功", category: "ソーシャル", difficulty: "medium", defaultPoints: 50 },
  FRIEND_5_MILESTONE: { type: "friend_5_milestone", name: "友達5人達成", category: "ソーシャル", difficulty: "medium", defaultPoints: 100 },
  FRIEND_10_MILESTONE: { type: "friend_10_milestone", name: "友遤10人達成", category: "ソーシャル", difficulty: "hard", defaultPoints: 200 },
  FRIEND_25_MILESTONE: { type: "friend_25_milestone", name: "友遤25人達成", category: "ソーシャル", difficulty: "hard", defaultPoints: 500 },
  FRIEND_PREDICTION: { type: "friend_prediction", name: "友達の予測評価", category: "ソーシャル", difficulty: "easy", defaultPoints: 3 },
  FRIEND_WAVEFORM_COMPARE: { type: "friend_waveform_compare", name: "友達と波形比較", category: "ソーシャル", difficulty: "easy", defaultPoints: 5 },
  
  // ===== マッチング系 =====
  MATCHING_COMPLETE: { type: "matching_complete", name: "マッチング完了", category: "マッチング", difficulty: "hard", defaultPoints: 15 },
  MATCHING_FIRST: { type: "matching_first", name: "初めてのマッチング", category: "マッチング", difficulty: "medium", defaultPoints: 30 },
  MATCHING_10_MILESTONE: { type: "matching_10_milestone", name: "マッチング10回達成", category: "マッチング", difficulty: "hard", defaultPoints: 100 },
  MATCHING_EXPORT: { type: "matching_export", name: "マッチングレポート出力", category: "マッチング", difficulty: "easy", defaultPoints: 5 },
  
  // ===== 外部連携系 =====
  EXTERNAL_AI_CONNECT: { type: "external_ai_connect", name: "外部AI API接続", category: "外部連携", difficulty: "hard", defaultPoints: 1000 },
  ORCHESTRATION_CREATE: { type: "orchestration_create", name: "オーケストレーション作成", category: "外部連携", difficulty: "hard", defaultPoints: 50 },
  ORCHESTRATION_ROLE_ADD: { type: "orchestration_role_add", name: "ロール追加", category: "外部連携", difficulty: "medium", defaultPoints: 20 },
  
  // ===== 継続利用系 =====
  DAILY_LOGIN: { type: "daily_login", name: "デイリーログイン", category: "継続利用", difficulty: "easy", defaultPoints: 1 },
  LOGIN_STREAK_7: { type: "login_streak_7", name: "7日連続ログイン", category: "継続利用", difficulty: "medium", defaultPoints: 10 },
  LOGIN_STREAK_30: { type: "login_streak_30", name: "30日連続ログイン", category: "継続利用", difficulty: "hard", defaultPoints: 50 },
  LOGIN_STREAK_100: { type: "login_streak_100", name: "100日連続ログイン", category: "継続利用", difficulty: "hard", defaultPoints: 200 },
  MONTHLY_ACTIVE: { type: "monthly_active", name: "月間アクティブボーナス", category: "継続利用", difficulty: "medium", defaultPoints: 100 },
  
  // ===== マイルストーン系 =====
  FIRST_TIME_BONUS: { type: "first_time_bonus", name: "初回登録ボーナス", category: "マイルストーン", difficulty: "easy", defaultPoints: 100 },
  CHAT_100_MILESTONE: { type: "chat_100_milestone", name: "会話100回達成", category: "マイルストーン", difficulty: "medium", defaultPoints: 50 },
  CHAT_500_MILESTONE: { type: "chat_500_milestone", name: "会話500回達成", category: "マイルストーン", difficulty: "hard", defaultPoints: 200 },
  CHAT_1000_MILESTONE: { type: "chat_1000_milestone", name: "会話1000回達成", category: "マイルストーン", difficulty: "hard", defaultPoints: 500 },
  DATA_MASTER: { type: "data_master", name: "データマスター", category: "マイルストーン", difficulty: "hard", defaultPoints: 300 },
  SOCIAL_BUTTERFLY: { type: "social_butterfly", name: "ソーシャルバタフライ", category: "マイルストーン", difficulty: "hard", defaultPoints: 300 },
  
  // ===== 特別イベント =====
  DISCOVERY_PUBLISH: { type: "discovery_publish", name: "分身AIを公開", category: "特別", difficulty: "medium", defaultPoints: 30 },
  DISCOVERY_FEATURED: { type: "discovery_featured", name: "注目の分身AIに選出", category: "特別", difficulty: "hard", defaultPoints: 500 },
  FEEDBACK_SUBMIT: { type: "feedback_submit", name: "フィードバック送信", category: "特別", difficulty: "easy", defaultPoints: 10 },
  BUG_REPORT: { type: "bug_report", name: "バグ報告", category: "特別", difficulty: "medium", defaultPoints: 50 },
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


// ===== クエスト・進捗管理 =====

/**
 * ユーザーのクエスト進捗を取得
 */
export interface QuestProgress {
  actionType: string;
  name: string;
  category: string;
  difficulty: string;
  points: number;
  currentCount: number;
  targetCount: number;
  isCompleted: boolean;
  completedAt?: Date;
}

/**
 * ユーザーの特定アクションの実行回数を取得
 */
export async function getActionCount(userId: number, actionType: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pointTransactions)
    .where(and(
      eq(pointTransactions.userId, userId),
      eq(pointTransactions.actionType, actionType),
      eq(pointTransactions.type, "earn")
    ));
  
  return result[0]?.count ?? 0;
}

/**
 * マイルストーンをチェックして達成していれば自動付与
 */
export async function checkAndAwardMilestones(userId: number): Promise<{
  awarded: { actionType: string; name: string; points: number }[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const awarded: { actionType: string; name: string; points: number }[] = [];
  
  // 会話回数のマイルストーン
  const chatCount = await getActionCount(userId, POINT_ACTIONS.CHAT_MESSAGE.type);
  
  if (chatCount >= 100) {
    const already = await getActionCount(userId, POINT_ACTIONS.CHAT_100_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.CHAT_100_MILESTONE.type, `milestone_chat_100`, "会話100回達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.CHAT_100_MILESTONE.type, name: POINT_ACTIONS.CHAT_100_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  if (chatCount >= 500) {
    const already = await getActionCount(userId, POINT_ACTIONS.CHAT_500_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.CHAT_500_MILESTONE.type, `milestone_chat_500`, "会話500回達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.CHAT_500_MILESTONE.type, name: POINT_ACTIONS.CHAT_500_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  if (chatCount >= 1000) {
    const already = await getActionCount(userId, POINT_ACTIONS.CHAT_1000_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.CHAT_1000_MILESTONE.type, `milestone_chat_1000`, "会話1000回達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.CHAT_1000_MILESTONE.type, name: POINT_ACTIONS.CHAT_1000_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  return { awarded };
}

/**
 * 友達数のマイルストーンをチェック
 */
export async function checkFriendMilestones(userId: number, friendCount: number): Promise<{
  awarded: { actionType: string; name: string; points: number }[];
}> {
  const awarded: { actionType: string; name: string; points: number }[] = [];
  
  if (friendCount >= 5) {
    const already = await getActionCount(userId, POINT_ACTIONS.FRIEND_5_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.FRIEND_5_MILESTONE.type, `milestone_friend_5`, "友達5人達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.FRIEND_5_MILESTONE.type, name: POINT_ACTIONS.FRIEND_5_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  if (friendCount >= 10) {
    const already = await getActionCount(userId, POINT_ACTIONS.FRIEND_10_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.FRIEND_10_MILESTONE.type, `milestone_friend_10`, "友達10人達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.FRIEND_10_MILESTONE.type, name: POINT_ACTIONS.FRIEND_10_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  if (friendCount >= 25) {
    const already = await getActionCount(userId, POINT_ACTIONS.FRIEND_25_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.FRIEND_25_MILESTONE.type, `milestone_friend_25`, "友達25人達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.FRIEND_25_MILESTONE.type, name: POINT_ACTIONS.FRIEND_25_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  return { awarded };
}

/**
 * マッチング回数のマイルストーンをチェック
 */
export async function checkMatchingMilestones(userId: number): Promise<{
  awarded: { actionType: string; name: string; points: number }[];
}> {
  const awarded: { actionType: string; name: string; points: number }[] = [];
  
  const matchingCount = await getActionCount(userId, POINT_ACTIONS.MATCHING_COMPLETE.type);
  
  // 初めてのマッチング
  if (matchingCount === 1) {
    const already = await getActionCount(userId, POINT_ACTIONS.MATCHING_FIRST.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.MATCHING_FIRST.type, `milestone_matching_first`, "初めてのマッチングボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.MATCHING_FIRST.type, name: POINT_ACTIONS.MATCHING_FIRST.name, points: result.pointsAwarded });
      }
    }
  }
  
  // マッチング10回達成
  if (matchingCount >= 10) {
    const already = await getActionCount(userId, POINT_ACTIONS.MATCHING_10_MILESTONE.type);
    if (already === 0) {
      const result = await awardPoints(userId, POINT_ACTIONS.MATCHING_10_MILESTONE.type, `milestone_matching_10`, "マッチング10回達成ボーナス");
      if (result.success) {
        awarded.push({ actionType: POINT_ACTIONS.MATCHING_10_MILESTONE.type, name: POINT_ACTIONS.MATCHING_10_MILESTONE.name, points: result.pointsAwarded });
      }
    }
  }
  
  return { awarded };
}

/**
 * クエスト一覧を取得（カテゴリ別）
 */
export async function getQuestList(userId: number): Promise<{
  categories: {
    name: string;
    quests: {
      actionType: string;
      name: string;
      description: string;
      points: number;
      difficulty: string;
      completedCount: number;
      isRepeatable: boolean;
      isCompleted: boolean;
    }[];
  }[];
  stats: {
    totalCompleted: number;
    totalPoints: number;
  };
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 各アクションの完了回数を取得
  const transactions = await db
    .select({
      actionType: pointTransactions.actionType,
      count: sql<number>`COUNT(*)`,
    })
    .from(pointTransactions)
    .where(and(
      eq(pointTransactions.userId, userId),
      eq(pointTransactions.type, "earn")
    ))
    .groupBy(pointTransactions.actionType);
  
  const completedCounts = new Map(transactions.map(t => [t.actionType, t.count]));
  
  // カテゴリ別にグループ化
  const categoryMap = new Map<string, typeof POINT_ACTIONS[keyof typeof POINT_ACTIONS][]>();
  
  for (const action of Object.values(POINT_ACTIONS)) {
    if (!categoryMap.has(action.category)) {
      categoryMap.set(action.category, []);
    }
    categoryMap.get(action.category)!.push(action);
  }
  
  // 繰り返し可能なアクション
  const repeatableActions = new Set([
    "chat_message", "chat_session", "scenario_answer", "knowledge_add", 
    "file_upload", "friend_prediction", "friend_waveform_compare",
    "matching_complete", "matching_export", "daily_login", "waveform_update"
  ]);
  
  // マイルストーン系は1回のみ
  const milestoneActions = new Set([
    "first_time_bonus", "chat_100_milestone", "chat_500_milestone", "chat_1000_milestone",
    "friend_5_milestone", "friend_10_milestone", "friend_25_milestone",
    "matching_first", "matching_10_milestone", "scenario_all_complete",
    "data_master", "social_butterfly", "discovery_featured",
    "login_streak_7", "login_streak_30", "login_streak_100", "monthly_active"
  ]);
  
  const categories = Array.from(categoryMap.entries()).map(([name, actions]) => ({
    name,
    quests: actions.map(action => {
      const completedCount = completedCounts.get(action.type) ?? 0;
      const isRepeatable = repeatableActions.has(action.type);
      const isMilestone = milestoneActions.has(action.type);
      
      return {
        actionType: action.type,
        name: action.name,
        description: `${action.name}を完了するとポイントが付与されます`,
        points: action.defaultPoints,
        difficulty: action.difficulty,
        completedCount,
        isRepeatable,
        isCompleted: isMilestone ? completedCount > 0 : false,
      };
    }),
  }));
  
  // 統計
  let totalCompleted = 0;
  let totalPoints = 0;
  Array.from(completedCounts.entries()).forEach(([actionType, count]) => {
    totalCompleted += count;
    const action = Object.values(POINT_ACTIONS).find(a => a.type === actionType);
    if (action) {
      totalPoints += action.defaultPoints * count;
    }
  });
  
  return {
    categories,
    stats: {
      totalCompleted,
      totalPoints,
    },
  };
}

/**
 * デイリーログインボーナスをチェック・付与
 */
export async function checkDailyLogin(userId: number): Promise<{
  awarded: boolean;
  points: number;
  streak: number;
  streakBonus?: { actionType: string; name: string; points: number };
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 今日のログインボーナスを既に受け取っているかチェック
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const todayLogin = await db
    .select()
    .from(pointTransactions)
    .where(and(
      eq(pointTransactions.userId, userId),
      eq(pointTransactions.actionType, POINT_ACTIONS.DAILY_LOGIN.type),
      sql`${pointTransactions.createdAt} >= ${today}`,
      sql`${pointTransactions.createdAt} < ${tomorrow}`
    ))
    .limit(1);
  
  if (todayLogin.length > 0) {
    // 既に受け取り済み
    return { awarded: false, points: 0, streak: 0 };
  }
  
  // ログインボーナスを付与
  const result = await awardPoints(userId, POINT_ACTIONS.DAILY_LOGIN.type, `daily_${today.toISOString().split('T')[0]}`, "デイリーログインボーナス");
  
  // 連続ログイン日数を計算
  const recentLogins = await db
    .select()
    .from(pointTransactions)
    .where(and(
      eq(pointTransactions.userId, userId),
      eq(pointTransactions.actionType, POINT_ACTIONS.DAILY_LOGIN.type)
    ))
    .orderBy(desc(pointTransactions.createdAt))
    .limit(100);
  
  let streak = 1;
  let lastDate = today;
  
  for (let i = 1; i < recentLogins.length; i++) {
    const loginDate = new Date(recentLogins[i].createdAt!);
    loginDate.setHours(0, 0, 0, 0);
    
    const expectedDate = new Date(lastDate);
    expectedDate.setDate(expectedDate.getDate() - 1);
    
    if (loginDate.getTime() === expectedDate.getTime()) {
      streak++;
      lastDate = loginDate;
    } else {
      break;
    }
  }
  
  // 連続ログインボーナスをチェック
  let streakBonus: { actionType: string; name: string; points: number } | undefined;
  
  if (streak === 7) {
    const already = await getActionCount(userId, POINT_ACTIONS.LOGIN_STREAK_7.type);
    if (already === 0) {
      const bonusResult = await awardPoints(userId, POINT_ACTIONS.LOGIN_STREAK_7.type, `streak_7`, "7日連続ログインボーナス");
      if (bonusResult.success) {
        streakBonus = { actionType: POINT_ACTIONS.LOGIN_STREAK_7.type, name: POINT_ACTIONS.LOGIN_STREAK_7.name, points: bonusResult.pointsAwarded };
      }
    }
  } else if (streak === 30) {
    const already = await getActionCount(userId, POINT_ACTIONS.LOGIN_STREAK_30.type);
    if (already === 0) {
      const bonusResult = await awardPoints(userId, POINT_ACTIONS.LOGIN_STREAK_30.type, `streak_30`, "30日連続ログインボーナス");
      if (bonusResult.success) {
        streakBonus = { actionType: POINT_ACTIONS.LOGIN_STREAK_30.type, name: POINT_ACTIONS.LOGIN_STREAK_30.name, points: bonusResult.pointsAwarded };
      }
    }
  } else if (streak === 100) {
    const already = await getActionCount(userId, POINT_ACTIONS.LOGIN_STREAK_100.type);
    if (already === 0) {
      const bonusResult = await awardPoints(userId, POINT_ACTIONS.LOGIN_STREAK_100.type, `streak_100`, "100日連続ログインボーナス");
      if (bonusResult.success) {
        streakBonus = { actionType: POINT_ACTIONS.LOGIN_STREAK_100.type, name: POINT_ACTIONS.LOGIN_STREAK_100.name, points: bonusResult.pointsAwarded };
      }
    }
  }
  
  return {
    awarded: result.success,
    points: result.pointsAwarded,
    streak,
    streakBonus,
  };
}

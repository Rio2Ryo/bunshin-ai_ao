import { getDb } from "../db";
import { 
  twinGrowthStatus, 
  twinSkills, 
  twinMilestones, 
  experienceHistory,
  experienceActions,
  skillDefinitions,
  evolutionTypes,
  milestoneDefinitions,
  getRequiredExperience,
  type ExperienceAction,
  type SkillType,
  type EvolutionType,
  type MilestoneType,
  type TwinGrowthStatus,
  type TwinSkill,
  type TwinMilestone,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * 育成ステータスを取得または作成
 */
export async function getOrCreateGrowthStatus(twinId: number, userId: number): Promise<TwinGrowthStatus | null> {
  const db = await getDb();
  if (!db) return null;
  
  const existing = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  
  if (existing.length > 0) {
    return existing[0];
  }
  
  // 新規作成
  await db.insert(twinGrowthStatus).values({
    twinId,
    userId,
    level: 1,
    experience: 0,
    evolutionType: "basic",
    energy: 100,
    fullness: 100,
    mood: 100,
    bond: 0,
    evolutionHistory: [{ type: "basic", evolvedAt: new Date().toISOString(), level: 1 }],
  });
  
  // 初期スキルを付与
  const initialSkills: SkillType[] = ["conversation", "empathy"];
  for (const skillType of initialSkills) {
    await db.insert(twinSkills).values({
      twinId,
      skillType,
      level: 1,
      experience: 0,
    });
  }
  
  const created = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  return created[0] || null;
}

/**
 * 経験値を獲得
 */
export async function gainExperience(
  twinId: number, 
  action: ExperienceAction, 
  metadata?: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return null;
  
  const actionDef = experienceActions[action];
  if (!actionDef) {
    throw new Error(`Unknown action: ${action}`);
  }
  
  const statusArr = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  const status = statusArr[0];
  
  if (!status) {
    throw new Error(`Growth status not found for twin: ${twinId}`);
  }
  
  const expGained = actionDef.exp;
  const newExp = status.experience + expGained;
  
  // 経験値履歴を記録
  await db.insert(experienceHistory).values({
    twinId,
    action,
    experienceGained: expGained,
    description: actionDef.description,
    metadata,
  });
  
  // レベルアップチェック
  const { newLevel, leveledUp } = checkLevelUp(status.level, newExp);
  
  // 統計を更新
  const statsUpdate: Partial<TwinGrowthStatus> = {};
  if (action === "conversation") statsUpdate.totalConversations = status.totalConversations + 1;
  if (action === "imageGeneration") statsUpdate.totalImageGenerations = status.totalImageGenerations + 1;
  if (action === "friendPrediction") statsUpdate.totalFriendPredictions = status.totalFriendPredictions + 1;
  if (action === "scenarioAnswer") statsUpdate.totalScenarioAnswers = status.totalScenarioAnswers + 1;
  if (action === "diagnosticComplete") statsUpdate.totalDiagnosticsCompleted = status.totalDiagnosticsCompleted + 1;
  if (action === "knowledgeAdd") statsUpdate.totalKnowledgeEntries = status.totalKnowledgeEntries + 1;
  
  // ステータス更新
  await db.update(twinGrowthStatus)
    .set({
      experience: newExp,
      level: newLevel,
      lastInteractionAt: new Date(),
      ...statsUpdate,
    })
    .where(eq(twinGrowthStatus.twinId, twinId));
  
  // レベルアップマイルストーンチェック
  if (leveledUp) {
    await checkLevelMilestones(twinId, newLevel);
  }
  
  // 統計マイルストーンチェック
  await checkStatsMilestones(twinId, {
    totalConversations: statsUpdate.totalConversations ?? status.totalConversations,
    totalImageGenerations: statsUpdate.totalImageGenerations ?? status.totalImageGenerations,
  });
  
  // 進化チェック
  const evolutionResult = await checkEvolution(twinId);
  
  // スキル経験値も付与
  await gainSkillExperience(twinId, action);
  
  return {
    expGained,
    newExp,
    newLevel,
    leveledUp,
    evolution: evolutionResult,
  };
}

/**
 * レベルアップをチェック
 */
function checkLevelUp(currentLevel: number, totalExp: number): { newLevel: number; leveledUp: boolean } {
  let newLevel = currentLevel;
  
  while (newLevel < 100) {
    const requiredExp = getRequiredExperience(newLevel + 1);
    if (totalExp >= requiredExp) {
      newLevel++;
    } else {
      break;
    }
  }
  
  return {
    newLevel,
    leveledUp: newLevel > currentLevel,
  };
}

/**
 * レベルマイルストーンをチェック
 */
async function checkLevelMilestones(twinId: number, level: number) {
  const levelMilestones: Record<number, MilestoneType> = {
    10: "level_10",
    25: "level_25",
    50: "level_50",
    100: "level_100",
  };
  
  for (const [lvl, milestoneType] of Object.entries(levelMilestones)) {
    if (level >= parseInt(lvl)) {
      await addMilestoneIfNotExists(twinId, milestoneType);
    }
  }
}

/**
 * 統計マイルストーンをチェック
 */
async function checkStatsMilestones(twinId: number, stats: { totalConversations: number; totalImageGenerations: number }) {
  // 会話マイルストーン
  const conversationMilestones: Record<number, MilestoneType> = {
    10: "conversations_10",
    50: "conversations_50",
    100: "conversations_100",
    500: "conversations_500",
  };
  
  for (const [count, milestoneType] of Object.entries(conversationMilestones)) {
    if (stats.totalConversations >= parseInt(count)) {
      await addMilestoneIfNotExists(twinId, milestoneType);
    }
  }
  
  // 画像生成マイルストーン
  const imageMilestones: Record<number, MilestoneType> = {
    1: "first_image",
    10: "images_10",
    50: "images_50",
  };
  
  for (const [count, milestoneType] of Object.entries(imageMilestones)) {
    if (stats.totalImageGenerations >= parseInt(count)) {
      await addMilestoneIfNotExists(twinId, milestoneType);
    }
  }
}

/**
 * 進化をチェック
 */
async function checkEvolution(twinId: number): Promise<{ evolved: boolean; newType?: EvolutionType }> {
  const db = await getDb();
  if (!db) return { evolved: false };
  
  const statusArr = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  const status = statusArr[0];
  
  if (!status) return { evolved: false };
  
  const currentType = status.evolutionType as EvolutionType;
  
  // 進化条件をチェック
  const evolutionChecks: { type: EvolutionType; check: () => boolean }[] = [
    {
      type: "social",
      check: () => status.level >= 20 && status.totalConversations >= 100 && status.totalFriendPredictions >= 20,
    },
    {
      type: "creative",
      check: () => status.level >= 20 && status.totalImageGenerations >= 30 && status.totalConversations >= 50,
    },
    {
      type: "analyst",
      check: () => status.level >= 20 && status.totalScenarioAnswers >= 18 && status.totalDiagnosticsCompleted >= 3,
    },
    {
      type: "empath",
      check: () => status.level >= 30 && status.totalConversations >= 200 && status.bond >= 70,
    },
    {
      type: "sage",
      check: () => status.level >= 50 && status.totalKnowledgeEntries >= 50 && status.totalConversations >= 300,
    },
    {
      type: "legendary",
      check: () => status.level >= 80,
    },
  ];
  
  // 現在のタイプより上位の進化をチェック
  const typeOrder: EvolutionType[] = ["basic", "social", "creative", "analyst", "empath", "sage", "legendary"];
  const currentIndex = typeOrder.indexOf(currentType);
  
  for (const { type, check } of evolutionChecks) {
    const typeIndex = typeOrder.indexOf(type);
    if (typeIndex > currentIndex && check()) {
      // 進化！
      const evolutionHistory = (status.evolutionHistory as Array<{ type: string; evolvedAt: string; level: number }>) || [];
      evolutionHistory.push({
        type,
        evolvedAt: new Date().toISOString(),
        level: status.level,
      });
      
      await db.update(twinGrowthStatus)
        .set({
          evolutionType: type,
          evolutionHistory,
        })
        .where(eq(twinGrowthStatus.twinId, twinId));
      
      // 進化マイルストーンを追加
      const evolutionMilestoneMap: Partial<Record<EvolutionType, MilestoneType>> = {
        social: "evolution_social",
        creative: "evolution_creative",
        analyst: "evolution_analyst",
        empath: "evolution_empath",
        sage: "evolution_sage",
        legendary: "evolution_legendary",
      };
      
      if (evolutionMilestoneMap[type]) {
        await addMilestone(twinId, evolutionMilestoneMap[type]!);
      }
      await addMilestoneIfNotExists(twinId, "first_evolution");
      
      return { evolved: true, newType: type };
    }
  }
  
  return { evolved: false };
}

/**
 * スキル経験値を獲得
 */
async function gainSkillExperience(twinId: number, action: ExperienceAction) {
  const db = await getDb();
  if (!db) return;
  
  const actionSkillMap: Partial<Record<ExperienceAction, SkillType[]>> = {
    conversation: ["conversation", "empathy"],
    imageGeneration: ["creativity"],
    friendPrediction: ["prediction", "analysis"],
    scenarioAnswer: ["analysis", "wisdom"],
    diagnosticComplete: ["analysis"],
    dailyLogin: ["memory"],
    consecutiveLogin7: ["memory"],
    consecutiveLogin30: ["memory"],
    knowledgeAdd: ["wisdom", "memory"],
    friendAdd: ["empathy"],
    matchingComplete: ["prediction"],
    praiseReceived: ["humor", "empathy"],
  };
  
  const skillTypes = actionSkillMap[action] || [];
  
  for (const skillType of skillTypes) {
    const skillArr = await db.select().from(twinSkills)
      .where(and(
        eq(twinSkills.twinId, twinId),
        eq(twinSkills.skillType, skillType)
      ))
      .limit(1);
    const skill = skillArr[0];
    
    if (skill) {
      // スキル経験値を追加
      const newExp = skill.experience + 10;
      const skillDef = skillDefinitions[skillType as SkillType];
      const maxLevel = skillDef?.maxLevel || 10;
      
      // スキルレベルアップチェック
      let newLevel = skill.level;
      const expPerLevel = 100;
      while (newLevel < maxLevel && newExp >= newLevel * expPerLevel) {
        newLevel++;
      }
      
      await db.update(twinSkills)
        .set({
          experience: newExp,
          level: newLevel,
          maxedAt: newLevel >= maxLevel ? new Date() : null,
        })
        .where(eq(twinSkills.id, skill.id));
    } else {
      // 新しいスキルをアンロック
      await db.insert(twinSkills).values({
        twinId,
        skillType,
        level: 1,
        experience: 10,
      });
    }
  }
}

/**
 * マイルストーンを追加
 */
export async function addMilestone(
  twinId: number, 
  milestoneType: MilestoneType, 
  metadata?: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return;
  
  const def = milestoneDefinitions[milestoneType];
  if (!def) return;
  
  await db.insert(twinMilestones).values({
    twinId,
    milestoneType,
    title: def.title,
    description: def.description,
    icon: def.icon,
    metadata,
  });
}

/**
 * マイルストーンが存在しない場合のみ追加
 */
async function addMilestoneIfNotExists(twinId: number, milestoneType: MilestoneType) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await db.select().from(twinMilestones)
    .where(and(
      eq(twinMilestones.twinId, twinId),
      eq(twinMilestones.milestoneType, milestoneType)
    ))
    .limit(1);
  
  if (existing.length === 0) {
    await addMilestone(twinId, milestoneType);
  }
}

/**
 * お世話ステータスを更新（時間経過による減少）
 */
export async function updateCareStatus(twinId: number) {
  const db = await getDb();
  if (!db) return;
  
  const statusArr = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  const status = statusArr[0];
  
  if (!status || !status.lastInteractionAt) return;
  
  const now = new Date();
  const lastInteraction = new Date(status.lastInteractionAt);
  const hoursSinceLastInteraction = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);
  
  // 1時間ごとにステータスが減少
  const decrease = Math.floor(hoursSinceLastInteraction);
  
  if (decrease > 0) {
    const newEnergy = Math.max(0, status.energy - decrease * 2);
    const newFullness = Math.max(0, status.fullness - decrease * 3);
    const newMood = Math.max(0, status.mood - decrease);
    
    await db.update(twinGrowthStatus)
      .set({
        energy: newEnergy,
        fullness: newFullness,
        mood: newMood,
      })
      .where(eq(twinGrowthStatus.twinId, twinId));
  }
}

/**
 * 話しかける（お世話アクション）
 */
export async function talkTo(twinId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const statusArr = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  const status = statusArr[0];
  
  if (!status) return null;
  
  await db.update(twinGrowthStatus)
    .set({
      fullness: Math.min(100, status.fullness + 10),
      mood: Math.min(100, status.mood + 5),
      lastInteractionAt: new Date(),
    })
    .where(eq(twinGrowthStatus.twinId, twinId));
  
  return gainExperience(twinId, "conversation");
}

/**
 * 褒める（お世話アクション）
 */
export async function praise(twinId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const statusArr = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  const status = statusArr[0];
  
  if (!status) return null;
  
  await db.update(twinGrowthStatus)
    .set({
      mood: Math.min(100, status.mood + 15),
      bond: Math.min(100, status.bond + 2),
      lastInteractionAt: new Date(),
    })
    .where(eq(twinGrowthStatus.twinId, twinId));
  
  return gainExperience(twinId, "praiseReceived");
}

/**
 * デイリーログインをチェック
 */
export async function checkDailyLogin(twinId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const status = await getOrCreateGrowthStatus(twinId, userId);
  if (!status) return null;
  
  const today = new Date().toISOString().split("T")[0];
  
  if (status.lastLoginDate !== today) {
    // 新しい日のログイン
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    
    let consecutiveDays = 1;
    if (status.lastLoginDate === yesterdayStr) {
      // 連続ログイン
      consecutiveDays = status.consecutiveLoginDays + 1;
    }
    
    await db.update(twinGrowthStatus)
      .set({
        lastLoginDate: today,
        consecutiveLoginDays: consecutiveDays,
      })
      .where(eq(twinGrowthStatus.twinId, twinId));
    
    // デイリーログイン経験値
    await gainExperience(twinId, "dailyLogin");
    
    // 連続ログインボーナス
    if (consecutiveDays === 7) {
      await gainExperience(twinId, "consecutiveLogin7");
      await addMilestoneIfNotExists(twinId, "week_streak");
    }
    if (consecutiveDays === 30) {
      await gainExperience(twinId, "consecutiveLogin30");
      await addMilestoneIfNotExists(twinId, "month_streak");
    }
    
    return { isNewLogin: true, consecutiveDays };
  }
  
  return { isNewLogin: false, consecutiveDays: status.consecutiveLoginDays };
}

/**
 * 育成ステータスの詳細を取得
 */
export async function getGrowthDetails(twinId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const statusArr = await db.select().from(twinGrowthStatus).where(eq(twinGrowthStatus.twinId, twinId)).limit(1);
  const status = statusArr[0];
  
  if (!status) return null;
  
  const skills = await db.select().from(twinSkills).where(eq(twinSkills.twinId, twinId));
  
  const milestones = await db.select().from(twinMilestones)
    .where(eq(twinMilestones.twinId, twinId))
    .orderBy(desc(twinMilestones.achievedAt));
  
  const recentExp = await db.select().from(experienceHistory)
    .where(eq(experienceHistory.twinId, twinId))
    .orderBy(desc(experienceHistory.createdAt))
    .limit(10);
  
  // 次のレベルまでの経験値を計算
  const currentLevelExp = getRequiredExperience(status.level);
  const nextLevelExp = getRequiredExperience(status.level + 1);
  const expToNextLevel = nextLevelExp - status.experience;
  const progressToNextLevel = ((status.experience - currentLevelExp) / (nextLevelExp - currentLevelExp)) * 100;
  
  // 進化タイプの情報
  const evolutionInfo = evolutionTypes[status.evolutionType as EvolutionType];
  
  return {
    ...status,
    skills: skills.map((s: TwinSkill) => ({
      ...s,
      definition: skillDefinitions[s.skillType as SkillType],
    })),
    milestones,
    recentExperience: recentExp,
    expToNextLevel,
    progressToNextLevel: Math.min(100, Math.max(0, progressToNextLevel)),
    evolutionInfo,
  };
}

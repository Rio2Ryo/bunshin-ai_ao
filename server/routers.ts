import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getUserProfile, upsertUserProfile, getUserById, searchUsers,
  getDigitalTwinByUser, upsertDigitalTwin, getDigitalTwinById, updateDigitalTwin,
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest, getFriends, getPendingFriendRequests, getSentFriendRequests, removeFriend,
  addKnowledgeEntry, getKnowledgeByTwin, deleteKnowledgeEntry,
  createUploadedFile, getUploadedFilesByUser, updateUploadedFileStatus,
  getAiApiConfigs, upsertAiApiConfig, deleteAiApiConfig,
  getOrchestrationRoles, createOrchestrationRole, updateOrchestrationRole, deleteOrchestrationRole,
  createChatSession, getChatSessionsByUser, getChatSessionById,
  addChatMessage, getChatMessagesBySession,
  createMatchingSession, getMatchingSessionsByUser, getMatchingSessionById, updateMatchingSessionStatus,
  addMatchingDialogue, getMatchingDialoguesBySession,
  createMatchingResult, getMatchingResultBySession,
  getUserStats, incrementMatchingCount, updateUserPlan, generateFriendCode, getUserByFriendCode, setUserFriendCode,
  searchPublicTwins, getPublicTwins, updateTwinPublicSettings,
} from "./db";
import { PlanType } from "../drizzle/schema";
import { storagePut } from "./storage";
import { createOrchestratorForUser } from "./services/aiOrchestrator";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";
import { notifyOwner } from "./_core/notification";
import { generatePresentationContent, parseMarkdownToSlides, generateSlideContentFile } from "./services/presentationGenerator";
import { analyzeBigFiveTraits, analyzeJudgmentThresholds, evaluateValueWaveform, calculatePersonalitySimilarity, calculateAccuracyScore, conductPersonalityInterview, analyzeMBTI, conductMBTIInterview, runIntegratedPersonalityAnalysis, generateSelfWaveform, calculateWaveformSimilarity, calculateVirtueMineCompatibility } from "./services/personalityEvaluator";
import { conductValueScenarioInterview, getCumulativeWaveform, getScenarioProgress, VALUE_SCENARIOS, SCENARIO_CATEGORIES, evaluateChatMessage, reevaluateExistingResponses, updateCumulativeWaveform, evaluateByAllTwins } from "./services/valueScenarioService";
import { updateIntimacyScore, getAllIntimacyScores, INTIMACY_LEVELS } from "./services/intimacyService";
import { 
  getUserPoints, 
  awardPoints, 
  spendPoints, 
  getPointTransactions, 
  getRedeemableProducts, 
  redeemProduct, 
  getUserRedemptions,
  getAllPointSettings,
  updatePointSetting,
  initializePointSettings,
  initializeProducts,
  POINT_ACTIONS,
  getQuestList,
  checkDailyLogin,
  checkAndAwardMilestones,
  checkFriendMilestones,
  checkMatchingMilestones
} from "./services/pointService";
import { requestPredictionsFromFriends, comparePredictionWithActual, updateOtherPerspectiveWaveform, calculateSelfReportGap, generatePredictionsForExistingResponses } from "./services/friendPredictionService";
import type { BigFiveTraits, JudgmentThresholds, ValueWaveform, MBTIType } from "../drizzle/schema";
import { otherPerspectiveWaveforms } from "../drizzle/schema";
import { getDb } from "./db";
import { eq } from "drizzle-orm";

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ============ User Profile ============
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getUserProfile(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        displayName: z.string().optional(),
        bio: z.string().optional(),
        skills: z.array(z.string()).optional(),
        experience: z.string().optional(),
        businessInfo: z.string().optional(),
        expertise: z.array(z.string()).optional(),
        industry: z.string().optional(),
        company: z.string().optional(),
        position: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertUserProfile({
          userId: ctx.user.id,
          ...input,
        });
        return { success: true };
      }),
  }),

  // ============ My Digital Twin (1 user = 1 twin) ============
  myTwin: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const twin = await getDigitalTwinByUser(ctx.user.id);
      if (!twin) return null;
      
      // 累積波形とシナリオ進捗を取得
      const cumulativeWaveform = await getCumulativeWaveform(ctx.user.id, twin.id);
      const scenarioProgress = await getScenarioProgress(ctx.user.id, twin.id);
      
      // 他者視点波形を取得
      const db = await getDb();
      const otherPerspectiveWaveform = db ? await db
        .select()
        .from(otherPerspectiveWaveforms)
        .where(eq(otherPerspectiveWaveforms.userId, ctx.user.id))
        .limit(1)
        .then(rows => rows[0] || null) : null;
      
      return {
        ...twin,
        cumulativeWaveform,
        scenarioProgress,
        otherPerspectiveWaveform,
      };
    }),

    upsert: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        rawInput: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        let description: string | undefined;
        let personality: string | undefined;
        let systemPrompt: string | undefined;

        // rawInputがある場合、AIで自動整理
        if (input.rawInput && input.rawInput.trim()) {
          try {
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `あなたはユーザーの情報を整理して、分身AIのプロフィールを作成するアシスタントです。
ユーザーが雑に入力した情報を、以下の3つに整理してください。
JSON形式で出力してください。`,
                },
                {
                  role: "user",
                  content: `以下の情報を整理してください：

${input.rawInput}`,
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "twin_profile",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      description: {
                        type: "string",
                        description: "この人の簡潔な紹介文（50文字程度）",
                      },
                      personality: {
                        type: "string",
                        description: "性格、スキル、得意分野などの特徴",
                      },
                      systemPrompt: {
                        type: "string",
                        description: "この人の分身AIとして振る舞うための詳細な指示",
                      },
                    },
                    required: ["description", "personality", "systemPrompt"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = response.choices[0]?.message?.content;
            if (content && typeof content === 'string') {
              const parsed = JSON.parse(content);
              description = parsed.description;
              personality = parsed.personality;
              systemPrompt = parsed.systemPrompt;
            }
          } catch (error) {
            console.error("Failed to process rawInput with LLM:", error);
            description = input.rawInput;
          }
        }

        // 既存の分身AIがあるか確認
        const existingTwin = await getDigitalTwinByUser(ctx.user.id);
        const isNewTwin = !existingTwin;
        
        const id = await upsertDigitalTwin(ctx.user.id, {
          name: input.name,
          rawInput: input.rawInput,
          description,
          personality,
          systemPrompt,
          status: "active",
        });
        
        // 新規作成の場合のみポイント付与
        if (isNewTwin) {
          await awardPoints(
            ctx.user.id,
            POINT_ACTIONS.TWIN_CREATE.type,
            `twin_${id}`,
            "分身AIを作成"
          ).catch(err => console.error("Point award error:", err));
        }
        
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        name: z.string().optional(),
        rawInput: z.string().optional(),
        status: z.enum(["active", "inactive", "training"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        
        let updateData: Record<string, unknown> = {};
        if (input.name) updateData.name = input.name;
        if (input.status) updateData.status = input.status;
        
        // rawInputが更新された場合、AIで再整理
        if (input.rawInput && input.rawInput.trim()) {
          try {
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `あなたはユーザーの情報を整理して、分身AIのプロフィールを作成するアシスタントです。
ユーザーが雑に入力した情報を、以下の3つに整理してください。
JSON形式で出力してください。`,
                },
                {
                  role: "user",
                  content: `以下の情報を整理してください：

${input.rawInput}`,
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "twin_profile",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      description: { type: "string", description: "この人の簡潔な紹介文（50文字程度）" },
                      personality: { type: "string", description: "性格、スキル、得意分野などの特徴" },
                      systemPrompt: { type: "string", description: "この人の分身AIとして振る舞うための詳細な指示" },
                    },
                    required: ["description", "personality", "systemPrompt"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = response.choices[0]?.message?.content;
            if (content && typeof content === 'string') {
              const parsed = JSON.parse(content);
              updateData.rawInput = input.rawInput;
              updateData.description = parsed.description;
              updateData.personality = parsed.personality;
              updateData.systemPrompt = parsed.systemPrompt;
            }
          } catch (error) {
            console.error("Failed to process rawInput with LLM:", error);
            updateData.rawInput = input.rawInput;
            updateData.description = input.rawInput;
          }
        }
        
        await updateDigitalTwin(twin.id, updateData);
        return { success: true };
      }),

    // 公開設定の更新
    updatePublicSettings: protectedProcedure
      .input(z.object({
        isPublic: z.boolean(),
        publicBio: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        
        // 既存の公開設定を確認
        const wasPublic = twin.isPublic;
        
        await updateTwinPublicSettings(twin.id, input.isPublic, input.publicBio, input.tags);
        
        // 新規公開の場合のみポイント付与（分身AIを公開）
        if (input.isPublic && !wasPublic) {
          awardPoints(ctx.user.id, POINT_ACTIONS.DISCOVERY_PUBLISH.type, `publish_${twin.id}`, "分身AIを公開")
            .catch(err => console.error("Point award error:", err));
        }
        
        return { success: true };
      }),

    // 公開分身AIの検索
    searchPublic: protectedProcedure
      .input(z.object({
        query: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      }))
      .query(async ({ ctx, input }) => {
        if (input.query && input.query.trim()) {
          return searchPublicTwins(input.query, ctx.user.id, input.limit);
        }
        return getPublicTwins(ctx.user.id, input.limit);
      }),

    // 公開分身AIの詳細取得
    getPublicTwin: protectedProcedure
      .input(z.object({ twinId: z.number() }))
      .query(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.twinId);
        if (!twin || !twin.isPublic) {
          throw new TRPCError({ code: "NOT_FOUND", message: "公開分身AIが見つかりません" });
        }
        const user = await getUserById(twin.userId);
        return { twin, user };
      }),

    // ビッグ・ファイブ性格診断を実行
    analyzeBigFive: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        if (!twin.rawInput) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分身AIの情報が不足しています" });
        }

        const bigFiveTraits = await analyzeBigFiveTraits(
          twin.rawInput,
          twin.personality,
          twin.description
        );

        await updateDigitalTwin(twin.id, { bigFiveTraits });
        return { bigFiveTraits };
      }),

    // 9つの判断基準の閾値分析
    analyzeJudgmentThresholds: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        if (!twin.rawInput) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分身AIの情報が不足しています" });
        }

        const judgmentThresholds = await analyzeJudgmentThresholds(
          twin.rawInput,
          twin.personality,
          twin.description
        );

        await updateDigitalTwin(twin.id, { judgmentThresholds });
        return { judgmentThresholds };
      }),

     // 自分の波形を生成（性格診断結果から自己波形を作成）
    generateSelfWaveform: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        // 性格診断が完了しているか確認
        if (!twin.bigFiveTraits && !twin.mbtiType && !twin.judgmentThresholds) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: "波形を生成するには、まず性格診断（ビッグファイブまたはMBTI）を完了してください" 
          });
        }

        const { virtueWaveform, mineWaveform } = await generateSelfWaveform({
          id: twin.id,
          name: twin.name,
          rawInput: twin.rawInput,
          personality: twin.personality,
          description: twin.description,
          bigFiveTraits: twin.bigFiveTraits as BigFiveTraits | null,
          mbtiType: twin.mbtiType as MBTIType | null,
          judgmentThresholds: twin.judgmentThresholds as JudgmentThresholds | null
        });

        await updateDigitalTwin(twin.id, { virtueWaveform, mineWaveform });
        return { virtueWaveform, mineWaveform };
      }),

    // 友達の分身AIから評価を受けて波形を更新
    evaluateWaveform: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        // 友達の分身AIを取得（評価者として使用）
        const friends = await getFriends(ctx.user.id);
        const evaluatorTwins: { id: number; name: string; personality: string | null; judgmentThresholds: JudgmentThresholds | null }[] = [];
        
        for (const friendData of friends.slice(0, 5)) { // 最大5人の友達から評価
          const friendTwin = await getDigitalTwinByUser(friendData.friend.id);
          if (friendTwin) {
            evaluatorTwins.push({
              id: friendTwin.id,
              name: friendTwin.name,
              personality: friendTwin.personality,
              judgmentThresholds: friendTwin.judgmentThresholds as JudgmentThresholds | null
            });
          }
        }

        if (evaluatorTwins.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "評価するための友達の分身AIがありません" });
        }

        const { virtueWaveform, mineWaveform } = await evaluateValueWaveform(
          {
            id: twin.id,
            name: twin.name,
            rawInput: twin.rawInput,
            personality: twin.personality,
            description: twin.description
          },
          evaluatorTwins
        );

        await updateDigitalTwin(twin.id, { virtueWaveform, mineWaveform });
        return { virtueWaveform, mineWaveform };
      }),

    // 既存のシナリオ回答に対して評価を再実行し、累積波形を更新
    reevaluateAndUpdateWaveform: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        // 既存の回答に対して評価を再実行
        const result = await reevaluateExistingResponses(ctx.user.id, twin.id);

        return {
          success: true,
          evaluatedCount: result.evaluatedCount,
          totalResponses: result.totalResponses,
        };
      }),

    // 累積波形のみを更新（評価が既に存在する場合）
    refreshCumulativeWaveform: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        await updateCumulativeWaveform(ctx.user.id, twin.id);
        return { success: true };
      }),

    // 全ての模倣AIによる評価を実行して波形を構築
    evaluateByAllTwins: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        // 全ての模倣AIによる評価を実行
        const result = await evaluateByAllTwins(ctx.user.id, twin.id);

        return {
          success: true,
          evaluatedCount: result.evaluatedCount,
          totalResponses: result.totalResponses,
          totalEvaluators: result.totalEvaluators,
          totalEvaluations: result.totalEvaluations,
        };
      }),

    // 分身AIの精度スコアを計算
    calculateAccuracy: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        // 性格類似度の計算（ユーザーのビッグ・ファイブと分身AIのビッグ・ファイブを比較）
        // 現時点では分身AIのビッグ・ファイブのみを使用
        const personalitySimilarity = twin.bigFiveTraits ? 70 : 0; // ベースライン

        const accuracyScore = calculateAccuracyScore(
          personalitySimilarity,
          (twin.rawInput || '').length,
          twin.trainingIterations || 0,
          !!twin.bigFiveTraits,
          !!twin.judgmentThresholds,
          !!twin.virtueWaveform
        );

        await updateDigitalTwin(twin.id, { 
          personalitySimilarity: personalitySimilarity.toString(),
          accuracyScore: accuracyScore.toString(),
          trainingIterations: (twin.trainingIterations || 0) + 1
        });

        return { personalitySimilarity, accuracyScore };
      }),

    // 全分析を一括実行
    runFullAnalysis: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        if (!twin.rawInput) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分身AIの情報が不足しています" });
        }

        // 1. ビッグ・ファイブ分析
        const bigFiveTraits = await analyzeBigFiveTraits(
          twin.rawInput,
          twin.personality,
          twin.description
        );

        // 2. 判断基準分析
        const judgmentThresholds = await analyzeJudgmentThresholds(
          twin.rawInput,
          twin.personality,
          twin.description
        );

        // 3. 精度スコア計算
        const personalitySimilarity = 70; // ベースライン
        const accuracyScore = calculateAccuracyScore(
          personalitySimilarity,
          twin.rawInput.length,
          (twin.trainingIterations || 0) + 1,
          true,
          true,
          false
        );

        await updateDigitalTwin(twin.id, {
          bigFiveTraits,
          judgmentThresholds,
          personalitySimilarity: personalitySimilarity.toString(),
          accuracyScore: accuracyScore.toString(),
          trainingIterations: (twin.trainingIterations || 0) + 1
        });

        return { bigFiveTraits, judgmentThresholds, personalitySimilarity, accuracyScore };
      }),

    // 性格診断インタビュー（自由会話形式）
    personalityInterview: protectedProcedure
      .input(z.object({
        previousMessages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string()
        })),
        userResponse: z.string().optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await conductPersonalityInterview(
          input.previousMessages,
          input.userResponse
        );

        // 診断が完了した場合、分身AIに保存
        if (result.isComplete && result.traits) {
          const twin = await getDigitalTwinByUser(ctx.user.id);
          if (twin) {
            await updateDigitalTwin(twin.id, {
              bigFiveTraits: result.traits
            });
          }
        }

        return result;
      }),

    // MBTI性格診断インタビュー
    mbtiInterview: protectedProcedure
      .input(z.object({
        previousMessages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string()
        })),
        userResponse: z.string().optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await conductMBTIInterview(
          input.previousMessages,
          input.userResponse
        );

        // 診断が完了した場合、分身AIに保存
        if (result.isComplete && result.mbtiType) {
          const twin = await getDigitalTwinByUser(ctx.user.id);
          if (twin) {
            await updateDigitalTwin(twin.id, {
              mbtiType: result.mbtiType
            });
          }
        }

        return result;
      }),

    // 統合性格分析（ビッグ・ファイブ + MBTI + 判断基準）
    runIntegratedAnalysis: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        if (!twin.rawInput) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分身AIの情報が不足しています" });
        }

        const result = await runIntegratedPersonalityAnalysis(
          twin.rawInput,
          twin.personality,
          twin.description
        );

        // 分身AIに保存
        await updateDigitalTwin(twin.id, {
          bigFiveTraits: result.bigFiveTraits,
          mbtiType: result.mbtiType,
          judgmentThresholds: result.judgmentThresholds,
          trainingIterations: (twin.trainingIterations || 0) + 1
        });

        // 精度スコアを計算
        const personalitySimilarity = calculatePersonalitySimilarity(
          result.bigFiveTraits,
          result.bigFiveTraits // 自己比較なので100%
        );
        const accuracyScore = calculateAccuracyScore(
          personalitySimilarity,
          twin.rawInput?.length || 0,
          (twin.trainingIterations || 0) + 1,
          true,
          true,
          true
        );

        await updateDigitalTwin(twin.id, {
          personalitySimilarity: personalitySimilarity.toString(),
          accuracyScore: accuracyScore.toString()
        });

        return {
          bigFiveTraits: result.bigFiveTraits,
          mbtiType: result.mbtiType,
          judgmentThresholds: result.judgmentThresholds,
          personalitySimilarity,
          accuracyScore
        };
      }),

    // 価値観シナリオインタビュー（動的な波形生成）
    valueScenarioInterview: protectedProcedure
      .input(z.object({
        previousMessages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string()
        })),
        userResponse: z.string().optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        const result = await conductValueScenarioInterview(
          ctx.user.id,
          twin.id,
          input.previousMessages,
          input.userResponse
        );

        // ユーザーが回答した場合はポイントを付与
        if (input.userResponse && result.scenarioId) {
          await awardPoints(
            ctx.user.id,
            POINT_ACTIONS.SCENARIO_ANSWER.type,
            `scenario_${result.scenarioId}`,
            `価値観シナリオ「${result.scenarioId}」に回答`
          ).catch(err => console.error("Point award error:", err));
        }

        return result;
      }),

    // 価値観シナリオの進捗を取得
    getScenarioProgress: protectedProcedure
      .query(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        return getScenarioProgress(ctx.user.id, twin.id);
      }),

    // 累積波形を取得
    getCumulativeWaveform: protectedProcedure
      .query(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        return getCumulativeWaveform(ctx.user.id, twin.id);
      }),

    // 利用可能なシナリオ一覧を取得
    getAvailableScenarios: protectedProcedure
      .query(async () => {
        return {
          scenarios: VALUE_SCENARIOS,
          categories: SCENARIO_CATEGORIES
        };
      }),

  }),

  // ============ Friends ============
  friends: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getFriends(ctx.user.id);
    }),

    pendingRequests: protectedProcedure.query(async ({ ctx }) => {
      return getPendingFriendRequests(ctx.user.id);
    }),

    sentRequests: protectedProcedure.query(async ({ ctx }) => {
      return getSentFriendRequests(ctx.user.id);
    }),

    searchUsers: protectedProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        return searchUsers(input.query, ctx.user.id);
      }),

    sendRequest: protectedProcedure
      .input(z.object({ friendCode: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        // Check plan limits
        const plan = (ctx.user.plan || "free") as PlanType;
        const stats = await getUserStats(ctx.user.id, plan);
        if (stats && !stats.canAddFriend) {
          throw new TRPCError({ 
            code: "FORBIDDEN", 
            message: `友達数の上限（${stats.limits.maxFriends}人）に達しました。プランをアップグレードしてください。` 
          });
        }

        // Find user by friend code
        const friend = await getUserByFriendCode(input.friendCode.toUpperCase());
        if (!friend) {
          throw new TRPCError({ code: "NOT_FOUND", message: "ユーザーが見つかりません" });
        }
        if (friend.id === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "自分にはリクエストを送れません" });
        }
        const id = await sendFriendRequest(ctx.user.id, friend.id);
        return { id };
      }),

    acceptRequest: protectedProcedure
      .input(z.object({ requestId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await acceptFriendRequest(input.requestId, ctx.user.id);
        
        // 友達追加でポイント付与
        await awardPoints(
          ctx.user.id,
          POINT_ACTIONS.FRIEND_ADD.type,
          `friend_${input.requestId}`,
          "友達リクエストを承認"
        ).catch(err => console.error("Point award error:", err));
        
        return { success: true };
      }),

    rejectRequest: protectedProcedure
      .input(z.object({ requestId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await rejectFriendRequest(input.requestId, ctx.user.id);
        return { success: true };
      }),

    remove: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await removeFriend(ctx.user.id, input.friendId);
        return { success: true };
      }),

    // 友達との波形マッチング度を計算
    getWaveformCompatibility: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async ({ ctx, input }) => {
        const myTwin = await getDigitalTwinByUser(ctx.user.id);
        if (!myTwin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        const friendTwin = await getDigitalTwinByUser(input.friendId);
        if (!friendTwin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIが見つかりません" });
        }

        const myWaveform = myTwin.virtueWaveform as ValueWaveform | null;
        const friendWaveform = friendTwin.virtueWaveform as ValueWaveform | null;

        if (!myWaveform) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "まず自分の波形を生成してください" });
        }

        if (!friendWaveform) {
          return {
            hasData: false,
            message: "友達の波形がまだ生成されていません",
            compatibility: null
          };
        }

        const waveformSimilarity = calculateWaveformSimilarity(myWaveform, friendWaveform);
        const compatibility = calculateVirtueMineCompatibility(myWaveform, friendWaveform);

        return {
          hasData: true,
          waveformSimilarity,
          ...compatibility,
          friendName: friendTwin.name
        };
      }),

    // 親密度を取得
    getIntimacy: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async ({ ctx, input }) => {
        const scores = await getAllIntimacyScores(ctx.user.id);
        const friendScore = scores.find(s => s.friendId === input.friendId);
        if (!friendScore) {
          return {
            intimacyScore: 0,
            intimacyLevel: "stranger" as const,
            intimacyLevelLabel: INTIMACY_LEVELS.stranger.label,
            predictionAccuracy: null
          };
        }
        return {
          ...friendScore,
          intimacyLevelLabel: INTIMACY_LEVELS[friendScore.intimacyLevel].label
        };
      }),

    // 親密度を更新
    updateIntimacy: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const result = await updateIntimacyScore(ctx.user.id, input.friendId);
        return {
          ...result,
          intimacyLevelLabel: INTIMACY_LEVELS[result.intimacyLevel].label
        };
      }),

    // 全友達の親密度一覧を取得
    getAllIntimacyScores: protectedProcedure
      .query(async ({ ctx }) => {
        const scores = await getAllIntimacyScores(ctx.user.id);
        return scores.map(s => ({
          ...s,
          intimacyLevelLabel: INTIMACY_LEVELS[s.intimacyLevel].label
        }));
      }),

    // 友達に予測を依頼（シナリオ回答前）
    requestPredictions: protectedProcedure
      .input(z.object({
        scenarioId: z.string(),
        scenarioText: z.string(),
        friendUserIds: z.array(z.number())
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        const predictionIds = await requestPredictionsFromFriends(
          ctx.user.id,
          twin.id,
          input.scenarioId,
          input.scenarioText,
          input.friendUserIds
        );
        return { predictionIds, count: predictionIds.length };
      }),

    // 他者視点波形を更新（既存の予測から波形を再計算）
    updateOtherPerspectiveWaveform: protectedProcedure
      .mutation(async ({ ctx }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        await updateOtherPerspectiveWaveform(ctx.user.id, twin.id);
        const gap = await calculateSelfReportGap(ctx.user.id);
        return { success: true, selfReportGap: gap };
      }),

    // 友達の分身AIから予測を生成して他者視点波形を構築
    generateFriendPredictions: protectedProcedure
      .mutation(async ({ ctx }) => {
        console.log("[generateFriendPredictions] Called for user:", ctx.user.id);
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }
        
        const result = await generatePredictionsForExistingResponses(ctx.user.id, twin.id);
        
        // 予測生成後に他者視点波形を更新
        const waveformResult = await updateOtherPerspectiveWaveform(ctx.user.id, twin.id);
        console.log("[generateFriendPredictions] Waveform updated:", waveformResult);
        
        return {
          success: true,
          ...result,
          waveform: waveformResult
        };
      }),

    // 全友達とのマッチング度一覧を取得
    getAllWaveformCompatibilities: protectedProcedure
      .query(async ({ ctx }) => {
        const myTwin = await getDigitalTwinByUser(ctx.user.id);
        if (!myTwin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
        }

        const myWaveform = myTwin.virtueWaveform as ValueWaveform | null;
        if (!myWaveform) {
          return {
            hasMyWaveform: false,
            message: "まず自分の波形を生成してください",
            compatibilities: []
          };
        }

        const friends = await getFriends(ctx.user.id);
        const compatibilities = [];

        for (const friendData of friends) {
          const friendTwin = await getDigitalTwinByUser(friendData.friend.id);
          if (friendTwin) {
            const friendWaveform = friendTwin.virtueWaveform as ValueWaveform | null;
            if (friendWaveform) {
              const waveformSimilarity = calculateWaveformSimilarity(myWaveform, friendWaveform);
              const compatibility = calculateVirtueMineCompatibility(myWaveform, friendWaveform);
              compatibilities.push({
                friendId: friendData.friend.id,
                friendName: friendTwin.name,
                waveformSimilarity,
                ...compatibility
              });
            } else {
              compatibilities.push({
                friendId: friendData.friend.id,
                friendName: friendTwin.name,
                hasWaveform: false
              });
            }
          }
        }

        // 総合相性順にソート
        compatibilities.sort((a, b) => {
          const aScore = 'overallCompatibility' in a ? a.overallCompatibility : 0;
          const bScore = 'overallCompatibility' in b ? b.overallCompatibility : 0;
          return bScore - aScore;
        });

        return {
          hasMyWaveform: true,
          compatibilities
        };
      }),
  }),

  // ============ Knowledge Base ============
  knowledge: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const twin = await getDigitalTwinByUser(ctx.user.id);
      if (!twin) return [];
      return getKnowledgeByTwin(twin.id);
    }),

    add: protectedProcedure
      .input(z.object({
        sourceType: z.enum(["upload", "api", "manual"]),
        sourceId: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Create your digital twin first" });
        }
        const id = await addKnowledgeEntry({ ...input, twinId: twin.id });
        
        // ポイント付与（ナレッジ追加）
        awardPoints(ctx.user.id, POINT_ACTIONS.KNOWLEDGE_ADD.type, `knowledge_${id}`, "ナレッジ追加")
          .catch(err => console.error("Point award error:", err));
        
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await deleteKnowledgeEntry(input.id);
        return { success: true };
      }),
  }),

  // ============ File Upload ============
  files: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUploadedFilesByUser(ctx.user.id);
    }),

    upload: protectedProcedure
      .input(z.object({
        filename: z.string(),
        content: z.string(), // base64 encoded
        mimeType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        const buffer = Buffer.from(input.content, "base64");
        const fileKey = `twins/${ctx.user.id}/${nanoid()}-${input.filename}`;
        
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        
        const fileId = await createUploadedFile({
          userId: ctx.user.id,
          twinId: twin?.id,
          filename: input.filename,
          fileKey,
          url,
          mimeType: input.mimeType,
          size: buffer.length,
          status: "pending",
        });
        
        // ポイント付与（ファイルアップロード）
        awardPoints(ctx.user.id, POINT_ACTIONS.FILE_UPLOAD.type, `file_${fileId}`, "ファイルアップロード")
          .catch(err => console.error("Point award error:", err));

        return { id: fileId, url };
      }),

    process: protectedProcedure
      .input(z.object({ fileId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updateUploadedFileStatus(input.fileId, "processing");
        // TODO: Implement file processing with LLM
        await updateUploadedFileStatus(input.fileId, "completed");
        return { success: true };
      }),
  }),

  // ============ AI API Configuration ============
  aiConfig: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getAiApiConfigs(ctx.user.id);
    }),

    upsert: protectedProcedure
      .input(z.object({
        provider: z.enum(["openai", "gemini", "anthropic", "grok"]),
        apiKey: z.string().min(1),
        isActive: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 既存の設定を確認
        const existingConfigs = await getAiApiConfigs(ctx.user.id);
        const isNewConnection = !existingConfigs.some(c => c.provider === input.provider);
        
        await upsertAiApiConfig({
          userId: ctx.user.id,
          ...input,
        });
        
        // 新規接続の場合のみポイント付与（外部AI API接続）
        if (isNewConnection) {
          awardPoints(ctx.user.id, POINT_ACTIONS.EXTERNAL_AI_CONNECT.type, `api_${input.provider}`, `外部AI API接続 (${input.provider})`)
            .catch(err => console.error("Point award error:", err));
        }
        
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ provider: z.enum(["openai", "gemini", "anthropic", "grok"]) }))
      .mutation(async ({ ctx, input }) => {
        await deleteAiApiConfig(ctx.user.id, input.provider);
        return { success: true };
      }),

    validate: protectedProcedure
      .input(z.object({
        provider: z.enum(["openai", "gemini", "anthropic", "grok"]),
        apiKey: z.string(),
      }))
      .mutation(async ({ input }) => {
        // TODO: Implement API key validation
        return { valid: true };
      }),
  }),

  // ============ AI Orchestration ============
  orchestration: router({
    roles: protectedProcedure.query(async ({ ctx }) => {
      return getOrchestrationRoles(ctx.user.id);
    }),

    createRole: protectedProcedure
      .input(z.object({
        roleName: z.string().min(1),
        roleDescription: z.string().optional(),
        assignedProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]),
        assignedModel: z.string().optional(),
        priority: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await createOrchestrationRole({
          userId: ctx.user.id,
          ...input,
        });
        
        // ポイント付与（ロール追加）
        awardPoints(ctx.user.id, POINT_ACTIONS.ORCHESTRATION_ROLE_ADD.type, `role_${id}`, `ロール追加: ${input.roleName}`)
          .catch(err => console.error("Point award error:", err));
        
        return { id };
      }),

    updateRole: protectedProcedure
      .input(z.object({
        id: z.number(),
        roleName: z.string().optional(),
        roleDescription: z.string().optional(),
        assignedProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]).optional(),
        assignedModel: z.string().optional(),
        priority: z.number().optional(),
        isActive: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateOrchestrationRole(id, data);
        return { success: true };
      }),

    deleteRole: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteOrchestrationRole(input.id);
        return { success: true };
      }),

    getSettings: protectedProcedure.query(async ({ ctx }) => {
      const roles = await getOrchestrationRoles(ctx.user.id);
      const configs = await getAiApiConfigs(ctx.user.id);
      return { roles, configs };
    }),

    updateSettings: protectedProcedure
      .input(z.object({
        defaultProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return { success: true };
      }),
  }),

  // ============ Chat with My Twin ============
  chat: router({
    sessions: protectedProcedure.query(async ({ ctx }) => {
      return getChatSessionsByUser(ctx.user.id);
    }),

    getSession: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const session = await getChatSessionById(input.id);
        if (!session || session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const messages = await getChatMessagesBySession(input.id);
        return { session, messages };
      }),

    createSession: protectedProcedure
      .input(z.object({ title: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Create your digital twin first" });
        }
        const id = await createChatSession({
          userId: ctx.user.id,
          twinId: twin.id,
          title: input.title || "New Chat",
        });
        return { id };
      }),

    sendMessage: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        content: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const session = await getChatSessionById(input.sessionId);
        if (!session || session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // ユーザーメッセージを保存
        await addChatMessage({
          sessionId: input.sessionId,
          role: "user",
          content: input.content,
        });

        // 分身AIの応答を生成
        const twin = await getDigitalTwinById(session.twinId);
        if (!twin) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const knowledge = await getKnowledgeByTwin(twin.id);
        const orchestrator = await createOrchestratorForUser(ctx.user.id, twin, knowledge);

        const messages = await getChatMessagesBySession(input.sessionId);
        const history = messages.map(m => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));

        const response = await orchestrator.chat(input.content, history);

        const messageId = await addChatMessage({
          sessionId: input.sessionId,
          role: "assistant",
          content: response,
        });

        // チャットメッセージをランダムな模倣人格で評価して波形を累積更新
        // 非同期で実行（ユーザー体験に影響しないように）
        evaluateChatMessage(
          ctx.user.id,
          twin.id,
          input.content,
          response
        ).catch(err => console.error("Chat evaluation error:", err));
        
        // ポイント付与（分身AIとの会話）
        awardPoints(ctx.user.id, POINT_ACTIONS.CHAT_MESSAGE.type, `chat_${messageId}`, "分身AIとの会話")
          .catch(err => console.error("Point award error:", err));
        
        // マイルストーンチェック（非同期）
        checkAndAwardMilestones(ctx.user.id)
          .catch(err => console.error("Milestone check error:", err));

        return { messageId, response };
      }),
  }),

  // ============ Business Matching (Friend's Twins) ============
  matching: router({
    sessions: protectedProcedure.query(async ({ ctx }) => {
      return getMatchingSessionsByUser(ctx.user.id);
    }),

    getSession: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.id);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        
        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);
        const dialogues = await getMatchingDialoguesBySession(input.id);
        const result = await getMatchingResultBySession(input.id);

        return { session, twin1, twin2, dialogues, result };
      }),

    // Get friends who have digital twins (available for matching)
    availableFriends: protectedProcedure.query(async ({ ctx }) => {
      const friends = await getFriends(ctx.user.id);
      return friends.filter(f => f.twin !== null);
    }),

    create: protectedProcedure
      .input(z.object({
        friendId: z.number(),
        theme: z.string().min(1),
        turns: z.number().min(1).max(30).default(5),
      }))
      .mutation(async ({ ctx, input }) => {
        // Check plan limits
        const plan = (ctx.user.plan || "free") as PlanType;
        const stats = await getUserStats(ctx.user.id, plan);
        if (stats && !stats.canCreateMatching) {
          throw new TRPCError({ 
            code: "FORBIDDEN", 
            message: `今月のマッチング回数上限（${stats.limits.maxMatchingsPerMonth}回）に達しました。プランをアップグレードしてください。` 
          });
        }

        // Get my twin
        const myTwin = await getDigitalTwinByUser(ctx.user.id);
        if (!myTwin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Create your digital twin first" });
        }

        // Get friend's twin
        const friendTwin = await getDigitalTwinByUser(input.friendId);
        if (!friendTwin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Your friend doesn't have a digital twin yet" });
        }

        // Verify friendship
        const friends = await getFriends(ctx.user.id);
        const isFriend = friends.some(f => f.friend.id === input.friendId);
        if (!isFriend) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only match with friends" });
        }

        // Create session
        const sessionId = await createMatchingSession({
          initiatorUserId: ctx.user.id,
          twin1Id: myTwin.id,
          twin2Id: friendTwin.id,
          theme: input.theme,
        });

        // Automatically run dialogue
        await updateMatchingSessionStatus(sessionId, "running");

        const knowledge1 = await getKnowledgeByTwin(myTwin.id);
        const knowledge2 = await getKnowledgeByTwin(friendTwin.id);

        const orchestrator1 = await createOrchestratorForUser(myTwin.userId, myTwin, knowledge1);
        const orchestrator2 = await createOrchestratorForUser(friendTwin.userId, friendTwin, knowledge2);

        const dialogues: { speaker: string; content: string }[] = [];

        for (let turn = 0; turn < input.turns; turn++) {
          // Twin1の発言
          const result1 = await orchestrator1.generateMatchingDialogue(
            friendTwin,
            knowledge2,
            input.theme,
            dialogues,
            true,
          );
          
          dialogues.push({ speaker: myTwin.name, content: result1.content });
          await addMatchingDialogue({
            sessionId,
            speakerTwinId: myTwin.id,
            content: result1.content,
            aiProvider: "builtin",
            turnNumber: turn * 2,
          });

          // Twin2の発言
          const result2 = await orchestrator2.generateMatchingDialogue(
            myTwin,
            knowledge1,
            input.theme,
            dialogues,
            false,
          );
          
          dialogues.push({ speaker: friendTwin.name, content: result2.content });
          await addMatchingDialogue({
            sessionId,
            speakerTwinId: friendTwin.id,
            content: result2.content,
            aiProvider: "builtin",
            turnNumber: turn * 2 + 1,
          });
        }

        await updateMatchingSessionStatus(sessionId, "completed");

        // Automatically run analysis
        const dialogueText = dialogues.map(d => `${d.speaker}: ${d.content}`).join("\n\n");

        const analysisResponse = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `あなたはビジネスマッチングの専門家です。2人の分身AI同士の対話を分析し、具体的なビジネス協業のアクションプランを提案してください。

【重要】マッチングスコアは以下の5つの観点から算出し、各観点の点数と理由を明示してください：
1. スキルマッチ度（20点満点）: 両者のスキルが補完し合えるか
2. 価値観の一致度（20点満点）: ビジネスに対する考え方や優先順位が合うか
3. コミュニケーションスタイル（20点満点）: 対話のスタイルや進め方が合うか
4. ビジネス目標の適合度（20点満点）: 目指す方向性や目標が合致するか
5. 相互補完性（20点満点）: お互いの強みが弱みを補えるか

【重要】ふんわりした要約ではなく、以下の点を具体的に記載してください：
- 具体的な協業プロジェクト名と内容
- 各自の役割分担（誰が何を担当するか）
- 具体的なタイムライン（最初の1週間、最初の1ヶ月で何をするか）
- 必要なリソースや投資（人、金、時間）
- 期待される成果とKPI
- リスクとその対策
- 次のステップ（明日からできること）`,
            },
            {
              role: "user",
              content: `以下の対話を分析し、具体的なアクションプランを作成してください。

テーマ: ${input.theme}

${myTwin.name}のプロフィール:
${myTwin.description || ""}
${myTwin.personality || ""}

${friendTwin.name}のプロフィール:
${friendTwin.description || ""}
${friendTwin.personality || ""}

対話内容:
${dialogueText}

上記の対話を踏まえて、以下を具体的に分析してください：
1. マッチングスコアの内訳（5つの観点それぞれの点数と理由）
2. この2人が協業する場合の具体的なプロジェクト名と内容
3. 各自の役割分担（誰が何を担当するか）
4. 具体的なタイムライン（Week1, Week2-4, Month2-3で何をするか）
5. 必要なリソースや投資
6. 期待される成果とKPI
7. リスクとその対策
8. 明日からできる具体的なアクション`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "matching_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  compatibilityScore: { type: "number", description: "0-100の相性スコア（5つの観点の合計）" },
                  scoreBreakdown: {
                    type: "object",
                    description: "スコアの内訳",
                    properties: {
                      skillMatch: {
                        type: "object",
                        properties: {
                          score: { type: "number", description: "0-20のスコア" },
                          reason: { type: "string", description: "具体的な理由" }
                        },
                        required: ["score", "reason"],
                        additionalProperties: false
                      },
                      valueAlignment: {
                        type: "object",
                        properties: {
                          score: { type: "number", description: "0-20のスコア" },
                          reason: { type: "string", description: "具体的な理由" }
                        },
                        required: ["score", "reason"],
                        additionalProperties: false
                      },
                      communicationStyle: {
                        type: "object",
                        properties: {
                          score: { type: "number", description: "0-20のスコア" },
                          reason: { type: "string", description: "具体的な理由" }
                        },
                        required: ["score", "reason"],
                        additionalProperties: false
                      },
                      businessGoalFit: {
                        type: "object",
                        properties: {
                          score: { type: "number", description: "0-20のスコア" },
                          reason: { type: "string", description: "具体的な理由" }
                        },
                        required: ["score", "reason"],
                        additionalProperties: false
                      },
                      complementaryStrengths: {
                        type: "object",
                        properties: {
                          score: { type: "number", description: "0-20のスコア" },
                          reason: { type: "string", description: "具体的な理由" }
                        },
                        required: ["score", "reason"],
                        additionalProperties: false
                      }
                    },
                    required: ["skillMatch", "valueAlignment", "communicationStyle", "businessGoalFit", "complementaryStrengths"],
                    additionalProperties: false
                  },
                  summary: { type: "string", description: "協業プロジェクトの具体的な内容（プロジェクト名、目的、期待成果を含む）" },
                  collaborationPotential: { type: "string", description: "協業の可能性と具体的な形態（共同開発、業務提携、合弁会社設立など）" },
                  strengths: { type: "array", items: { type: "string" }, description: "具体的なシナジー（例: 「Aさんの技術力×Bさんの営業網で新規顧客開拓可能」）" },
                  challenges: { type: "array", items: { type: "string" }, description: "具体的な課題とリスク（例: 「初期投資100万円が必要」「技術的なハードルがある」）" },
                  recommendations: { type: "array", items: { type: "string" }, description: "具体的なアクションプラン（例: 「来週月曜にキックオフミーティングを設定」「まずはMVPを作成」）" },
                  roleDistribution: { type: "string", description: "役割分担（例: 「Aさん: 技術開発・プロダクト設計 / Bさん: 営業・マーケティング・資金調達」）" },
                  timeline: { type: "string", description: "具体的なタイムライン（Week1: ○○, Week2-4: ○○, Month2-3: ○○）" },
                  resources: { type: "string", description: "必要なリソース（人、金、時間、ツールなど）" },
                  kpis: { type: "string", description: "期待される成果とKPI（例: 「3ヶ月で売上100万円」「ユーザー1000人獲得」）" },
                  nextSteps: { type: "string", description: "明日からできる具体的なアクション（3つ以上）" },
                  detailedAnalysis: { type: "string", description: "詳細な分析（対話から読み取れる具体的なポイント）" },
                },
                required: ["compatibilityScore", "scoreBreakdown", "summary", "collaborationPotential", "strengths", "challenges", "recommendations", "roleDistribution", "timeline", "resources", "kpis", "nextSteps", "detailedAnalysis"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = analysisResponse.choices[0]?.message?.content;
        if (content && typeof content === 'string') {
          const analysis = JSON.parse(content);

          await createMatchingResult({
            sessionId,
            compatibilityScore: String(analysis.compatibilityScore),
            scoreBreakdown: analysis.scoreBreakdown,
            summary: analysis.summary,
            collaborationPotential: analysis.collaborationPotential,
            strengths: analysis.strengths,
            challenges: analysis.challenges,
            recommendations: analysis.recommendations,
            detailedAnalysis: analysis.detailedAnalysis,
            roleDistribution: analysis.roleDistribution,
            timeline: analysis.timeline,
            resources: analysis.resources,
            kpis: analysis.kpis,
            nextSteps: analysis.nextSteps,
          });

          // Send notification to owner about matching completion
          try {
            await notifyOwner({
              title: `マッチング完了: ${myTwin.name} × ${friendTwin.name}`,
              content: `テーマ: ${input.theme}\n相性スコア: ${analysis.compatibilityScore}%\n\n${analysis.summary}`,
            });
          } catch (e) {
            console.warn("Failed to send notification:", e);
          }
        }

        // Increment matching count for usage tracking
        await incrementMatchingCount(ctx.user.id);
        
        // マッチング完了でポイント付与
        await awardPoints(
          ctx.user.id,
          POINT_ACTIONS.MATCHING_COMPLETE.type,
          `matching_${sessionId}`,
          `マッチング完了: ${myTwin.name} × ${friendTwin.name}`
        ).catch(err => console.error("Point award error:", err));

        return { id: sessionId, dialogues };
      }),

    runDialogue: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        turns: z.number().min(1).max(30).default(5),
      }))
      .mutation(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        await updateMatchingSessionStatus(input.sessionId, "running");

        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);

        if (!twin1 || !twin2) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const knowledge1 = await getKnowledgeByTwin(twin1.id);
        const knowledge2 = await getKnowledgeByTwin(twin2.id);

        const orchestrator1 = await createOrchestratorForUser(twin1.userId, twin1, knowledge1);
        const orchestrator2 = await createOrchestratorForUser(twin2.userId, twin2, knowledge2);

        const dialogues: { speaker: string; content: string }[] = [];

        for (let turn = 0; turn < input.turns; turn++) {
          // Twin1の発言
          const result1 = await orchestrator1.generateMatchingDialogue(
            twin2,
            knowledge2,
            session.theme,
            dialogues,
            true,
          );
          
          dialogues.push({ speaker: twin1.name, content: result1.content });
          await addMatchingDialogue({
            sessionId: input.sessionId,
            speakerTwinId: twin1.id,
            content: result1.content,
            aiProvider: "builtin",
            turnNumber: turn * 2,
          });

          // Twin2の発言
          const result2 = await orchestrator2.generateMatchingDialogue(
            twin1,
            knowledge1,
            session.theme,
            dialogues,
            false,
          );
          
          dialogues.push({ speaker: twin2.name, content: result2.content });
          await addMatchingDialogue({
            sessionId: input.sessionId,
            speakerTwinId: twin2.id,
            content: result2.content,
            aiProvider: "builtin",
            turnNumber: turn * 2 + 1,
          });
        }

        await updateMatchingSessionStatus(input.sessionId, "completed");

        return { dialogues };
      }),

    analyze: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);
        const dialogues = await getMatchingDialoguesBySession(input.sessionId);

        if (!twin1 || !twin2) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const dialogueText = dialogues.map(d => {
          const speaker = d.speakerTwinId === twin1.id ? twin1.name : twin2.name;
          return `${speaker}: ${d.content}`;
        }).join("\n\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `あなたはビジネスマッチングの専門家です。2人の分身AI同士の対話を分析し、ビジネス協業の可能性を評価してください。`,
            },
            {
              role: "user",
              content: `以下の対話を分析してください。

テーマ: ${session.theme}

${twin1.name}のプロフィール:
${twin1.description || ""}
${twin1.personality || ""}

${twin2.name}のプロフィール:
${twin2.description || ""}
${twin2.personality || ""}

対話内容:
${dialogueText}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "matching_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  compatibilityScore: { type: "number", description: "0-100の相性スコア" },
                  summary: { type: "string", description: "マッチング結果の要約" },
                  collaborationPotential: { type: "string", description: "協業の可能性" },
                  strengths: { type: "array", items: { type: "string" }, description: "強み・シナジー" },
                  challenges: { type: "array", items: { type: "string" }, description: "課題・リスク" },
                  recommendations: { type: "array", items: { type: "string" }, description: "具体的な提案" },
                  detailedAnalysis: { type: "string", description: "詳細な分析" },
                },
                required: ["compatibilityScore", "summary", "collaborationPotential", "strengths", "challenges", "recommendations", "detailedAnalysis"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content || typeof content !== 'string') {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to analyze" });
        }

        const analysis = JSON.parse(content);

        await createMatchingResult({
          sessionId: input.sessionId,
          compatibilityScore: String(analysis.compatibilityScore),
          summary: analysis.summary,
          collaborationPotential: analysis.collaborationPotential,
          strengths: analysis.strengths,
          challenges: analysis.challenges,
          recommendations: analysis.recommendations,
          detailedAnalysis: analysis.detailedAnalysis,
        });

        // Send notification to owner about matching completion
        try {
          await notifyOwner({
            title: `マッチング完了: ${twin1.name} × ${twin2.name}`,
            content: `テーマ: ${session.theme}\n相性スコア: ${analysis.compatibilityScore}%\n\n${analysis.summary}`,
          });
        } catch (e) {
          console.warn("Failed to send notification:", e);
        }

        return analysis;
      }),

    exportReport: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);
        const dialogues = await getMatchingDialoguesBySession(input.sessionId);
        const result = await getMatchingResultBySession(input.sessionId);

        if (!twin1 || !twin2) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const { generateMatchingReportHtml } = await import("./services/pdfGenerator");

        const reportDialogues = dialogues.map(d => ({
          speaker: d.speakerTwinId === twin1.id ? twin1.name : twin2.name,
          content: d.content,
          createdAt: d.createdAt,
        }));

        const html = generateMatchingReportHtml({
          sessionId: input.sessionId,
          theme: session.theme,
          createdAt: session.createdAt,
          twin1: { name: twin1.name, description: twin1.description },
          twin2: { name: twin2.name, description: twin2.description },
          dialogues: reportDialogues,
          analysis: result ? {
            compatibilityScore: result.compatibilityScore ? parseInt(result.compatibilityScore) : undefined,
            strengths: result.strengths || undefined,
            opportunities: result.recommendations || undefined,
            recommendations: result.recommendations || undefined,
            summary: result.summary || undefined,
          } : null,
        });

        return { html };
      }),

    generatePresentation: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);
        const dialogues = await getMatchingDialoguesBySession(input.sessionId);
        const result = await getMatchingResultBySession(input.sessionId);

        if (!twin1 || !twin2) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Generate slide content from matching data
        const slideContent = await generatePresentationContent({
          theme: session.theme,
          twin1: { name: twin1.name, description: twin1.description, personality: twin1.personality },
          twin2: { name: twin2.name, description: twin2.description, personality: twin2.personality },
          dialogues: dialogues.map(d => ({
            speaker: d.speakerTwinId === twin1.id ? twin1.name : twin2.name,
            content: d.content,
          })),
          result: result ? {
            compatibilityScore: result.compatibilityScore ? parseInt(result.compatibilityScore) : 0,
            summary: result.summary || "",
            collaborationPotential: result.collaborationPotential || "",
            strengths: result.strengths || [],
            challenges: result.challenges || [],
            recommendations: result.recommendations || [],
            roleDistribution: result.roleDistribution || "",
            timeline: result.timeline || "",
            resources: result.resources || "",
            kpis: result.kpis || "",
            nextSteps: result.nextSteps || "",
            detailedAnalysis: result.detailedAnalysis || "",
          } : null,
        });

        return { slideContent, slideCount: slideContent.slideCount };
      }),

    generateNanoBananaSlides: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);
        const dialogues = await getMatchingDialoguesBySession(input.sessionId);
        const result = await getMatchingResultBySession(input.sessionId);

        if (!twin1 || !twin2) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Generate slide content from matching data
        const slideContent = await generatePresentationContent({
          theme: session.theme,
          twin1: { name: twin1.name, description: twin1.description, personality: twin1.personality },
          twin2: { name: twin2.name, description: twin2.description, personality: twin2.personality },
          dialogues: dialogues.map(d => ({
            speaker: d.speakerTwinId === twin1.id ? twin1.name : twin2.name,
            content: d.content,
          })),
          result: result ? {
            compatibilityScore: result.compatibilityScore ? parseInt(result.compatibilityScore) : 0,
            summary: result.summary || "",
            collaborationPotential: result.collaborationPotential || "",
            strengths: result.strengths || [],
            challenges: result.challenges || [],
            recommendations: result.recommendations || [],
            roleDistribution: result.roleDistribution || "",
            timeline: result.timeline || "",
            resources: result.resources || "",
            kpis: result.kpis || "",
            nextSteps: result.nextSteps || "",
            detailedAnalysis: result.detailedAnalysis || "",
          } : null,
        });

        // Parse markdown to slides
        const slides = parseMarkdownToSlides(slideContent.markdown);

        // Generate slide content file for nano banana
        const slideContentFile = generateSlideContentFile({
          theme: session.theme,
          twin1: { name: twin1.name, description: twin1.description, personality: twin1.personality },
          twin2: { name: twin2.name, description: twin2.description, personality: twin2.personality },
          dialogues: dialogues.map(d => ({
            speaker: d.speakerTwinId === twin1.id ? twin1.name : twin2.name,
            content: d.content,
          })),
          result: result ? {
            compatibilityScore: result.compatibilityScore ? parseInt(result.compatibilityScore) : 0,
            summary: result.summary || "",
            collaborationPotential: result.collaborationPotential || "",
            strengths: result.strengths || [],
            challenges: result.challenges || [],
            recommendations: result.recommendations || [],
            roleDistribution: result.roleDistribution || "",
            timeline: result.timeline || "",
            resources: result.resources || "",
            kpis: result.kpis || "",
            nextSteps: result.nextSteps || "",
            detailedAnalysis: result.detailedAnalysis || "",
          } : null,
        }, slides);

        return {
          slideContentFile,
          slideCount: slides.length,
          slides,
          theme: session.theme,
          twin1Name: twin1.name,
          twin2Name: twin2.name,
          compatibilityScore: result?.compatibilityScore ? parseInt(result.compatibilityScore) : 0,
        };
      }),

    exportPptx: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const session = await getMatchingSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const twin1 = await getDigitalTwinById(session.twin1Id);
        const twin2 = await getDigitalTwinById(session.twin2Id);
        const dialogues = await getMatchingDialoguesBySession(input.sessionId);
        const result = await getMatchingResultBySession(input.sessionId);

        if (!twin1 || !twin2) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Generate slide content
        const slideContent = await generatePresentationContent({
          theme: session.theme,
          twin1: { name: twin1.name, description: twin1.description, personality: twin1.personality },
          twin2: { name: twin2.name, description: twin2.description, personality: twin2.personality },
          dialogues: dialogues.map(d => ({
            speaker: d.speakerTwinId === twin1.id ? twin1.name : twin2.name,
            content: d.content,
          })),
          result: result ? {
            compatibilityScore: result.compatibilityScore ? parseInt(result.compatibilityScore) : 0,
            summary: result.summary || "",
            collaborationPotential: result.collaborationPotential || "",
            strengths: result.strengths || [],
            challenges: result.challenges || [],
            recommendations: result.recommendations || [],
            roleDistribution: result.roleDistribution || "",
            timeline: result.timeline || "",
            resources: result.resources || "",
            kpis: result.kpis || "",
            nextSteps: result.nextSteps || "",
            detailedAnalysis: result.detailedAnalysis || "",
          } : null,
        });

        // Parse markdown to slides
        const slides = parseMarkdownToSlides(slideContent.markdown);

        // Generate PPTX
        const { generatePptx } = await import("./services/pptxGenerator");
        const pptxBuffer = await generatePptx({
          theme: session.theme,
          twin1Name: twin1.name,
          twin2Name: twin2.name,
          compatibilityScore: result?.compatibilityScore ? parseInt(result.compatibilityScore) : 0,
          slides,
        });

        // Upload to S3
        const filename = `presentations/matching-${input.sessionId}-${Date.now()}.pptx`;
        const { url } = await storagePut(filename, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation");

        return { url, filename };
      }),
  }),

  // ============ Plan & Usage ============
  plan: router({
    getStats: protectedProcedure.query(async ({ ctx }) => {
      const plan = (ctx.user.plan || "free") as PlanType;
      return getUserStats(ctx.user.id, plan);
    }),

    getInfo: protectedProcedure.query(async ({ ctx }) => {
      const plan = (ctx.user.plan || "free") as PlanType;
      const stats = await getUserStats(ctx.user.id, plan);
      return { ...stats, plan };
    }),

    getUsage: protectedProcedure.query(async ({ ctx }) => {
      const { getUserUsage } = await import("./db");
      const usage = await getUserUsage(ctx.user.id);
      return usage || { id: 0, userId: ctx.user.id, matchingsThisMonth: 0, lastResetAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    }),

    getFriendCode: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.friendCode) {
        return { friendCode: ctx.user.friendCode };
      }
      // Generate new friend code
      const code = await generateFriendCode();
      await setUserFriendCode(ctx.user.id, code);
      return { friendCode: code };
    }),

    createCheckoutSession: protectedProcedure
      .input(z.object({
        plan: z.enum(["premium", "enterprise"]),
        interval: z.enum(["monthly", "yearly"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createCheckoutSession } = await import("./stripe/stripe");
        
        const origin = ctx.req.headers.origin || "https://bunshin-ai.manus.space";
        const result = await createCheckoutSession({
          userId: ctx.user.id,
          userEmail: ctx.user.email || "",
          userName: ctx.user.name || "",
          plan: input.plan,
          interval: input.interval,
          successUrl: `${origin}/plan?success=true`,
          cancelUrl: `${origin}/plan?canceled=true`,
          customerId: ctx.user.stripeCustomerId || undefined,
        });

        if (!result) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "決済セッションの作成に失敗しました",
          });
        }

        return { url: result.url, sessionId: result.sessionId };
      }),

    createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.stripeCustomerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "サブスクリプションがありません",
        });
      }

      const { createPortalSession } = await import("./stripe/stripe");
      const origin = ctx.req.headers.origin || "https://bunshin-ai.manus.space";
      
      const result = await createPortalSession({
        customerId: ctx.user.stripeCustomerId,
        returnUrl: `${origin}/plan`,
      });

      if (!result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "ポータルセッションの作成に失敗しました",
        });
      }

      return { url: result.url };
    }),

    getSubscription: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.stripeSubscriptionId) {
        return null;
      }

      const { getSubscription } = await import("./stripe/stripe");
      const subscription = await getSubscription(ctx.user.stripeSubscriptionId);
      
      if (!subscription) return null;

      // Get current period end from first subscription item
      const firstItem = subscription.items.data[0];
      const currentPeriodEnd = firstItem?.current_period_end || Math.floor(Date.now() / 1000);

      return {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(currentPeriodEnd * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    }),

    upgrade: protectedProcedure
      .input(z.object({
        plan: z.enum(["free", "premium", "enterprise"]),
      }))
      .mutation(async ({ ctx, input }) => {
        // In a real app, this would integrate with a payment system
        await updateUserPlan(ctx.user.id, input.plan);
        return { success: true, plan: input.plan };
      }),
  }),

  // ============ Points System ============
  points: router({
    // ポイント残高を取得
    getBalance: protectedProcedure.query(async ({ ctx }) => {
      const userPoint = await getUserPoints(ctx.user.id);
      return {
        balance: userPoint.balance,
        totalEarned: userPoint.totalEarned,
        totalSpent: userPoint.totalSpent,
        totalExpired: userPoint.totalExpired,
        lastActivityAt: userPoint.lastActivityAt,
        expiresAt: userPoint.expiresAt,
      };
    }),

    // ポイント取引履歴を取得
    getTransactions: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return getPointTransactions(ctx.user.id, input?.limit ?? 50);
      }),

    // ポイントを手動で付与（テスト用）
    award: protectedProcedure
      .input(z.object({
        actionType: z.string(),
        referenceId: z.string().optional(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return awardPoints(ctx.user.id, input.actionType, input.referenceId, input.description);
      }),

    // 交換可能な製品一覧を取得
    getProducts: protectedProcedure.query(async () => {
      return getRedeemableProducts();
    }),

    // 製品をポイントで交換
    redeemProduct: protectedProcedure
      .input(z.object({
        productId: z.number(),
        shippingInfo: z.object({
          name: z.string().optional(),
          address: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          notes: z.string().optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return redeemProduct(ctx.user.id, input.productId, input.shippingInfo);
      }),

    // 交換履歴を取得
    getRedemptions: protectedProcedure.query(async ({ ctx }) => {
      return getUserRedemptions(ctx.user.id);
    }),

    // ポイント設定を取得（管理者用）
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      }
      return getAllPointSettings();
    }),

    // ポイント設定を更新（管理者用）
    updateSetting: protectedProcedure
      .input(z.object({
        actionType: z.string(),
        points: z.number().min(0),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
        }
        await updatePointSetting(input.actionType, input.points, input.isActive);
        return { success: true };
      }),

    // ポイント設定を初期化（管理者用）
    initializeSettings: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      }
      await initializePointSettings();
      await initializeProducts();
      return { success: true };
    }),

    // ポイントアクション一覧を取得
    getActionTypes: protectedProcedure.query(async () => {
      return Object.values(POINT_ACTIONS);
    }),
    
    // クエスト一覧を取得
    getQuests: protectedProcedure.query(async ({ ctx }) => {
      return getQuestList(ctx.user.id);
    }),
    
    // デイリーログインボーナスをチェック・付与
    checkDailyLogin: protectedProcedure.mutation(async ({ ctx }) => {
      return checkDailyLogin(ctx.user.id);
    }),
    
    // マイルストーンをチェック
    checkMilestones: protectedProcedure.mutation(async ({ ctx }) => {
      const chatMilestones = await checkAndAwardMilestones(ctx.user.id);
      const matchingMilestones = await checkMatchingMilestones(ctx.user.id);
      
      return {
        awarded: [...chatMilestones.awarded, ...matchingMilestones.awarded],
      };
    }),
  }),

  // ============ Clawdbot連携 ============
  clawdbot: router({
    // 接続設定を取得
    getConnection: protectedProcedure.query(async ({ ctx }) => {
      const { getClawdbotConnection } = await import("./services/clawdbotService");
      return getClawdbotConnection(ctx.user.id);
    }),

    // 接続を作成
    createConnection: protectedProcedure
      .input(z.object({
        gatewayUrl: z.string().url(),
        authToken: z.string().optional(),
        agentId: z.string().optional(),
        settings: z.object({
          enableMemorySync: z.boolean().optional(),
          enableSkillAccess: z.boolean().optional(),
          enableChannelBridge: z.boolean().optional(),
          preferredModel: z.string().optional(),
          sessionPersistence: z.boolean().optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createClawdbotConnection } = await import("./services/clawdbotService");
        
        // ユーザーの分身AIを取得
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "分身AIを先に作成してください",
          });
        }
        
        const connectionId = await createClawdbotConnection(
          ctx.user.id,
          twin.id,
          input.gatewayUrl,
          input.authToken,
          input.agentId || "main",
          input.settings
        );
        
        // 外部AI接続ポイントを付与
        await awardPoints(ctx.user.id, "external_ai_connect", `clawdbot_${connectionId}`, "Clawdbot接続");
        
        return { success: true, connectionId };
      }),

    // 接続を更新
    updateConnection: protectedProcedure
      .input(z.object({
        gatewayUrl: z.string().url().optional(),
        authToken: z.string().optional(),
        agentId: z.string().optional(),
        settings: z.object({
          enableMemorySync: z.boolean().optional(),
          enableSkillAccess: z.boolean().optional(),
          enableChannelBridge: z.boolean().optional(),
          preferredModel: z.string().optional(),
          sessionPersistence: z.boolean().optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateClawdbotConnection } = await import("./services/clawdbotService");
        await updateClawdbotConnection(ctx.user.id, input);
        return { success: true };
      }),

    // 接続をテスト
    testConnection: protectedProcedure.mutation(async ({ ctx }) => {
      const { testClawdbotConnection } = await import("./services/clawdbotService");
      return testClawdbotConnection(ctx.user.id);
    }),

    // メッセージを送信
    sendMessage: protectedProcedure
      .input(z.object({
        message: z.string().min(1),
        sessionKey: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { sendMessageViaClawdbot } = await import("./services/clawdbotService");
        return sendMessageViaClawdbot(ctx.user.id, input.message, input.sessionKey);
      }),

    // メッセージ履歴を取得
    getMessageHistory: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { getClawdbotMessageHistory } = await import("./services/clawdbotService");
        return getClawdbotMessageHistory(ctx.user.id, input?.limit ?? 50);
      }),

    // 利用可能なモデル一覧を取得
    getModels: protectedProcedure.query(async ({ ctx }) => {
      const { getClawdbotModels } = await import("./services/clawdbotService");
      return getClawdbotModels(ctx.user.id);
    }),

    // 接続を削除
    deleteConnection: protectedProcedure.mutation(async ({ ctx }) => {
      const { deleteClawdbotConnection } = await import("./services/clawdbotService");
      const result = await deleteClawdbotConnection(ctx.user.id);
      return { success: result };
    }),

    // ============ 会話学習機能 ============
    
    // 会話を同期（Clawdbotメッセージログから学習用スニペットを作成）
    syncConversations: protectedProcedure.mutation(async ({ ctx }) => {
      const { syncClawdbotConversations } = await import("./services/conversationLearningService");
      return syncClawdbotConversations(ctx.user.id);
    }),

    // 学習状況を取得
    getLearningStatus: protectedProcedure.query(async ({ ctx }) => {
      const { getLearningStatus } = await import("./services/conversationLearningService");
      return getLearningStatus(ctx.user.id);
    }),

    // 手動で人格分析を実行
    analyzePersonality: protectedProcedure.mutation(async ({ ctx }) => {
      const { analyzeAndUpdatePersonality, getOrCreateConversationLearning } = await import("./services/conversationLearningService");
      
      // ユーザーの分身AIを取得
      const twin = await getDigitalTwinByUser(ctx.user.id);
      if (!twin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "分身AIを先に作成してください",
        });
      }
      
      // 学習データを初期化
      await getOrCreateConversationLearning(ctx.user.id, twin.id);
      
      // 分析を実行
      return analyzeAndUpdatePersonality(ctx.user.id, twin.id);
    }),

    // 学習設定を更新
    updateLearningSettings: protectedProcedure
      .input(z.object({
        autoLearnEnabled: z.boolean().optional(),
        learningThreshold: z.number().min(5).max(100).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateLearningSettings } = await import("./services/conversationLearningService");
        return updateLearningSettings(ctx.user.id, input);
      }),

    // グループ会話を記録（Clawdbotからのwebhook用）
    recordGroupMessage: protectedProcedure
      .input(z.object({
        groupId: z.string(),
        groupName: z.string().optional(),
        speakerType: z.enum(["self", "other"]),
        message: z.string(),
        speakerName: z.string().optional(),
        replyToId: z.number().optional(),
        threadContext: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { recordGroupConversation } = await import("./services/conversationLearningService");
        
        // ユーザーの分身AIを取得
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "分身AIを先に作成してください",
          });
        }
        
        const id = await recordGroupConversation(
          ctx.user.id,
          twin.id,
          input.groupId,
          input.groupName,
          input.speakerType,
          input.message,
          input.speakerName,
          input.replyToId,
          input.threadContext
        );
        
        return { success: true, id };
      }),

    // 学習した人格特性を取得
    getLearnedTraits: protectedProcedure.query(async ({ ctx }) => {
      const { getOrCreateConversationLearning } = await import("./services/conversationLearningService");
      
      const twin = await getDigitalTwinByUser(ctx.user.id);
      if (!twin) {
        return null;
      }
      
      const learning = await getOrCreateConversationLearning(ctx.user.id, twin.id);
      return learning?.learnedTraits || null;
    }),
  }),

  // ============ AI Provider Management (管理者専用) ============
  aiProvider: router({
    // 利用可能なプロバイダー一覧を取得
    getAvailableProviders: protectedProcedure.query(async ({ ctx }) => {
      // 管理者のみ
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: '管理者権限が必要です' });
      }
      const { getAvailableProviders } = await import("./services/aiProviderService");
      return getAvailableProviders();
    }),

    // 現在の機能別プロバイダー設定を取得
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: '管理者権限が必要です' });
      }
      const { getAllProviderSettings } = await import("./services/aiProviderService");
      return getAllProviderSettings();
    }),

    // 機能別プロバイダー設定を更新
    updateSetting: protectedProcedure
      .input(z.object({
        feature: z.enum(['chat', 'personality', 'value_scenario', 'matching', 'memory', 'prediction', 'default']),
        provider: z.enum(['manus', 'gemini', 'openai', 'anthropic', 'grok']),
        model: z.string().optional(),
        maxTokens: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: '管理者権限が必要です' });
        }
        const { setProviderForFeature } = await import("./services/aiProviderService");
        setProviderForFeature(input.feature, {
          provider: input.provider,
          model: input.model,
          maxTokens: input.maxTokens,
        });
        return { success: true };
      }),

    // プロバイダーの接続テスト
    testProvider: protectedProcedure
      .input(z.object({
        provider: z.enum(['manus', 'gemini', 'openai', 'anthropic', 'grok']),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: '管理者権限が必要です' });
        }
        const { testProvider } = await import("./services/aiProviderService");
        return testProvider(input.provider);
      }),
  }),

  // ============ LINE連携 ============
  line: router({
    // LINE連携状態を取得
    getConnection: protectedProcedure.query(async ({ ctx }) => {
      const { getLineConnectionByUserId } = await import("./services/lineService");
      return getLineConnectionByUserId(ctx.user.id);
    }),

    // 連携コードでLINEを紐付け
    linkByCode: protectedProcedure
      .input(z.object({
        code: z.string().length(6),
      }))
      .mutation(async ({ ctx, input }) => {
        const { linkByCode } = await import("./services/lineService");
        
        // ユーザーの分身AIを取得
        const twin = await getDigitalTwinByUser(ctx.user.id);
        if (!twin) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "分身AIを先に作成してください",
          });
        }
        
        const result = await linkByCode(input.code, ctx.user.id, twin.id);
        if (!result.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error || "連携に失敗しました",
          });
        }
        
        return { success: true };
      }),

    // LINE連携を解除
    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      const { getLineConnectionByUserId, disconnectLine } = await import("./services/lineService");
      
      const connection = await getLineConnectionByUserId(ctx.user.id);
      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "LINE連携が見つかりません",
        });
      }
      
      await disconnectLine(connection.lineUserId);
      return { success: true };
    }),

    // LINEメッセージ履歴を取得
    getMessageHistory: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(50),
      }))
      .query(async ({ ctx, input }) => {
        const { getLineMessageHistory } = await import("./services/lineService");
        return getLineMessageHistory(ctx.user.id, input.limit);
      }),

    // LINE連携設定を更新
    updateSettings: protectedProcedure
      .input(z.object({
        receiveHeartbeat: z.boolean().optional(),
        receiveNotifications: z.boolean().optional(),
        allowVoiceMessages: z.boolean().optional(),
        language: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        
        const { lineConnections } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        const [connection] = await db
          .select()
          .from(lineConnections)
          .where(eq(lineConnections.userId, ctx.user.id))
          .limit(1);
        
        if (!connection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "LINE連携が見つかりません",
          });
        }
        
        const currentSettings = (connection.settings || {
          receiveHeartbeat: true,
          receiveNotifications: true,
          allowVoiceMessages: true,
          language: "ja",
        }) as {
          receiveHeartbeat: boolean;
          receiveNotifications: boolean;
          allowVoiceMessages: boolean;
          language: string;
        };
        
        const updatedSettings = {
          ...currentSettings,
          ...input,
        };
        
        await db
          .update(lineConnections)
          .set({ settings: updatedSettings as any })
          .where(eq(lineConnections.userId, ctx.user.id));
        
        return { success: true };
      }),

    // LINE連携を一時停止/再開
    toggleStatus: protectedProcedure
      .input(z.object({
        status: z.enum(["active", "paused"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        
        const { lineConnections } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        await db
          .update(lineConnections)
          .set({ status: input.status })
          .where(eq(lineConnections.userId, ctx.user.id));
        
        return { success: true };
      }),
  }),

  // ============ NFC名刺（カード）システム ============
  cards: router({
    // カードをコードで取得（公開API）
    getByCode: publicProcedure
      .input(z.object({ code: z.string() }))
      .query(async ({ input }) => {
        const { getCardByCode, incrementCardScans } = await import("./db");
        const card = await getCardByCode(input.code);
        if (!card) {
          throw new TRPCError({ code: "NOT_FOUND", message: "カードが見つかりません" });
        }
        // スキャン回数をインクリメント
        await incrementCardScans(card.id);
        return card;
      }),

    // ユーザーが取得したカード一覧
    getMyCards: protectedProcedure
      .input(z.object({
        cardType: z.string().optional(),
        favoritesOnly: z.boolean().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const { getUserCards, getUserCardsByType, getFavoriteUserCards } = await import("./db");
        
        if (input?.favoritesOnly) {
          return getFavoriteUserCards(ctx.user.id);
        }
        if (input?.cardType) {
          return getUserCardsByType(ctx.user.id, input.cardType);
        }
        return getUserCards(ctx.user.id);
      }),

    // カードを取得（保存）
    acquire: protectedProcedure
      .input(z.object({
        code: z.string(),
        method: z.enum(["nfc_scan", "qr_scan", "link", "manual"]).default("nfc_scan"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getCardByCode, addUserCard, incrementCardSaves, hasUserCard } = await import("./db");
        
        const card = await getCardByCode(input.code);
        if (!card) {
          throw new TRPCError({ code: "NOT_FOUND", message: "カードが見つかりません" });
        }
        
        // 既に持っているか確認
        const alreadyHas = await hasUserCard(ctx.user.id, card.id);
        if (alreadyHas) {
          throw new TRPCError({ code: "CONFLICT", message: "このカードは既に取得済みです" });
        }
        
        // カードを追加
        const userCard = await addUserCard({
          userId: ctx.user.id,
          cardId: card.id,
          acquiredMethod: input.method,
        });
        
        if (!userCard) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "カードの取得に失敗しました" });
        }
        
        // 保存回数をインクリメント
        await incrementCardSaves(card.id);
        
        return { success: true, card };
      }),

    // ユーザーカードを更新（メモ、タグ、お気に入り）
    updateUserCard: protectedProcedure
      .input(z.object({
        cardId: z.number(),
        memo: z.string().optional(),
        tags: z.array(z.string()).optional(),
        isFavorite: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateUserCard, hasUserCard } = await import("./db");
        
        const has = await hasUserCard(ctx.user.id, input.cardId);
        if (!has) {
          throw new TRPCError({ code: "NOT_FOUND", message: "カードが見つかりません" });
        }
        
        await updateUserCard(ctx.user.id, input.cardId, {
          memo: input.memo,
          tags: input.tags,
          isFavorite: input.isFavorite !== undefined ? (input.isFavorite ? 1 : 0) : undefined,
        });
        
        return { success: true };
      }),

    // ユーザーカードを削除
    removeUserCard: protectedProcedure
      .input(z.object({ cardId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { removeUserCard } = await import("./db");
        await removeUserCard(ctx.user.id, input.cardId);
        return { success: true };
      }),

    // 自分のカード（名刺）を作成
    createMyCard: protectedProcedure
      .input(z.object({
        cardType: z.enum(["business_card", "shop_card", "idol_sign", "membership", "event", "other"]).default("business_card"),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        contactInfo: z.object({
          email: z.string().optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          address: z.string().optional(),
          twitter: z.string().optional(),
          instagram: z.string().optional(),
          facebook: z.string().optional(),
          linkedin: z.string().optional(),
          line: z.string().optional(),
          custom: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        }).optional(),
        businessInfo: z.object({
          company: z.string().optional(),
          position: z.string().optional(),
          department: z.string().optional(),
          industry: z.string().optional(),
        }).optional(),
        customFields: z.array(z.object({
          label: z.string(),
          value: z.string(),
          type: z.enum(["text", "url", "email", "phone"]).optional(),
        })).optional(),
        isPublic: z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createCard, generateUniqueCardCode } = await import("./db");
        
        const code = await generateUniqueCardCode();
        
        const card = await createCard({
          code,
          ownerUserId: ctx.user.id,
          cardType: input.cardType,
          title: input.title,
          subtitle: input.subtitle || null,
          description: input.description || null,
          imageUrl: input.imageUrl || null,
          contactInfo: input.contactInfo || null,
          businessInfo: input.businessInfo || null,
          customFields: input.customFields || null,
          isPublic: input.isPublic ? 1 : 0,
        });
        
        if (!card) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "カードの作成に失敗しました" });
        }
        
        return card;
      }),

    // 自分のカード一覧を取得
    getOwnedCards: protectedProcedure.query(async ({ ctx }) => {
      const { getCardsByOwner } = await import("./db");
      return getCardsByOwner(ctx.user.id);
    }),

    // 自分のカードをIDで取得
    getOwnedCardById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCardById } = await import("./db");
        const card = await getCardById(input.id);
        if (!card || card.ownerUserId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "カードが見つかりません" });
        }
        return card;
      }),

    // 名刺画像をアップロード
    uploadCardImage: protectedProcedure
      .input(z.object({
        filename: z.string(),
        content: z.string(), // base64 encoded
        mimeType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.content, "base64");
        const fileKey = `cards/${ctx.user.id}/${nanoid()}-${input.filename}`;
        
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        return { url };
      }),

    // AI/PDFデータから名刺情報を抽出
    extractCardInfo: protectedProcedure
      .input(z.object({
        filename: z.string(),
        content: z.string(), // base64 encoded
        mimeType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.content, "base64");
        const fileKey = `cards/temp/${ctx.user.id}/${nanoid()}-${input.filename}`;
        
        // ファイルをS3にアップロード
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        
        // LLMで名刺情報を抽出
        const extractionPrompt = `以下の名刺データから情報を抽出してください。

ファイル名: ${input.filename}
MIMEタイプ: ${input.mimeType}

以下のJSON形式で出力してください:
{
  "title": "名前",
  "subtitle": "役職",
  "company": "会社名",
  "department": "部署",
  "position": "役職",
  "email": "メールアドレス",
  "phone": "電話番号",
  "website": "ウェブサイト",
  "address": "住所",
  "description": "説明・自己紹介"
}

値がない場合はnullを設定してください。`;

        try {
          // 画像の場合はLLMに画像を送信
          let messages: any[] = [];
          
          if (input.mimeType.startsWith("image/")) {
            messages = [
              { role: "system", content: "あなたは名刺情報を抽出するアシスタントです。画像から名刺情報を読み取り、JSON形式で出力してください。" },
              { 
                role: "user", 
                content: [
                  { type: "text", text: extractionPrompt },
                  { type: "image_url", image_url: { url } }
                ]
              }
            ];
          } else if (input.mimeType === "application/pdf") {
            messages = [
              { role: "system", content: "あなたは名刺情報を抽出するアシスタントです。PDFから名刺情報を読み取り、JSON形式で出力してください。" },
              { 
                role: "user", 
                content: [
                  { type: "text", text: extractionPrompt },
                  { type: "file_url", file_url: { url, mime_type: "application/pdf" } }
                ]
              }
            ];
          } else {
            // その他のファイルタイプ
            messages = [
              { role: "system", content: "あなたは名刺情報を抽出するアシスタントです。" },
              { role: "user", content: extractionPrompt }
            ];
          }

          const response = await invokeLLM({
            messages,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "card_info",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    title: { type: ["string", "null"] },
                    subtitle: { type: ["string", "null"] },
                    company: { type: ["string", "null"] },
                    department: { type: ["string", "null"] },
                    position: { type: ["string", "null"] },
                    email: { type: ["string", "null"] },
                    phone: { type: ["string", "null"] },
                    website: { type: ["string", "null"] },
                    address: { type: ["string", "null"] },
                    description: { type: ["string", "null"] },
                  },
                  required: ["title", "subtitle", "company", "department", "position", "email", "phone", "website", "address", "description"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = response.choices[0]?.message?.content;
          if (!content || typeof content !== 'string') {
            throw new Error("抽出に失敗しました");
          }

          const cardInfo = JSON.parse(content);
          return { ...cardInfo, imageUrl: url };
        } catch (error) {
          console.error("Card info extraction error:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "名刺情報の抽出に失敗しました" });
        }
      }),

    // AIアシストモード: テキストから名刺情報を構造化
    parseCardText: protectedProcedure
      .input(z.object({
        text: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const parsePrompt = `以下のテキストから名刺情報を抽出してください。

テキスト:
${input.text}

以下のJSON形式で出力してください:
{
  "title": "名前",
  "subtitle": "役職・キャッチコピー",
  "company": "会社名",
  "department": "部署",
  "position": "役職",
  "email": "メールアドレス",
  "phone": "電話番号",
  "website": "ウェブサイト",
  "address": "住所",
  "twitter": "Twitter/Xアカウント",
  "instagram": "Instagramアカウント",
  "line": "LINE ID",
  "description": "説明・自己紹介",
  "industry": "業種"
}

値がない場合はnullを設定してください。テキストから読み取れる情報のみを抽出し、推測はしないでください。`;

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "あなたは名刺情報を構造化するアシスタントです。ユーザーが入力したテキストから名刺情報を抽出し、JSON形式で出力してください。" },
              { role: "user", content: parsePrompt }
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "card_info",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    title: { type: ["string", "null"] },
                    subtitle: { type: ["string", "null"] },
                    company: { type: ["string", "null"] },
                    department: { type: ["string", "null"] },
                    position: { type: ["string", "null"] },
                    email: { type: ["string", "null"] },
                    phone: { type: ["string", "null"] },
                    website: { type: ["string", "null"] },
                    address: { type: ["string", "null"] },
                    twitter: { type: ["string", "null"] },
                    instagram: { type: ["string", "null"] },
                    line: { type: ["string", "null"] },
                    description: { type: ["string", "null"] },
                    industry: { type: ["string", "null"] },
                  },
                  required: ["title", "subtitle", "company", "department", "position", "email", "phone", "website", "address", "twitter", "instagram", "line", "description", "industry"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = response.choices[0]?.message?.content;
          if (!content || typeof content !== 'string') {
            throw new Error("解析に失敗しました");
          }

          return JSON.parse(content);
        } catch (error) {
          console.error("Card text parsing error:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "テキストの解析に失敗しました" });
        }
      }),

    // 自分のカードを更新
    updateMyCard: protectedProcedure
      .input(z.object({
        cardId: z.number(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        contactInfo: z.object({
          email: z.string().optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          address: z.string().optional(),
          twitter: z.string().optional(),
          instagram: z.string().optional(),
          facebook: z.string().optional(),
          linkedin: z.string().optional(),
          line: z.string().optional(),
          custom: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        }).optional(),
        businessInfo: z.object({
          company: z.string().optional(),
          position: z.string().optional(),
          department: z.string().optional(),
          industry: z.string().optional(),
        }).optional(),
        customFields: z.array(z.object({
          label: z.string(),
          value: z.string(),
          type: z.enum(["text", "url", "email", "phone"]).optional(),
        })).optional(),
        isPublic: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getCardById, updateCard } = await import("./db");
        
        const card = await getCardById(input.cardId);
        if (!card || card.ownerUserId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "カードが見つかりません" });
        }
        
        await updateCard(input.cardId, {
          title: input.title,
          subtitle: input.subtitle,
          description: input.description,
          imageUrl: input.imageUrl,
          contactInfo: input.contactInfo,
          businessInfo: input.businessInfo,
          customFields: input.customFields,
          isPublic: input.isPublic !== undefined ? (input.isPublic ? 1 : 0) : undefined,
        });
        
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

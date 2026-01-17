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
      return getDigitalTwinByUser(ctx.user.id);
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

        const id = await upsertDigitalTwin(ctx.user.id, {
          name: input.name,
          rawInput: input.rawInput,
          description,
          personality,
          systemPrompt,
          status: "active",
        });
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
        await updateTwinPublicSettings(twin.id, input.isPublic, input.publicBio, input.tags);
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
        await upsertAiApiConfig({
          userId: ctx.user.id,
          ...input,
        });
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
          const response1 = await orchestrator1.generateMatchingDialogue(
            friendTwin,
            knowledge2,
            input.theme,
            dialogues,
            true,
          );
          
          dialogues.push({ speaker: myTwin.name, content: response1 });
          await addMatchingDialogue({
            sessionId,
            speakerTwinId: myTwin.id,
            content: response1,
            aiProvider: "builtin",
            turnNumber: turn * 2,
          });

          // Twin2の発言
          const response2 = await orchestrator2.generateMatchingDialogue(
            myTwin,
            knowledge1,
            input.theme,
            dialogues,
            false,
          );
          
          dialogues.push({ speaker: friendTwin.name, content: response2 });
          await addMatchingDialogue({
            sessionId,
            speakerTwinId: friendTwin.id,
            content: response2,
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

重要: ふんわりした要約ではなく、以下の点を具体的に記載してください：
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
1. この2人が協業する場合の具体的なプロジェクト名と内容
2. 各自の役割分担（誰が何を担当するか）
3. 具体的なタイムライン（Week1, Week2-4, Month2-3で何をするか）
4. 必要なリソースや投資
5. 期待される成果とKPI
6. リスクとその対策
7. 明日からできる具体的なアクション`,
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
                required: ["compatibilityScore", "summary", "collaborationPotential", "strengths", "challenges", "recommendations", "roleDistribution", "timeline", "resources", "kpis", "nextSteps", "detailedAnalysis"],
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
          const response1 = await orchestrator1.generateMatchingDialogue(
            twin2,
            knowledge2,
            session.theme,
            dialogues,
            true,
          );
          
          dialogues.push({ speaker: twin1.name, content: response1 });
          await addMatchingDialogue({
            sessionId: input.sessionId,
            speakerTwinId: twin1.id,
            content: response1,
            aiProvider: "builtin",
            turnNumber: turn * 2,
          });

          // Twin2の発言
          const response2 = await orchestrator2.generateMatchingDialogue(
            twin1,
            knowledge1,
            session.theme,
            dialogues,
            false,
          );
          
          dialogues.push({ speaker: twin2.name, content: response2 });
          await addMatchingDialogue({
            sessionId: input.sessionId,
            speakerTwinId: twin2.id,
            content: response2,
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
});

export type AppRouter = typeof appRouter;

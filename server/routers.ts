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
} from "./db";
import { storagePut } from "./storage";
import { createOrchestratorForUser } from "./services/aiOrchestrator";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";
import { notifyOwner } from "./_core/notification";

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
        // Find user by friend code (first 8 chars of openId)
        const allUsers = await searchUsers("", ctx.user.id);
        const friend = allUsers.find(u => u.openId.startsWith(input.friendCode));
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
      }))
      .mutation(async ({ ctx, input }) => {
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

        const id = await createMatchingSession({
          initiatorUserId: ctx.user.id,
          twin1Id: myTwin.id,
          twin2Id: friendTwin.id,
          theme: input.theme,
        });

        return { id };
      }),

    runDialogue: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        turns: z.number().min(1).max(10).default(5),
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
  }),
});

export type AppRouter = typeof appRouter;

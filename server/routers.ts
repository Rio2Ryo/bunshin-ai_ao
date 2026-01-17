import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getUserProfile, upsertUserProfile,
  createDigitalTwin, getDigitalTwinsByUser, getDigitalTwinById, updateDigitalTwin, deleteDigitalTwin,
  addKnowledgeEntry, getKnowledgeByTwin, deleteKnowledgeEntry,
  createUploadedFile, getUploadedFilesByUser, updateUploadedFileStatus,
  getAiApiConfigs, upsertAiApiConfig, deleteAiApiConfig,
  getOrchestrationRoles, createOrchestrationRole, updateOrchestrationRole, deleteOrchestrationRole,
  createChatSession, getChatSessionsByUser, getChatSessionById,
  addChatMessage, getChatMessagesBySession,
  createMatchingSession, getMatchingSessionsByTwin, getAllMatchingSessions, getMatchingSessionById, updateMatchingSessionStatus,
  addMatchingDialogue, getMatchingDialoguesBySession,
  createMatchingResult, getMatchingResultBySession,
} from "./db";
import { storagePut } from "./storage";
import { createOrchestratorForUser } from "./services/aiOrchestrator";
import { invokeLLM } from "./_core/llm";
import { nanoid } from "nanoid";

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

  // ============ Digital Twins ============
  twins: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getDigitalTwinsByUser(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.id);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return twin;
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        rawInput: z.string().optional(),
        description: z.string().optional(),
        personality: z.string().optional(),
        systemPrompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        let description = input.description;
        let personality = input.personality;
        let systemPrompt = input.systemPrompt;

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
              description = parsed.description || description;
              personality = parsed.personality || personality;
              systemPrompt = parsed.systemPrompt || systemPrompt;
            }
          } catch (error) {
            console.error("Failed to process rawInput with LLM:", error);
            // エラー時はそのまま保存
            description = input.rawInput;
          }
        }

        const id = await createDigitalTwin({
          userId: ctx.user.id,
          name: input.name,
          description,
          personality,
          systemPrompt,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        personality: z.string().optional(),
        systemPrompt: z.string().optional(),
        status: z.enum(["active", "inactive", "training"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.id);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const { id, ...data } = input;
        await updateDigitalTwin(id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.id);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await deleteDigitalTwin(input.id);
        return { success: true };
      }),
  }),

  // ============ Knowledge Base ============
  knowledge: router({
    list: protectedProcedure
      .input(z.object({ twinId: z.number() }))
      .query(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.twinId);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return getKnowledgeByTwin(input.twinId);
      }),

    add: protectedProcedure
      .input(z.object({
        twinId: z.number(),
        sourceType: z.enum(["upload", "api", "manual"]),
        sourceId: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.twinId);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const id = await addKnowledgeEntry(input);
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number(), twinId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.twinId);
        if (!twin || twin.userId !== ctx.user.id) {
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
        twinId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.content, "base64");
        const fileKey = `${ctx.user.id}/uploads/${nanoid()}-${input.filename}`;
        
        const result = await storagePut(fileKey, buffer, input.mimeType);
        const url = result.url;
        
        const id = await createUploadedFile({
          userId: ctx.user.id,
          twinId: input.twinId,
          filename: input.filename,
          fileKey,
          url,
          mimeType: input.mimeType,
          size: buffer.length,
          status: "pending",
        });

        return { id, url };
      }),

    process: protectedProcedure
      .input(z.object({
        fileId: z.number(),
        twinId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.twinId);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        await updateUploadedFileStatus(input.fileId, "processing");

        // ファイルの内容を取得して解析（簡易実装）
        const files = await getUploadedFilesByUser(ctx.user.id);
        const file = files.find(f => f.id === input.fileId);
        
        if (!file) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        try {
          const knowledge = await getKnowledgeByTwin(input.twinId);
          const orchestrator = await createOrchestratorForUser(ctx.user.id, twin, knowledge);
          
          // ファイル内容を取得（URLからfetch）
          const response = await fetch(file.url);
          const content = await response.text();
          
          const analysis = await orchestrator.analyzeDocument(content, file.filename);
          
          await addKnowledgeEntry({
            twinId: input.twinId,
            sourceType: "upload",
            sourceId: String(file.id),
            title: analysis.title,
            content: content.substring(0, 50000),
            summary: analysis.summary,
            metadata: { keyPoints: analysis.keyPoints, filename: file.filename },
          });

          await updateUploadedFileStatus(input.fileId, "completed");
          return { success: true, analysis };
        } catch (error) {
          await updateUploadedFileStatus(input.fileId, "failed");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "File processing failed" });
        }
      }),
  }),

  // ============ AI API Config ============
  aiConfig: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const configs = await getAiApiConfigs(ctx.user.id);
      // APIキーは一部マスク
      return configs.map(c => ({
        ...c,
        apiKey: c.apiKey.substring(0, 8) + "..." + c.apiKey.substring(c.apiKey.length - 4),
      }));
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
      .input(z.object({
        provider: z.enum(["openai", "gemini", "anthropic", "grok"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await deleteAiApiConfig(ctx.user.id, input.provider);
        return { success: true };
      }),
  }),

  // ============ Orchestration Roles ============
  orchestration: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getOrchestrationRoles(ctx.user.id);
    }),

    create: protectedProcedure
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

    update: protectedProcedure
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

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteOrchestrationRole(input.id);
        return { success: true };
      }),

    getSettings: protectedProcedure.query(async ({ ctx }) => {
      const roles = await getOrchestrationRoles(ctx.user.id);
      const taskAssignments: Record<string, string> = {
        conversation: "builtin",
        analysis: "builtin",
        knowledge: "builtin",
        reasoning: "builtin",
      };
      
      for (const role of roles) {
        if (role.roleName === "conversation") taskAssignments.conversation = role.assignedProvider;
        if (role.roleName === "analysis") taskAssignments.analysis = role.assignedProvider;
        if (role.roleName === "knowledge") taskAssignments.knowledge = role.assignedProvider;
        if (role.roleName === "reasoning") taskAssignments.reasoning = role.assignedProvider;
      }

      return {
        taskAssignments,
        autoSelect: true,
        costOptimization: 50,
        qualityPriority: 50,
      };
    }),

    updateSettings: protectedProcedure
      .input(z.object({
        taskAssignments: z.record(z.string(), z.string()),
        autoSelect: z.boolean(),
        costOptimization: z.number(),
        qualityPriority: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        for (const [taskType, provider] of Object.entries(input.taskAssignments)) {
          const existingRoles = await getOrchestrationRoles(ctx.user.id);
          const existingRole = existingRoles.find(r => r.roleName === taskType);
          
          if (existingRole) {
            await updateOrchestrationRole(existingRole.id, {
              assignedProvider: provider as "openai" | "gemini" | "anthropic" | "grok" | "builtin",
            });
          } else {
            await createOrchestrationRole({
              userId: ctx.user.id,
              roleName: taskType,
              assignedProvider: provider as "openai" | "gemini" | "anthropic" | "grok" | "builtin",
            });
          }
        }
        return { success: true };
      }),
  }),

  // ============ Chat with Digital Twin ============
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
      .input(z.object({
        twinId: z.number(),
        title: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin = await getDigitalTwinById(input.twinId);
        if (!twin || twin.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const id = await createChatSession({
          userId: ctx.user.id,
          twinId: input.twinId,
          title: input.title || `${twin.name}との会話`,
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

        // AIの応答を保存
        const messageId = await addChatMessage({
          sessionId: input.sessionId,
          role: "assistant",
          content: response,
        });

        return { messageId, response };
      }),
  }),

  // ============ Business Matching ============
  matching: router({
    sessions: protectedProcedure.query(async ({ ctx }) => {
      const twins = await getDigitalTwinsByUser(ctx.user.id);
      const twinIds = twins.map(t => t.id);
      const allSessions = await getAllMatchingSessions();
      return allSessions.filter(s => twinIds.includes(s.twin1Id) || twinIds.includes(s.twin2Id));
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

    create: protectedProcedure
      .input(z.object({
        twin1Id: z.number(),
        twin2Id: z.number(),
        theme: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const twin1 = await getDigitalTwinById(input.twin1Id);
        if (!twin1 || twin1.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Twin 1 not found" });
        }

        const twin2 = await getDigitalTwinById(input.twin2Id);
        if (!twin2) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Twin 2 not found" });
        }

        const id = await createMatchingSession({
          twin1Id: input.twin1Id,
          twin2Id: input.twin2Id,
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
            turn === 0
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
            false
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

        // マッチング分析を実行
        const analysis = await orchestrator1.analyzeMatching(twin1, twin2, dialogues, session.theme);

        await createMatchingResult({
          sessionId: input.sessionId,
          compatibilityScore: String(analysis.compatibilityScore),
          collaborationPotential: analysis.collaborationPotential,
          strengths: analysis.strengths,
          challenges: analysis.challenges,
          recommendations: analysis.recommendations,
          summary: analysis.summary,
          detailedAnalysis: analysis.detailedAnalysis,
        });

        await updateMatchingSessionStatus(input.sessionId, "completed");

        return { success: true, dialogues, analysis };
      }),
  }),

  // ============ Public Twin Discovery ============
  discover: router({
    listPublicTwins: publicProcedure.query(async () => {
      // 将来的に公開設定の分身AIを一覧表示
      // 現時点では空配列を返す
      return [];
    }),
  }),
});

export type AppRouter = typeof appRouter;

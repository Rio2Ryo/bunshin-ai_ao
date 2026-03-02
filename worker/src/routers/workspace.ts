import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson } from "../db-helpers";

export const workspaceRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT w.*, wm.role,
        (SELECT COUNT(*) FROM workspace_members WHERE workspaceId = w.id) as memberCount,
        (SELECT COUNT(*) FROM workspace_items WHERE workspaceId = w.id) as itemCount,
        u.name as ownerName
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspaceId = w.id AND wm.userId = ?
       LEFT JOIN users u ON u.id = w.ownerId
       WHERE w.status = 'active'
       ORDER BY w.updatedAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      role: r.role,
      memberCount: r.memberCount,
      itemCount: r.itemCount,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Verify membership
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.id, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "このワークスペースのメンバーではありません" });

      const workspace = await ctx.env.DB.prepare(`SELECT * FROM workspaces WHERE id=?`).bind(input.id).first<any>();
      if (!workspace) throw new TRPCError({ code: "NOT_FOUND" });

      const members = await ctx.env.DB.prepare(
        `SELECT wm.*, u.name as userName, up.avatarUrl
         FROM workspace_members wm
         JOIN users u ON u.id = wm.userId
         LEFT JOIN user_profiles up ON up.userId = wm.userId
         WHERE wm.workspaceId = ?
         ORDER BY wm.joinedAt`
      ).bind(input.id).all<any>();

      const items = await ctx.env.DB.prepare(
        `SELECT wi.*, u.name as creatorName
         FROM workspace_items wi
         LEFT JOIN users u ON u.id = wi.createdBy
         WHERE wi.workspaceId = ?
         ORDER BY wi.updatedAt DESC`
      ).bind(input.id).all<any>();

      const goals = await ctx.env.DB.prepare(
        `SELECT * FROM workspace_goals WHERE workspaceId=? ORDER BY createdAt DESC`
      ).bind(input.id).all<any>();

      return {
        workspace: { ...workspace, settings: parseJson<any>(workspace.settings) },
        members: (members.results ?? []).map((m: any) => ({
          userId: m.userId,
          userName: m.userName,
          avatarUrl: m.avatarUrl,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
        items: (items.results ?? []).map((i: any) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          content: i.content,
          metadata: parseJson<any>(i.metadata),
          createdBy: i.createdBy,
          creatorName: i.creatorName,
          lastEditedBy: i.lastEditedBy,
          positionX: i.positionX,
          positionY: i.positionY,
          width: i.width,
          height: i.height,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        })),
        goals: goals.results ?? [],
        myRole: member.role,
      };
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO workspaces (name, description, ownerId) VALUES (?,?,?)`
      ).bind(input.name, input.description || null, ctx.userId).run();
      const workspaceId = Number(res.meta.last_row_id);

      // Add creator as admin
      await ctx.env.DB.prepare(
        `INSERT INTO workspace_members (workspaceId, userId, role) VALUES (?,?,?)`
      ).bind(workspaceId, ctx.userId, "admin").run();

      return { id: workspaceId };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.id, ctx.userId).first<any>();
      if (!member || member.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });

      const updates: string[] = [];
      const params: any[] = [];
      if (input.name) { updates.push("name=?"); params.push(input.name); }
      if (input.description !== undefined) { updates.push("description=?"); params.push(input.description); }
      updates.push("updatedAt=datetime('now')");
      params.push(input.id);
      await ctx.env.DB.prepare(`UPDATE workspaces SET ${updates.join(",")} WHERE id=?`).bind(...params).run();
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const ws = await ctx.env.DB.prepare(`SELECT ownerId FROM workspaces WHERE id=?`).bind(input.id).first<any>();
      if (!ws || ws.ownerId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.env.DB.prepare(`UPDATE workspaces SET status='deleted' WHERE id=?`).bind(input.id).run();
      return { success: true };
    }),

  // Member management
  inviteMember: protectedProcedure
    .input(z.object({ workspaceId: z.number(), userId: z.number(), role: z.enum(["member", "editor", "admin"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member || !["admin", "editor"].includes(member.role)) throw new TRPCError({ code: "FORBIDDEN", message: "招待権限がありません" });

      // Check if user is a friend
      const friendship = await ctx.env.DB.prepare(
        `SELECT id FROM friendships WHERE ((userId=? AND friendId=?) OR (userId=? AND friendId=?)) AND status='accepted'`
      ).bind(ctx.userId, input.userId, input.userId, ctx.userId).first<any>();
      if (!friendship) throw new TRPCError({ code: "BAD_REQUEST", message: "友達のみ招待できます" });

      await ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO workspace_members (workspaceId, userId, role) VALUES (?,?,?)`
      ).bind(input.workspaceId, input.userId, input.role).run();
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ workspaceId: z.number(), userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member || member.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      if (input.userId === ctx.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分を削除することはできません" });
      await ctx.env.DB.prepare(
        `DELETE FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, input.userId).run();
      return { success: true };
    }),

  // Items (cards on the board)
  addItem: protectedProcedure
    .input(z.object({
      workspaceId: z.number(),
      type: z.enum(["note", "matching_result", "goal", "insight", "action"]),
      title: z.string().min(1).max(200),
      content: z.string().max(5000).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO workspace_items (workspaceId, type, title, content, metadata, createdBy, positionX, positionY) VALUES (?,?,?,?,?,?,?,?)`
      ).bind(input.workspaceId, input.type, input.title, input.content || null, input.metadata ? toJson(input.metadata) : null, ctx.userId, input.positionX ?? 0, input.positionY ?? 0).run();

      await ctx.env.DB.prepare(`UPDATE workspaces SET updatedAt=datetime('now') WHERE id=?`).bind(input.workspaceId).run();
      return { id: Number(res.meta.last_row_id) };
    }),

  updateItem: protectedProcedure
    .input(z.object({
      itemId: z.number(),
      title: z.string().min(1).max(200).optional(),
      content: z.string().max(5000).optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const item = await ctx.env.DB.prepare(`SELECT workspaceId FROM workspace_items WHERE id=?`).bind(input.itemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(item.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });

      const updates: string[] = [];
      const params: any[] = [];
      if (input.title) { updates.push("title=?"); params.push(input.title); }
      if (input.content !== undefined) { updates.push("content=?"); params.push(input.content); }
      if (input.positionX !== undefined) { updates.push("positionX=?"); params.push(input.positionX); }
      if (input.positionY !== undefined) { updates.push("positionY=?"); params.push(input.positionY); }
      if (input.width !== undefined) { updates.push("width=?"); params.push(input.width); }
      if (input.height !== undefined) { updates.push("height=?"); params.push(input.height); }
      updates.push("lastEditedBy=?"); params.push(ctx.userId);
      updates.push("updatedAt=datetime('now')");
      params.push(input.itemId);
      await ctx.env.DB.prepare(`UPDATE workspace_items SET ${updates.join(",")} WHERE id=?`).bind(...params).run();

      await ctx.env.DB.prepare(`UPDATE workspaces SET updatedAt=datetime('now') WHERE id=?`).bind(item.workspaceId).run();
      return { success: true };
    }),

  deleteItem: protectedProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const item = await ctx.env.DB.prepare(`SELECT workspaceId FROM workspace_items WHERE id=?`).bind(input.itemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(item.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.env.DB.prepare(`DELETE FROM workspace_items WHERE id=?`).bind(input.itemId).run();
      return { success: true };
    }),

  // Import matching result as workspace item
  importMatching: protectedProcedure
    .input(z.object({ workspaceId: z.number(), sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });

      const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();

      const res = await ctx.env.DB.prepare(
        `INSERT INTO workspace_items (workspaceId, type, title, content, metadata, createdBy) VALUES (?,?,?,?,?,?)`
      ).bind(
        input.workspaceId,
        "matching_result",
        `マッチング: ${session.theme}`,
        result?.summary || "分析結果なし",
        toJson({
          sessionId: input.sessionId,
          score: result?.compatibilityScore ? parseFloat(result.compatibilityScore) : 0,
          strengths: parseJson(result?.strengths),
          challenges: parseJson(result?.challenges),
          recommendations: parseJson(result?.recommendations),
        }),
        ctx.userId,
      ).run();

      return { id: Number(res.meta.last_row_id) };
    }),

  // Goals
  addGoal: protectedProcedure
    .input(z.object({
      workspaceId: z.number(),
      title: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      targetScore: z.number().min(1).max(100).optional(),
      dueDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO workspace_goals (workspaceId, title, description, targetScore, dueDate, createdBy) VALUES (?,?,?,?,?,?)`
      ).bind(input.workspaceId, input.title, input.description || null, input.targetScore || null, input.dueDate || null, ctx.userId).run();
      return { id: Number(res.meta.last_row_id) };
    }),

  updateGoal: protectedProcedure
    .input(z.object({
      goalId: z.number(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      currentScore: z.number().optional(),
      status: z.enum(["active", "completed", "cancelled"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const goal = await ctx.env.DB.prepare(`SELECT workspaceId FROM workspace_goals WHERE id=?`).bind(input.goalId).first<any>();
      if (!goal) throw new TRPCError({ code: "NOT_FOUND" });
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(goal.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });

      const updates: string[] = [];
      const params: any[] = [];
      if (input.title) { updates.push("title=?"); params.push(input.title); }
      if (input.description !== undefined) { updates.push("description=?"); params.push(input.description); }
      if (input.currentScore !== undefined) { updates.push("currentScore=?"); params.push(input.currentScore); }
      if (input.status) { updates.push("status=?"); params.push(input.status); }
      updates.push("updatedAt=datetime('now')");
      params.push(input.goalId);
      await ctx.env.DB.prepare(`UPDATE workspace_goals SET ${updates.join(",")} WHERE id=?`).bind(...params).run();
      return { success: true };
    }),

  deleteGoal: protectedProcedure
    .input(z.object({ goalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const goal = await ctx.env.DB.prepare(`SELECT workspaceId FROM workspace_goals WHERE id=?`).bind(input.goalId).first<any>();
      if (!goal) throw new TRPCError({ code: "NOT_FOUND" });
      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(goal.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.env.DB.prepare(`DELETE FROM workspace_goals WHERE id=?`).bind(input.goalId).run();
      return { success: true };
    }),

  // ============ Phase 16: コラボレーションボード ============

  listBoardItems: protectedProcedure
    .input(z.object({
      workspaceId: z.number(),
      status: z.enum(["backlog", "in_progress", "done"]).optional(),
      tag: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "ワークスペースへのアクセス権がありません" });

      let sql = `SELECT wbi.*, u.name as creatorName FROM workspace_board_items wbi
        LEFT JOIN users u ON u.id = wbi.userId
        WHERE wbi.workspaceId=?`;
      const params: any[] = [input.workspaceId];

      if (input.status) {
        sql += ` AND wbi.status=?`;
        params.push(input.status);
      }
      if (input.tag) {
        sql += ` AND wbi.tags LIKE ?`;
        params.push(`%${input.tag}%`);
      }

      sql += ` ORDER BY wbi.status, wbi.position ASC, wbi.createdAt DESC`;

      const rows = await ctx.env.DB.prepare(sql).bind(...params).all<any>();

      return (rows.results ?? []).map((r: any) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        userId: r.userId,
        creatorName: r.creatorName,
        type: r.type,
        title: r.title,
        content: r.content,
        status: r.status,
        tags: r.tags,
        sourceId: r.sourceId,
        position: r.position,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }),

  createBoardItem: protectedProcedure
    .input(z.object({
      workspaceId: z.number(),
      type: z.enum(["matching_result", "knowledge", "note", "action", "insight"]),
      title: z.string(),
      content: z.string().optional(),
      status: z.enum(["backlog", "in_progress", "done"]).default("backlog"),
      tags: z.string().optional(),
      sourceId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(input.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "ワークスペースへのアクセス権がありません" });

      const maxPos = await ctx.env.DB.prepare(
        `SELECT MAX(position) as maxPos FROM workspace_board_items WHERE workspaceId=? AND status=?`
      ).bind(input.workspaceId, input.status).first<any>();
      const nextPosition = (maxPos?.maxPos ?? -1) + 1;

      const result = await ctx.env.DB.prepare(
        `INSERT INTO workspace_board_items (workspaceId, userId, type, title, content, status, tags, sourceId, position, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
      ).bind(
        input.workspaceId,
        ctx.userId,
        input.type,
        input.title,
        input.content ?? null,
        input.status,
        input.tags ?? null,
        input.sourceId ?? null,
        nextPosition,
      ).run();

      return { id: result.meta?.last_row_id ?? 0 };
    }),

  updateBoardItem: protectedProcedure
    .input(z.object({
      itemId: z.number(),
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const item = await ctx.env.DB.prepare(
        `SELECT workspaceId FROM workspace_board_items WHERE id=?`
      ).bind(input.itemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "ボードアイテムが見つかりません" });

      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(item.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "ワークスペースへのアクセス権がありません" });

      const updates: string[] = [];
      const values: any[] = [];
      if (input.title !== undefined) { updates.push("title=?"); values.push(input.title); }
      if (input.content !== undefined) { updates.push("content=?"); values.push(input.content); }
      if (input.tags !== undefined) { updates.push("tags=?"); values.push(input.tags); }

      if (updates.length > 0) {
        updates.push("updatedAt=datetime('now')");
        const sql = `UPDATE workspace_board_items SET ${updates.join(",")} WHERE id=?`;
        values.push(input.itemId);
        await ctx.env.DB.prepare(sql).bind(...values).run();
      }

      return { success: true as const };
    }),

  moveBoardItem: protectedProcedure
    .input(z.object({
      itemId: z.number(),
      status: z.enum(["backlog", "in_progress", "done"]),
      position: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const item = await ctx.env.DB.prepare(
        `SELECT workspaceId FROM workspace_board_items WHERE id=?`
      ).bind(input.itemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "ボードアイテムが見つかりません" });

      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(item.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "ワークスペースへのアクセス権がありません" });

      let position = input.position;
      if (position === undefined) {
        const maxPos = await ctx.env.DB.prepare(
          `SELECT MAX(position) as maxPos FROM workspace_board_items WHERE workspaceId=? AND status=?`
        ).bind(item.workspaceId, input.status).first<any>();
        position = (maxPos?.maxPos ?? -1) + 1;
      }

      await ctx.env.DB.prepare(
        `UPDATE workspace_board_items SET status=?, position=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(input.status, position, input.itemId).run();

      return { success: true as const };
    }),

  deleteBoardItem: protectedProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const item = await ctx.env.DB.prepare(
        `SELECT workspaceId FROM workspace_board_items WHERE id=?`
      ).bind(input.itemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "ボードアイテムが見つかりません" });

      const member = await ctx.env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?`
      ).bind(item.workspaceId, ctx.userId).first<any>();
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "ワークスペースへのアクセス権がありません" });

      await ctx.env.DB.prepare(`DELETE FROM workspace_board_items WHERE id=?`).bind(input.itemId).run();
      return { success: true as const };
    }),
});

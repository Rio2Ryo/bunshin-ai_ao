import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson, addTrustAction } from "../db-helpers";

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB
      .prepare(`SELECT * FROM user_profiles WHERE userId = ?`)
      .bind(ctx.userId)
      .first<any>();
    if (!row) return null;
    return {
      ...row,
      skills: parseJson<string[]>(row.skills) ?? [],
      expertise: parseJson<string[]>(row.expertise) ?? [],
    };
  }),
  update: protectedProcedure
    .input(z.object({
      displayName: z.string().max(50).optional(),
      bio: z.string().max(500).optional(),
      skills: z.array(z.string().max(100)).max(20).optional(),
      experience: z.string().max(2000).optional(),
      businessInfo: z.string().max(2000).optional(),
      expertise: z.array(z.string().max(100)).max(20).optional(),
      industry: z.string().max(100).optional(),
      company: z.string().max(100).optional(),
      position: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await ctx.env.DB
        .prepare(`SELECT id FROM user_profiles WHERE userId = ?`)
        .bind(ctx.userId)
        .first<any>();
      if (existing) {
        await ctx.env.DB
          .prepare(`UPDATE user_profiles SET displayName=?, bio=?, skills=?, experience=?, businessInfo=?, expertise=?, industry=?, company=?, position=?, updatedAt=datetime('now') WHERE userId=?`)
          .bind(
            input.displayName ?? null, input.bio ?? null,
            toJson(input.skills), input.experience ?? null,
            input.businessInfo ?? null, toJson(input.expertise),
            input.industry ?? null, input.company ?? null,
            input.position ?? null, ctx.userId
          ).run();
      } else {
        await ctx.env.DB
          .prepare(`INSERT INTO user_profiles (userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(
            ctx.userId, input.displayName ?? null, input.bio ?? null,
            toJson(input.skills), input.experience ?? null,
            input.businessInfo ?? null, toJson(input.expertise),
            input.industry ?? null, input.company ?? null,
            input.position ?? null
          ).run();
      }
      // Award trust points per profile field filled (max ~20pts total)
      const profileFields: { value: unknown; action: string; label: string; points: number }[] = [
        { value: input.displayName, action: "profile_field_displayName", label: "表示名", points: 2 },
        { value: input.bio, action: "profile_field_bio", label: "自己紹介", points: 3 },
        { value: input.company, action: "profile_field_company", label: "会社名", points: 2 },
        { value: input.industry, action: "profile_field_industry", label: "業種", points: 2 },
        { value: input.position, action: "profile_field_position", label: "役職", points: 2 },
        { value: input.skills?.length ? input.skills : null, action: "profile_field_skills", label: "スキル", points: 3 },
        { value: input.expertise?.length ? input.expertise : null, action: "profile_field_expertise", label: "専門分野", points: 3 },
        { value: input.experience, action: "profile_field_experience", label: "経験", points: 3 },
      ];
      for (const field of profileFields) {
        if (field.value) {
          const alreadyAwarded = await ctx.env.DB.prepare(
            `SELECT id FROM trust_score_history WHERE userId=? AND action=?`
          ).bind(ctx.userId, field.action).first<any>();
          if (!alreadyAwarded) {
            await addTrustAction(ctx.env.DB, ctx.userId, field.action, field.points, `${field.label}を設定しました`);
          }
        }
      }
      return { success: true };
    }),
  uploadAvatar: protectedProcedure
    .input(z.object({ imageData: z.string(), contentType: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const r2 = ctx.env.ASSETS;
      if (!r2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ストレージが未設定です" });

      const base64Data = input.imageData.replace(/^data:[^;]+;base64,/, "");
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      // Validate size (max 2MB)
      if (binaryData.length > 2 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "画像サイズは2MB以下にしてください" });
      }

      const contentType = input.contentType || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const key = `avatars/${ctx.userId}_${Date.now()}.${ext}`;

      await r2.put(key, binaryData, { httpMetadata: { contentType } });

      const avatarUrl = `/assets/${key}`;

      // Upsert profile with avatarUrl
      const existing = await ctx.env.DB.prepare(`SELECT id FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      if (existing) {
        await ctx.env.DB.prepare(`UPDATE user_profiles SET avatarUrl=?, updatedAt=datetime('now') WHERE userId=?`).bind(avatarUrl, ctx.userId).run();
      } else {
        await ctx.env.DB.prepare(`INSERT INTO user_profiles (userId, avatarUrl) VALUES (?,?)`).bind(ctx.userId, avatarUrl).run();
      }

      // Award trust points for avatar upload
      const alreadyAwarded = await ctx.env.DB.prepare(
        `SELECT id FROM trust_score_history WHERE userId=? AND action='profile_field_avatar'`
      ).bind(ctx.userId).first<any>();
      if (!alreadyAwarded) {
        await addTrustAction(ctx.env.DB, ctx.userId, "profile_field_avatar", 5, "プロフィール画像を設定しました");
      }

      return { avatarUrl };
    }),
  getPublic: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const profile = await ctx.env.DB.prepare(`SELECT displayName, bio, industry, company, position, skills, expertise, experience, avatarUrl FROM user_profiles WHERE userId=?`).bind(input.userId).first<any>();
      if (!profile) return null;
      const twin = await ctx.env.DB.prepare(`SELECT name, description, personality, tags FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.userId).first<any>();
      const trust = await ctx.env.DB.prepare(`SELECT score, rank FROM trust_scores WHERE userId=?`).bind(input.userId).first<any>();
      const user = await ctx.env.DB.prepare(`SELECT name, friendCode FROM users WHERE id=?`).bind(input.userId).first<any>();
      return {
        userId: input.userId,
        userName: user?.name ?? null,
        friendCode: user?.friendCode ?? null,
        displayName: profile.displayName,
        bio: profile.bio,
        industry: profile.industry,
        company: profile.company,
        position: profile.position,
        experience: profile.experience,
        avatarUrl: profile.avatarUrl ?? null,
        skills: parseJson<string[]>(profile.skills) ?? [],
        expertise: parseJson<string[]>(profile.expertise) ?? [],
        trustScore: trust?.score ?? 0,
        trustRank: trust?.rank ?? "beginner",
        twin: twin ? { name: twin.name, description: twin.description, tags: parseJson<string[]>(twin.tags) ?? [] } : null,
      };
    }),
});

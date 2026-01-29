import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// モックユーザー
const mockUser: AuthenticatedUser = {
  id: 1,
  openId: "test-user-123",
  email: "test@example.com",
  name: "Test User",
  loginMethod: "manus",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

// 別ユーザー（権限テスト用）
const otherUser: AuthenticatedUser = {
  id: 2,
  openId: "other-user-456",
  email: "other@example.com",
  name: "Other User",
  loginMethod: "manus",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createAuthContext(user: AuthenticatedUser = mockUser): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// モックカードデータ
const mockCard = {
  id: 1,
  userId: 1,
  cardType: "business_card",
  title: "田中太郎 - 株式会社テスト",
  frontImageUrl: "https://example.com/card.jpg",
  frontImageKey: "cards/1/card.jpg",
  backImageUrl: null,
  backImageKey: null,
  extractedData: {
    name: "田中太郎",
    company: "株式会社テスト",
    email: "tanaka@test.co.jp",
    phone: "03-1234-5678",
  },
  manualData: null,
  tags: ["ビジネス", "IT"],
  notes: "展示会で交換",
  ocrStatus: "completed" as const,
  ocrError: null,
  ocrCompletedAt: new Date(),
  lineMessageId: null,
  isFavorite: 0,
  isArchived: 0,
  viewCount: 5,
  lastViewedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// 別ユーザーのカード
const otherUserCard = {
  ...mockCard,
  id: 2,
  userId: 2,
  title: "他人のカード",
};

describe("cards router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("cards.list", () => {
    it("ユーザーのカード一覧を取得できる", async () => {
      vi.spyOn(db, "getCardsByUserId").mockResolvedValue([mockCard]);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.list({});

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("田中太郎 - 株式会社テスト");
      expect(db.getCardsByUserId).toHaveBeenCalledWith(1, {});
    });

    it("カードタイプでフィルタリングできる", async () => {
      vi.spyOn(db, "getCardsByUserId").mockResolvedValue([mockCard]);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await caller.cards.list({ cardType: "business_card" });

      expect(db.getCardsByUserId).toHaveBeenCalledWith(1, { cardType: "business_card" });
    });

    it("お気に入りでフィルタリングできる", async () => {
      vi.spyOn(db, "getCardsByUserId").mockResolvedValue([]);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await caller.cards.list({ isFavorite: true });

      expect(db.getCardsByUserId).toHaveBeenCalledWith(1, { isFavorite: true });
    });
  });

  describe("cards.get", () => {
    it("自分のカードを取得できる", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(mockCard);
      vi.spyOn(db, "incrementCardViewCount").mockResolvedValue();

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.get({ id: 1 });

      expect(result.title).toBe("田中太郎 - 株式会社テスト");
      expect(db.incrementCardViewCount).toHaveBeenCalledWith(1);
    });

    it("他人のカードは取得できない", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(otherUserCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.cards.get({ id: 2 })).rejects.toThrow("カードが見つかりません");
    });

    it("存在しないカードはエラーになる", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(undefined);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.cards.get({ id: 999 })).rejects.toThrow("カードが見つかりません");
    });
  });

  describe("cards.create", () => {
    it("カードを作成できる", async () => {
      const newCard = { ...mockCard, id: 3 };
      vi.spyOn(db, "createCard").mockResolvedValue(newCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.create({
        cardType: "business_card",
        title: "新しいカード",
        frontImageUrl: "https://example.com/new.jpg",
        extractedData: { name: "山田花子" },
        tags: ["テスト"],
      });

      expect(result).toBeDefined();
      expect(db.createCard).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          cardType: "business_card",
          title: "新しいカード",
          ocrStatus: "completed",
        })
      );
    });

    it("extractedDataがない場合はocrStatusがpendingになる", async () => {
      const newCard = { ...mockCard, id: 3, ocrStatus: "pending" as const };
      vi.spyOn(db, "createCard").mockResolvedValue(newCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await caller.cards.create({
        cardType: "point_card",
        title: "ポイントカード",
      });

      expect(db.createCard).toHaveBeenCalledWith(
        expect.objectContaining({
          ocrStatus: "pending",
        })
      );
    });
  });

  describe("cards.update", () => {
    it("自分のカードを更新できる", async () => {
      const updatedCard = { ...mockCard, title: "更新後のタイトル" };
      vi.spyOn(db, "getCardById").mockResolvedValue(mockCard);
      vi.spyOn(db, "updateCard").mockResolvedValue(updatedCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.update({
        id: 1,
        title: "更新後のタイトル",
        notes: "メモを追加",
      });

      expect(result?.title).toBe("更新後のタイトル");
      expect(db.updateCard).toHaveBeenCalledWith(1, {
        title: "更新後のタイトル",
        notes: "メモを追加",
      });
    });

    it("他人のカードは更新できない", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(otherUserCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.cards.update({ id: 2, title: "不正な更新" })
      ).rejects.toThrow("カードが見つかりません");
    });
  });

  describe("cards.delete", () => {
    it("自分のカードを削除できる", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(mockCard);
      vi.spyOn(db, "deleteCard").mockResolvedValue(true);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.delete({ id: 1 });

      expect(result).toEqual({ success: true });
      expect(db.deleteCard).toHaveBeenCalledWith(1);
    });

    it("他人のカードは削除できない", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(otherUserCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.cards.delete({ id: 2 })).rejects.toThrow("カードが見つかりません");
    });
  });

  describe("cards.search", () => {
    it("カードを検索できる", async () => {
      vi.spyOn(db, "searchCards").mockResolvedValue([mockCard]);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.search({ query: "田中" });

      expect(result).toHaveLength(1);
      expect(db.searchCards).toHaveBeenCalledWith(1, "田中", {
        cardType: undefined,
        limit: undefined,
      });
    });

    it("カードタイプを指定して検索できる", async () => {
      vi.spyOn(db, "searchCards").mockResolvedValue([]);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await caller.cards.search({ query: "テスト", cardType: "point_card" });

      expect(db.searchCards).toHaveBeenCalledWith(1, "テスト", {
        cardType: "point_card",
        limit: undefined,
      });
    });
  });

  describe("cards.toggleFavorite", () => {
    it("お気に入りを切り替えられる", async () => {
      const favoriteCard = { ...mockCard, isFavorite: 1 };
      vi.spyOn(db, "getCardById").mockResolvedValue(mockCard);
      vi.spyOn(db, "toggleCardFavorite").mockResolvedValue(favoriteCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.toggleFavorite({ id: 1 });

      expect(result?.isFavorite).toBe(1);
    });

    it("他人のカードのお気に入りは切り替えられない", async () => {
      vi.spyOn(db, "getCardById").mockResolvedValue(otherUserCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.cards.toggleFavorite({ id: 2 })).rejects.toThrow("カードが見つかりません");
    });
  });

  describe("cards.toggleArchive", () => {
    it("アーカイブを切り替えられる", async () => {
      const archivedCard = { ...mockCard, isArchived: 1 };
      vi.spyOn(db, "getCardById").mockResolvedValue(mockCard);
      vi.spyOn(db, "toggleCardArchive").mockResolvedValue(archivedCard);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.toggleArchive({ id: 1 });

      expect(result?.isArchived).toBe(1);
    });
  });

  describe("cards.getStats", () => {
    it("カードタイプ別の統計を取得できる", async () => {
      const stats = [
        { cardType: "business_card", count: 10 },
        { cardType: "point_card", count: 5 },
      ];
      vi.spyOn(db, "getCardStatsByUserId").mockResolvedValue(stats);

      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.getStats();

      expect(result).toHaveLength(2);
      expect(result[0].cardType).toBe("business_card");
      expect(result[0].count).toBe(10);
    });
  });

  describe("cards.getCardTypes", () => {
    it("カードタイプ一覧を取得できる", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.cards.getCardTypes();

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result.business_card).toBeDefined();
      expect(result.business_card.name).toBe("名刺");
    });
  });
});

describe("cardOcrService", () => {
  describe("analyzeCardImage", () => {
    it("名刺画像を解析できる", async () => {
      const { analyzeCardImage } = await import("./services/cardOcrService");
      
      // 実際のAPI呼び出しはモックする必要があるため、
      // ここでは関数が存在することを確認
      expect(typeof analyzeCardImage).toBe("function");
    });

    it("generateCardTitleが正しくタイトルを生成する", async () => {
      const { generateCardTitle } = await import("./services/cardOcrService");
      
      // 名刺
      expect(generateCardTitle("business_card", { name: "田中太郎", company: "テスト株式会社" }))
        .toBe("田中太郎 - テスト株式会社");
      
      // 名前のみ
      expect(generateCardTitle("business_card", { name: "山田花子", company: null }))
        .toBe("山田花子");
      
      // ポイントカード
      expect(generateCardTitle("point_card", { storeName: "コンビニA" }))
        .toBe("コンビニA");
      
      // 会員証
      expect(generateCardTitle("membership_card", { organizationName: "スポーツクラブ" }))
        .toBe("スポーツクラブ");
      
      // 診察券
      expect(generateCardTitle("medical_card", { hospitalName: "○○病院" }))
        .toBe("○○病院");
      
      // クレジットカード
      expect(generateCardTitle("credit_card", { cardBrand: "VISA", lastFourDigits: "1234" }))
        .toBe("VISA ****1234");
      
      // その他
      expect(generateCardTitle("other", { title: "カスタムカード" }))
        .toBe("カスタムカード");
      
      // データなし
      expect(generateCardTitle("other", {}))
        .toBe("カード");
    });
  });
});

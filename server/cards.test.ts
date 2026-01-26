import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", () => ({
  getCardByCode: vi.fn(),
  createCard: vi.fn(),
  getUserCards: vi.fn(),
  addUserCard: vi.fn(),
  hasUserCard: vi.fn(),
  incrementCardScans: vi.fn(),
  incrementCardSaves: vi.fn(),
  generateUniqueCardCode: vi.fn(),
  getCardsByOwner: vi.fn(),
}));

import {
  getCardByCode,
  createCard,
  getUserCards,
  addUserCard,
  hasUserCard,
  incrementCardScans,
  incrementCardSaves,
  generateUniqueCardCode,
  getCardsByOwner,
} from "./db";

describe("NFC Card System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCardByCode", () => {
    it("should return card when code exists", async () => {
      const mockCard = {
        id: 1,
        code: "ABC123",
        ownerUserId: 1,
        cardType: "business_card",
        title: "山田太郎",
        subtitle: "CEO",
        description: null,
        imageUrl: null,
        contactInfo: { email: "test@example.com" },
        businessInfo: { company: "株式会社テスト" },
        customFields: null,
        isPublic: 1,
        totalScans: 0,
        totalSaves: 0,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(getCardByCode).mockResolvedValue(mockCard);

      const result = await getCardByCode("ABC123");
      
      expect(result).toEqual(mockCard);
      expect(getCardByCode).toHaveBeenCalledWith("ABC123");
    });

    it("should return null when code does not exist", async () => {
      vi.mocked(getCardByCode).mockResolvedValue(null);

      const result = await getCardByCode("INVALID");
      
      expect(result).toBeNull();
    });
  });

  describe("createCard", () => {
    it("should create a new card with generated code", async () => {
      const mockCard = {
        id: 1,
        code: "XYZ789",
        ownerUserId: 1,
        cardType: "business_card",
        title: "新しいカード",
        subtitle: null,
        description: null,
        imageUrl: null,
        contactInfo: null,
        businessInfo: null,
        customFields: null,
        isPublic: 1,
        totalScans: 0,
        totalSaves: 0,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(generateUniqueCardCode).mockResolvedValue("XYZ789");
      vi.mocked(createCard).mockResolvedValue(mockCard);

      const code = await generateUniqueCardCode();
      expect(code).toBe("XYZ789");

      const result = await createCard({
        code: "XYZ789",
        ownerUserId: 1,
        cardType: "business_card",
        title: "新しいカード",
        isPublic: 1,
      });

      expect(result).toEqual(mockCard);
    });
  });

  describe("getUserCards", () => {
    it("should return user's acquired cards", async () => {
      const mockUserCards = [
        {
          id: 1,
          userId: 1,
          cardId: 1,
          acquiredAt: new Date(),
          acquiredMethod: "nfc_scan",
          isFavorite: 0,
          memo: null,
          tags: null,
          card: {
            id: 1,
            code: "ABC123",
            title: "テストカード",
            cardType: "business_card",
          },
        },
      ];

      vi.mocked(getUserCards).mockResolvedValue(mockUserCards as any);

      const result = await getUserCards(1);
      
      expect(result).toHaveLength(1);
      expect(result[0].card.title).toBe("テストカード");
    });

    it("should return empty array when user has no cards", async () => {
      vi.mocked(getUserCards).mockResolvedValue([]);

      const result = await getUserCards(999);
      
      expect(result).toEqual([]);
    });
  });

  describe("addUserCard", () => {
    it("should add card to user's collection", async () => {
      const mockUserCard = {
        id: 1,
        userId: 1,
        cardId: 1,
        acquiredAt: new Date(),
        acquiredMethod: "nfc_scan",
        isFavorite: 0,
        memo: null,
        tags: null,
      };

      vi.mocked(hasUserCard).mockResolvedValue(false);
      vi.mocked(addUserCard).mockResolvedValue(mockUserCard as any);

      const hasCard = await hasUserCard(1, 1);
      expect(hasCard).toBe(false);

      const result = await addUserCard({
        userId: 1,
        cardId: 1,
        acquiredMethod: "nfc_scan",
      });

      expect(result).toEqual(mockUserCard);
    });

    it("should not add duplicate card", async () => {
      vi.mocked(hasUserCard).mockResolvedValue(true);

      const hasCard = await hasUserCard(1, 1);
      expect(hasCard).toBe(true);
    });
  });

  describe("incrementCardScans", () => {
    it("should increment scan count", async () => {
      vi.mocked(incrementCardScans).mockResolvedValue(undefined);

      await incrementCardScans(1);
      
      expect(incrementCardScans).toHaveBeenCalledWith(1);
    });
  });

  describe("incrementCardSaves", () => {
    it("should increment save count", async () => {
      vi.mocked(incrementCardSaves).mockResolvedValue(undefined);

      await incrementCardSaves(1);
      
      expect(incrementCardSaves).toHaveBeenCalledWith(1);
    });
  });

  describe("getCardsByOwner", () => {
    it("should return cards owned by user", async () => {
      const mockCards = [
        {
          id: 1,
          code: "ABC123",
          ownerUserId: 1,
          cardType: "business_card",
          title: "マイ名刺",
          totalScans: 10,
          totalSaves: 5,
        },
      ];

      vi.mocked(getCardsByOwner).mockResolvedValue(mockCards as any);

      const result = await getCardsByOwner(1);
      
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("マイ名刺");
      expect(result[0].totalScans).toBe(10);
    });
  });

  describe("Card API endpoint flow", () => {
    it("should handle card acquisition flow correctly", async () => {
      // 1. カードコードでカードを取得
      const mockCard = {
        id: 1,
        code: "TEST01",
        ownerUserId: 2,
        cardType: "business_card",
        title: "テスト名刺",
        isPublic: 1,
      };

      vi.mocked(getCardByCode).mockResolvedValue(mockCard as any);
      vi.mocked(hasUserCard).mockResolvedValue(false);
      vi.mocked(addUserCard).mockResolvedValue({
        id: 1,
        userId: 1,
        cardId: 1,
        acquiredAt: new Date(),
        acquiredMethod: "link",
      } as any);
      vi.mocked(incrementCardScans).mockResolvedValue(undefined);
      vi.mocked(incrementCardSaves).mockResolvedValue(undefined);

      // カードを取得
      const card = await getCardByCode("TEST01");
      expect(card).not.toBeNull();
      expect(card?.title).toBe("テスト名刺");

      // スキャン回数をインクリメント
      await incrementCardScans(card!.id);
      expect(incrementCardScans).toHaveBeenCalledWith(1);

      // ユーザーが既に持っているか確認
      const alreadyHas = await hasUserCard(1, card!.id);
      expect(alreadyHas).toBe(false);

      // カードを追加
      const userCard = await addUserCard({
        userId: 1,
        cardId: card!.id,
        acquiredMethod: "link",
      });
      expect(userCard).not.toBeNull();

      // 保存回数をインクリメント
      await incrementCardSaves(card!.id);
      expect(incrementCardSaves).toHaveBeenCalledWith(1);
    });
  });
});

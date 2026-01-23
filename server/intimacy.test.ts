import { describe, it, expect, vi, beforeEach } from "vitest";

// 親密度レベルの定数
const INTIMACY_LEVELS = {
  stranger: { min: 0, max: 20, label: "知らない人", weight: 0.2 },
  acquaintance: { min: 20, max: 40, label: "知り合い", weight: 0.4 },
  friend: { min: 40, max: 60, label: "友達", weight: 0.6 },
  close_friend: { min: 60, max: 80, label: "親しい友達", weight: 0.8 },
  best_friend: { min: 80, max: 100, label: "親友", weight: 1.0 },
};

// 親密度レベルを判定する関数
function getIntimacyLevel(score: number): keyof typeof INTIMACY_LEVELS {
  if (score >= 80) return "best_friend";
  if (score >= 60) return "close_friend";
  if (score >= 40) return "friend";
  if (score >= 20) return "acquaintance";
  return "stranger";
}

// 会話量から親密度スコアを計算する関数
function calculateConversationScore(messageCount: number, daysSinceFirstChat: number): number {
  // メッセージ数のスコア（最大50点）
  const messageScore = Math.min(50, messageCount / 2);
  
  // 継続期間のスコア（最大30点）
  const durationScore = Math.min(30, daysSinceFirstChat / 10);
  
  // 最近の活動スコア（最大20点）- ここでは簡略化
  const recentActivityScore = 10;
  
  return Math.min(100, messageScore + durationScore + recentActivityScore);
}

// 予測精度から親密度を調整する関数
function adjustIntimacyByAccuracy(baseScore: number, predictionAccuracy: number | null): number {
  if (predictionAccuracy === null) return baseScore;
  
  // 予測精度が高いほど親密度を上げる
  const accuracyBonus = (predictionAccuracy - 50) * 0.5;
  return Math.max(0, Math.min(100, baseScore + accuracyBonus));
}

describe("Intimacy System", () => {
  describe("getIntimacyLevel", () => {
    it("should return stranger for score < 20", () => {
      expect(getIntimacyLevel(0)).toBe("stranger");
      expect(getIntimacyLevel(10)).toBe("stranger");
      expect(getIntimacyLevel(19)).toBe("stranger");
    });

    it("should return acquaintance for score 20-39", () => {
      expect(getIntimacyLevel(20)).toBe("acquaintance");
      expect(getIntimacyLevel(30)).toBe("acquaintance");
      expect(getIntimacyLevel(39)).toBe("acquaintance");
    });

    it("should return friend for score 40-59", () => {
      expect(getIntimacyLevel(40)).toBe("friend");
      expect(getIntimacyLevel(50)).toBe("friend");
      expect(getIntimacyLevel(59)).toBe("friend");
    });

    it("should return close_friend for score 60-79", () => {
      expect(getIntimacyLevel(60)).toBe("close_friend");
      expect(getIntimacyLevel(70)).toBe("close_friend");
      expect(getIntimacyLevel(79)).toBe("close_friend");
    });

    it("should return best_friend for score >= 80", () => {
      expect(getIntimacyLevel(80)).toBe("best_friend");
      expect(getIntimacyLevel(90)).toBe("best_friend");
      expect(getIntimacyLevel(100)).toBe("best_friend");
    });
  });

  describe("calculateConversationScore", () => {
    it("should return low score for few messages", () => {
      const score = calculateConversationScore(10, 5);
      expect(score).toBeLessThan(30);
    });

    it("should return higher score for more messages", () => {
      const lowScore = calculateConversationScore(10, 10);
      const highScore = calculateConversationScore(100, 10);
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it("should return higher score for longer duration", () => {
      const shortDuration = calculateConversationScore(50, 10);
      const longDuration = calculateConversationScore(50, 100);
      expect(longDuration).toBeGreaterThan(shortDuration);
    });

    it("should cap at 100", () => {
      const score = calculateConversationScore(1000, 1000);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("adjustIntimacyByAccuracy", () => {
    it("should return base score when accuracy is null", () => {
      expect(adjustIntimacyByAccuracy(50, null)).toBe(50);
    });

    it("should increase score for high accuracy", () => {
      const adjusted = adjustIntimacyByAccuracy(50, 80);
      expect(adjusted).toBeGreaterThan(50);
    });

    it("should decrease score for low accuracy", () => {
      const adjusted = adjustIntimacyByAccuracy(50, 30);
      expect(adjusted).toBeLessThan(50);
    });

    it("should not exceed 100", () => {
      const adjusted = adjustIntimacyByAccuracy(95, 100);
      expect(adjusted).toBeLessThanOrEqual(100);
    });

    it("should not go below 0", () => {
      const adjusted = adjustIntimacyByAccuracy(5, 0);
      expect(adjusted).toBeGreaterThanOrEqual(0);
    });
  });

  describe("INTIMACY_LEVELS", () => {
    it("should have correct weight values", () => {
      expect(INTIMACY_LEVELS.stranger.weight).toBe(0.2);
      expect(INTIMACY_LEVELS.acquaintance.weight).toBe(0.4);
      expect(INTIMACY_LEVELS.friend.weight).toBe(0.6);
      expect(INTIMACY_LEVELS.close_friend.weight).toBe(0.8);
      expect(INTIMACY_LEVELS.best_friend.weight).toBe(1.0);
    });

    it("should have correct labels", () => {
      expect(INTIMACY_LEVELS.stranger.label).toBe("知らない人");
      expect(INTIMACY_LEVELS.best_friend.label).toBe("親友");
    });
  });
});

describe("Other Perspective Waveform", () => {
  // 予測の重み付け計算
  function calculateWeightedPrediction(
    predictions: Array<{ virtueCount: number; mineCount: number; weight: number }>
  ): { totalVirtue: number; totalMine: number } {
    let totalVirtue = 0;
    let totalMine = 0;
    let totalWeight = 0;

    for (const pred of predictions) {
      totalVirtue += pred.virtueCount * pred.weight;
      totalMine += pred.mineCount * pred.weight;
      totalWeight += pred.weight;
    }

    if (totalWeight === 0) {
      return { totalVirtue: 0, totalMine: 0 };
    }

    return {
      totalVirtue: Math.round(totalVirtue / totalWeight),
      totalMine: Math.round(totalMine / totalWeight),
    };
  }

  // 自己認識ギャップの計算
  function calculateSelfReportGap(
    selfWaveform: { virtueRatio: number; mineRatio: number },
    otherWaveform: { virtueRatio: number; mineRatio: number }
  ): number {
    const virtueGap = Math.abs(selfWaveform.virtueRatio - otherWaveform.virtueRatio);
    const mineGap = Math.abs(selfWaveform.mineRatio - otherWaveform.mineRatio);
    return (virtueGap + mineGap) / 2;
  }

  describe("calculateWeightedPrediction", () => {
    it("should weight predictions by intimacy", () => {
      const predictions = [
        { virtueCount: 10, mineCount: 2, weight: 1.0 }, // 親友
        { virtueCount: 5, mineCount: 5, weight: 0.2 },  // 知らない人
      ];
      const result = calculateWeightedPrediction(predictions);
      // 親友の予測が重視されるので、徳が多くなる
      expect(result.totalVirtue).toBeGreaterThan(result.totalMine);
    });

    it("should return zero for empty predictions", () => {
      const result = calculateWeightedPrediction([]);
      expect(result.totalVirtue).toBe(0);
      expect(result.totalMine).toBe(0);
    });

    it("should handle single prediction", () => {
      const predictions = [{ virtueCount: 10, mineCount: 5, weight: 0.5 }];
      const result = calculateWeightedPrediction(predictions);
      expect(result.totalVirtue).toBe(10);
      expect(result.totalMine).toBe(5);
    });
  });

  describe("calculateSelfReportGap", () => {
    it("should return 0 for identical waveforms", () => {
      const gap = calculateSelfReportGap(
        { virtueRatio: 0.7, mineRatio: 0.3 },
        { virtueRatio: 0.7, mineRatio: 0.3 }
      );
      expect(gap).toBe(0);
    });

    it("should return positive value for different waveforms", () => {
      const gap = calculateSelfReportGap(
        { virtueRatio: 0.8, mineRatio: 0.2 },
        { virtueRatio: 0.5, mineRatio: 0.5 }
      );
      expect(gap).toBeGreaterThan(0);
    });

    it("should return higher gap for more different waveforms", () => {
      const smallGap = calculateSelfReportGap(
        { virtueRatio: 0.7, mineRatio: 0.3 },
        { virtueRatio: 0.6, mineRatio: 0.4 }
      );
      const largeGap = calculateSelfReportGap(
        { virtueRatio: 0.9, mineRatio: 0.1 },
        { virtueRatio: 0.3, mineRatio: 0.7 }
      );
      expect(largeGap).toBeGreaterThan(smallGap);
    });
  });
});

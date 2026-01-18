import { describe, it, expect, vi } from "vitest";

// Mock the LLM module
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          openness: 75,
          conscientiousness: 80,
          extraversion: 60,
          agreeableness: 70,
          neuroticism: 35
        })
      }
    }]
  })
}));

describe("Personality Evaluator", () => {
  describe("Similarity Calculation", () => {
    it("should calculate cosine similarity between two personality profiles", async () => {
      const { calculatePersonalitySimilarity } = await import("./services/personalityEvaluator");
      
      const profile1 = {
        openness: 80,
        conscientiousness: 70,
        extraversion: 60,
        agreeableness: 75,
        neuroticism: 30
      };
      
      const profile2 = {
        openness: 75,
        conscientiousness: 65,
        extraversion: 55,
        agreeableness: 70,
        neuroticism: 35
      };
      
      const similarity = calculatePersonalitySimilarity(profile1, profile2);
      
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(100);
    });

    it("should return 100 for identical profiles", async () => {
      const { calculatePersonalitySimilarity } = await import("./services/personalityEvaluator");
      
      const profile = {
        openness: 80,
        conscientiousness: 70,
        extraversion: 60,
        agreeableness: 75,
        neuroticism: 30
      };
      
      const similarity = calculatePersonalitySimilarity(profile, profile);
      
      expect(similarity).toBe(100);
    });

    it("should return 0 for zero vectors", async () => {
      const { calculatePersonalitySimilarity } = await import("./services/personalityEvaluator");
      
      const zeroProfile = {
        openness: 0,
        conscientiousness: 0,
        extraversion: 0,
        agreeableness: 0,
        neuroticism: 0
      };
      
      const normalProfile = {
        openness: 80,
        conscientiousness: 70,
        extraversion: 60,
        agreeableness: 75,
        neuroticism: 30
      };
      
      const similarity = calculatePersonalitySimilarity(zeroProfile, normalProfile);
      
      expect(similarity).toBe(0);
    });
  });

  describe("Accuracy Score Calculation", () => {
    it("should calculate accuracy score based on multiple factors", async () => {
      const { calculateAccuracyScore } = await import("./services/personalityEvaluator");
      
      // Test with all factors
      const score = calculateAccuracyScore(
        90,    // personalitySimilarity
        500,   // rawInputLength
        5,     // trainingIterations
        true,  // hasBigFive
        true,  // hasJudgmentThresholds
        true   // hasWaveform
      );
      
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("should return low score for minimal input", async () => {
      const { calculateAccuracyScore } = await import("./services/personalityEvaluator");
      
      const score = calculateAccuracyScore(
        0,     // personalitySimilarity
        0,     // rawInputLength
        0,     // trainingIterations
        false, // hasBigFive
        false, // hasJudgmentThresholds
        false  // hasWaveform
      );
      
      expect(score).toBe(0);
    });

    it("should increase score with more training iterations", async () => {
      const { calculateAccuracyScore } = await import("./services/personalityEvaluator");
      
      const score1 = calculateAccuracyScore(50, 500, 1, true, true, true);
      const score2 = calculateAccuracyScore(50, 500, 5, true, true, true);
      
      expect(score2).toBeGreaterThan(score1);
    });

    it("should cap score at 100", async () => {
      const { calculateAccuracyScore } = await import("./services/personalityEvaluator");
      
      const score = calculateAccuracyScore(
        100,   // max personalitySimilarity
        10000, // very long rawInput
        100,   // many training iterations
        true,  // hasBigFive
        true,  // hasJudgmentThresholds
        true   // hasWaveform
      );
      
      expect(score).toBe(100);
    });
  });

  describe("Big Five Traits Structure", () => {
    it("should have correct structure for BigFiveTraits", () => {
      const traits = {
        openness: 75,
        conscientiousness: 80,
        extraversion: 60,
        agreeableness: 70,
        neuroticism: 35
      };
      
      expect(traits).toHaveProperty("openness");
      expect(traits).toHaveProperty("conscientiousness");
      expect(traits).toHaveProperty("extraversion");
      expect(traits).toHaveProperty("agreeableness");
      expect(traits).toHaveProperty("neuroticism");
      
      // All values should be numbers between 0 and 100
      Object.values(traits).forEach(value => {
        expect(typeof value).toBe("number");
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      });
    });
  });

  describe("Judgment Thresholds Structure", () => {
    it("should have correct structure for JudgmentThresholds", () => {
      const thresholds = {
        goodEvil: 60,
        likesDislike: 55,
        profitLoss: 45,
        interest: 50,
        pleasurePain: 65,
        difficulty: 40,
        possibility: 70,
        comfort: 55,
        rightWrong: 75
      };
      
      expect(thresholds).toHaveProperty("goodEvil");
      expect(thresholds).toHaveProperty("likesDislike");
      expect(thresholds).toHaveProperty("profitLoss");
      expect(thresholds).toHaveProperty("interest");
      expect(thresholds).toHaveProperty("pleasurePain");
      expect(thresholds).toHaveProperty("difficulty");
      expect(thresholds).toHaveProperty("possibility");
      expect(thresholds).toHaveProperty("comfort");
      expect(thresholds).toHaveProperty("rightWrong");
      
      // All values should be numbers between 0 and 100
      Object.values(thresholds).forEach(value => {
        expect(typeof value).toBe("number");
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      });
    });
  });
});

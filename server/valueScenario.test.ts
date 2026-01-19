import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM module
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          judgmentScores: {
            goodEvil: 50,
            likesDislike: 30,
            profitLoss: -20,
            interest: 10,
            pleasurePain: 0,
            difficulty: -10,
            possibility: 40,
            comfort: 20,
            rightWrong: 60,
          },
          virtueIndicators: ["誠実さ", "責任感"],
          mineIndicators: [],
          analysisNotes: "テスト分析結果",
        }),
      },
    }],
  }),
}));

// Mock the database module
vi.mock('./db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockResolvedValue({}),
  }),
}));

import { 
  VALUE_SCENARIOS, 
  SCENARIO_CATEGORIES, 
  JUDGMENT_CRITERIA,
  analyzeScenarioResponse,
} from './services/valueScenarioService';

describe('Value Scenario Service', () => {
  describe('VALUE_SCENARIOS', () => {
    it('should have 18 scenarios', () => {
      expect(VALUE_SCENARIOS.length).toBe(18);
    });

    it('should have all required fields for each scenario', () => {
      VALUE_SCENARIOS.forEach(scenario => {
        expect(scenario).toHaveProperty('id');
        expect(scenario).toHaveProperty('category');
        expect(scenario).toHaveProperty('text');
        expect(typeof scenario.id).toBe('string');
        expect(typeof scenario.category).toBe('string');
        expect(typeof scenario.text).toBe('string');
      });
    });

    it('should have unique scenario IDs', () => {
      const ids = VALUE_SCENARIOS.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have valid categories', () => {
      const validCategories = Object.keys(SCENARIO_CATEGORIES);
      VALUE_SCENARIOS.forEach(scenario => {
        expect(validCategories).toContain(scenario.category);
      });
    });
  });

  describe('SCENARIO_CATEGORIES', () => {
    it('should have 7 categories', () => {
      expect(Object.keys(SCENARIO_CATEGORIES).length).toBe(7);
    });

    it('should have all expected categories', () => {
      expect(SCENARIO_CATEGORIES).toHaveProperty('disaster');
      expect(SCENARIO_CATEGORIES).toHaveProperty('business');
      expect(SCENARIO_CATEGORIES).toHaveProperty('relationship');
      expect(SCENARIO_CATEGORIES).toHaveProperty('ethics');
      expect(SCENARIO_CATEGORIES).toHaveProperty('money');
      expect(SCENARIO_CATEGORIES).toHaveProperty('lifestyle');
      expect(SCENARIO_CATEGORIES).toHaveProperty('social');
    });
  });

  describe('JUDGMENT_CRITERIA', () => {
    it('should have 9 judgment criteria', () => {
      expect(JUDGMENT_CRITERIA.length).toBe(9);
    });

    it('should have all expected criteria', () => {
      expect(JUDGMENT_CRITERIA).toContain('goodEvil');
      expect(JUDGMENT_CRITERIA).toContain('likesDislike');
      expect(JUDGMENT_CRITERIA).toContain('profitLoss');
      expect(JUDGMENT_CRITERIA).toContain('interest');
      expect(JUDGMENT_CRITERIA).toContain('pleasurePain');
      expect(JUDGMENT_CRITERIA).toContain('difficulty');
      expect(JUDGMENT_CRITERIA).toContain('possibility');
      expect(JUDGMENT_CRITERIA).toContain('comfort');
      expect(JUDGMENT_CRITERIA).toContain('rightWrong');
    });
  });

  describe('analyzeScenarioResponse', () => {
    it('should return analysis result with all required fields', async () => {
      const scenarioText = "テストシナリオ";
      const userResponse = "テスト回答";
      
      const result = await analyzeScenarioResponse(scenarioText, userResponse);
      
      expect(result).toHaveProperty('judgmentScores');
      expect(result).toHaveProperty('virtueIndicators');
      expect(result).toHaveProperty('mineIndicators');
      expect(result).toHaveProperty('analysisNotes');
    });

    it('should return judgment scores for all 9 criteria', async () => {
      const result = await analyzeScenarioResponse("テスト", "テスト");
      
      const scores = result.judgmentScores;
      expect(scores).toHaveProperty('goodEvil');
      expect(scores).toHaveProperty('likesDislike');
      expect(scores).toHaveProperty('profitLoss');
      expect(scores).toHaveProperty('interest');
      expect(scores).toHaveProperty('pleasurePain');
      expect(scores).toHaveProperty('difficulty');
      expect(scores).toHaveProperty('possibility');
      expect(scores).toHaveProperty('comfort');
      expect(scores).toHaveProperty('rightWrong');
    });
  });
});

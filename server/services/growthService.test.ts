import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  experienceActions,
  skillDefinitions,
  evolutionTypes,
  milestoneDefinitions,
  getRequiredExperience,
} from "../../drizzle/schema";
import {
  getAIProviderForSkill,
  getAvailableSkillPoints,
  getSkillDefinitions,
} from "./growthService";

// 定義のテスト
describe("Growth System Definitions", () => {
  describe("experienceActions", () => {
    it("should have all required action types", () => {
      const requiredActions = [
        "conversation",
        "imageGeneration",
        "friendPrediction",
        "scenarioAnswer",
        "diagnosticComplete",
        "dailyLogin",
        "consecutiveLogin7",
        "consecutiveLogin30",
        "knowledgeAdd",
        "friendAdd",
        "matchingComplete",
        "praiseReceived",
      ];
      
      for (const action of requiredActions) {
        expect(experienceActions).toHaveProperty(action);
        expect(experienceActions[action as keyof typeof experienceActions]).toHaveProperty("exp");
        expect(experienceActions[action as keyof typeof experienceActions]).toHaveProperty("description");
      }
    });

    it("should have positive exp values", () => {
      for (const [action, def] of Object.entries(experienceActions)) {
        expect(def.exp).toBeGreaterThan(0);
      }
    });
  });

  describe("skillDefinitions", () => {
    it("should have all required skill types", () => {
      const requiredSkills = [
        "conversation",
        "imageGeneration",
        "analysis",
        "diagnosis",
        "matching",
      ];
      
      for (const skill of requiredSkills) {
        expect(skillDefinitions).toHaveProperty(skill);
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("name");
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("description");
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("maxLevel");
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("aiProviders");
      }
    });

    it("should have max level of 5 for all skills", () => {
      for (const [skill, def] of Object.entries(skillDefinitions)) {
        expect(def.maxLevel).toBe(5);
      }
    });

    it("should have AI providers for levels 1-5", () => {
      for (const [skill, def] of Object.entries(skillDefinitions)) {
        expect(def.aiProviders[1]).toBeDefined();
        expect(def.aiProviders[2]).toBeDefined();
        expect(def.aiProviders[3]).toBeDefined();
        expect(def.aiProviders[4]).toBeDefined();
        expect(def.aiProviders[5]).toBeDefined();
      }
    });
  });

  describe("evolutionTypes", () => {
    it("should have all required evolution types", () => {
      const requiredTypes = [
        "basic",
        "social",
        "creative",
        "analyst",
        "empath",
        "sage",
        "legendary",
      ];
      
      for (const type of requiredTypes) {
        expect(evolutionTypes).toHaveProperty(type);
        expect(evolutionTypes[type as keyof typeof evolutionTypes]).toHaveProperty("name");
        expect(evolutionTypes[type as keyof typeof evolutionTypes]).toHaveProperty("description");
        expect(evolutionTypes[type as keyof typeof evolutionTypes]).toHaveProperty("icon");
        // colorはオプショナル
      }
    });

    it("should have unique names", () => {
      const names = Object.values(evolutionTypes).map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("milestoneDefinitions", () => {
    it("should have all required milestone types", () => {
      const requiredMilestones = [
        "first_conversation",
        "conversations_10",
        "conversations_50",
        "conversations_100",
        "conversations_500",
        "first_image",
        "images_10",
        "images_50",
        "first_friend",
        "friends_5",
        "friends_10",
        "first_evolution",
        "evolution_social",
        "evolution_creative",
        "evolution_analyst",
        "evolution_empath",
        "evolution_sage",
        "evolution_legendary",
        "level_10",
        "level_25",
        "level_50",
        "level_100",
        "week_streak",
        "month_streak",
      ];
      
      for (const milestone of requiredMilestones) {
        expect(milestoneDefinitions).toHaveProperty(milestone);
        expect(milestoneDefinitions[milestone as keyof typeof milestoneDefinitions]).toHaveProperty("title");
        expect(milestoneDefinitions[milestone as keyof typeof milestoneDefinitions]).toHaveProperty("description");
        expect(milestoneDefinitions[milestone as keyof typeof milestoneDefinitions]).toHaveProperty("icon");
      }
    });
  });

  describe("getRequiredExperience", () => {
    it("should return 0 for level 1", () => {
      expect(getRequiredExperience(1)).toBe(0);
    });

    it("should increase exponentially", () => {
      const exp2 = getRequiredExperience(2);
      const exp3 = getRequiredExperience(3);
      const exp4 = getRequiredExperience(4);
      
      expect(exp3 - exp2).toBeGreaterThan(exp2);
      expect(exp4 - exp3).toBeGreaterThan(exp3 - exp2);
    });

    it("should return reasonable values for high levels", () => {
      const exp50 = getRequiredExperience(50);
      const exp100 = getRequiredExperience(100);
      
      expect(exp50).toBeGreaterThan(10000);
      expect(exp100).toBeGreaterThan(exp50);
    });
  });
});

// レベルアップロジックのテスト
describe("Level Up Logic", () => {
  it("should calculate correct level from experience", () => {
    // レベル1: 0 exp
    // レベル2: 100 exp (100 * 1.2^1)
    // レベル3: 220 exp (100 * 1.2^1 + 100 * 1.2^2)
    
    const checkLevel = (totalExp: number): number => {
      let level = 1;
      while (level < 100) {
        const requiredExp = getRequiredExperience(level + 1);
        if (totalExp >= requiredExp) {
          level++;
        } else {
          break;
        }
      }
      return level;
    };
    
    expect(checkLevel(0)).toBe(1);
    expect(checkLevel(50)).toBe(1);
    expect(checkLevel(100)).toBe(2);
    expect(checkLevel(500)).toBeGreaterThan(2);
  });
});

// 進化条件のテスト
describe("Evolution Conditions", () => {
  it("should have basic as the starting type", () => {
    expect(evolutionTypes.basic).toBeDefined();
    expect(evolutionTypes.basic.name).toBe("ベーシック");
  });

  it("should have legendary as the highest evolution", () => {
    expect(evolutionTypes.legendary).toBeDefined();
    expect(evolutionTypes.legendary.name).toBe("レジェンド型");
  });
});

// AIプロバイダー取得のテスト
describe("getAIProviderForSkill", () => {
  it("should return correct AI provider for conversation skill at level 1", () => {
    const result = getAIProviderForSkill("conversation", 1);
    expect(result).toEqual({ provider: "builtin", model: "basic", cost: 0 });
  });

  it("should return correct AI provider for conversation skill at level 5", () => {
    const result = getAIProviderForSkill("conversation", 5);
    expect(result).toEqual({ provider: "anthropic", model: "claude-3-5-sonnet", cost: 3 });
  });

  it("should return correct AI provider for imageGeneration skill at level 1", () => {
    const result = getAIProviderForSkill("imageGeneration", 1);
    expect(result).toEqual({ provider: "dalle", model: "dall-e-2", cost: 1 });
  });

  it("should return correct AI provider for imageGeneration skill at level 5", () => {
    const result = getAIProviderForSkill("imageGeneration", 5);
    expect(result).toEqual({ provider: "nano_banana_pro", model: "latest", cost: 3 });
  });

  it("should return correct AI provider for analysis skill at level 3", () => {
    const result = getAIProviderForSkill("analysis", 3);
    expect(result).toEqual({ provider: "openai", model: "gpt-4o-mini", cost: 2 });
  });

  it("should return default provider for invalid skill type", () => {
    // @ts-expect-error Testing invalid input
    const result = getAIProviderForSkill("invalid", 1);
    expect(result).toEqual({ provider: "builtin", model: "basic", cost: 0 });
  });
});

// スキルポイントのテスト
describe("getAvailableSkillPoints", () => {
  it("should return 15 points for normal mode", () => {
    const result = getAvailableSkillPoints(false);
    expect(result).toBe(15);
  });

  it("should return 25 points for campaign mode", () => {
    const result = getAvailableSkillPoints(true);
    expect(result).toBe(25);
  });
});

// スキル定義取得のテスト
describe("getSkillDefinitions", () => {
  it("should return all skill definitions", () => {
    const result = getSkillDefinitions();
    expect(result).toBeDefined();
    expect(result.conversation).toBeDefined();
    expect(result.imageGeneration).toBeDefined();
    expect(result.analysis).toBeDefined();
    expect(result.diagnosis).toBeDefined();
    expect(result.matching).toBeDefined();
  });

  it("should have correct structure for each skill", () => {
    const result = getSkillDefinitions();
    
    for (const [key, skill] of Object.entries(result)) {
      expect(skill.name).toBeDefined();
      expect(skill.description).toBeDefined();
      expect(skill.icon).toBeDefined();
      expect(skill.maxLevel).toBe(5);
      expect(skill.aiProviders).toBeDefined();
      expect(skill.aiProviders[1]).toBeDefined();
      expect(skill.aiProviders[5]).toBeDefined();
    }
  });

  it("should have increasing cost for higher levels", () => {
    const result = getSkillDefinitions();
    
    for (const [key, skill] of Object.entries(result)) {
      const level1Cost = skill.aiProviders[1].cost;
      const level5Cost = skill.aiProviders[5].cost;
      expect(level5Cost).toBeGreaterThanOrEqual(level1Cost);
    }
  });
});

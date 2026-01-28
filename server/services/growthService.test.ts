import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  experienceActions,
  skillDefinitions,
  evolutionTypes,
  milestoneDefinitions,
  getRequiredExperience,
} from "../../drizzle/schema";

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
        "empathy",
        "creativity",
        "analysis",
        "prediction",
        "memory",
        "wisdom",
        "humor",
      ];
      
      for (const skill of requiredSkills) {
        expect(skillDefinitions).toHaveProperty(skill);
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("name");
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("description");
        expect(skillDefinitions[skill as keyof typeof skillDefinitions]).toHaveProperty("maxLevel");
      }
    });

    it("should have valid max levels", () => {
      for (const [skill, def] of Object.entries(skillDefinitions)) {
        expect(def.maxLevel).toBeGreaterThanOrEqual(5);
        expect(def.maxLevel).toBeLessThanOrEqual(20);
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

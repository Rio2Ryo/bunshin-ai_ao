/**
 * 人格評価サービス
 * - ビッグ・ファイブ性格診断
 * - 9つの判断基準の閾値分析
 * - 徳波形・地雷波形の生成
 * - 性格類似度算出
 */

import { invokeLLM } from "../_core/llm";
import type { BigFiveTraits, JudgmentThresholds, ValueWaveform } from "../../drizzle/schema";

/**
 * ビッグ・ファイブ性格診断を実行
 * ユーザーの入力情報から5つの性格特性を数値化
 */
export async function analyzeBigFiveTraits(
  rawInput: string,
  personality: string | null,
  description: string | null
): Promise<BigFiveTraits> {
  const prompt = `あなたは心理学の専門家です。以下のユーザー情報から、ビッグ・ファイブ理論に基づく5つの性格特性を分析してください。

【ユーザー情報】
${rawInput}

${personality ? `【性格情報】\n${personality}` : ""}
${description ? `【説明】\n${description}` : ""}

【ビッグ・ファイブ理論の5つの特性】
1. 開放性 (Openness): 芸術、感情、冒険、想像力、好奇心への評価。新しい経験や知識への関心度。
2. 誠実性 (Conscientiousness): 自制力、誠実に行動し期待に対して成就を追求する傾向。計画性や責任感。
3. 外向性 (Extraversion): 多様な活動や外部環境からエネルギーを得る特性。社交性や積極性。
4. 協調性 (Agreeableness): 社会的調和と個人を調整しようとする特性。思いやりや協力性。
5. 神経症的傾向 (Neuroticism): 怒り、不安、うつ病等の否定的感情を感じやすい傾向。感情の安定性（逆転）。

各特性を0-100のスコアで評価してください。
- 0: その特性が非常に低い
- 50: 平均的
- 100: その特性が非常に高い

必ず以下のJSON形式で回答してください：`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "あなたは心理学の専門家です。ビッグ・ファイブ理論に基づいて性格を分析します。" },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "big_five_traits",
        strict: true,
        schema: {
          type: "object",
          properties: {
            openness: { 
              type: "number", 
              description: "開放性スコア (0-100)" 
            },
            conscientiousness: { 
              type: "number", 
              description: "誠実性スコア (0-100)" 
            },
            extraversion: { 
              type: "number", 
              description: "外向性スコア (0-100)" 
            },
            agreeableness: { 
              type: "number", 
              description: "協調性スコア (0-100)" 
            },
            neuroticism: { 
              type: "number", 
              description: "神経症的傾向スコア (0-100)" 
            },
            analysis: {
              type: "string",
              description: "分析の根拠と説明"
            }
          },
          required: ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism", "analysis"],
          additionalProperties: false
        }
      }
    }
  });

  const rawContent = response.choices[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  if (!content) {
    throw new Error("ビッグ・ファイブ分析に失敗しました");
  }

  const result = JSON.parse(content);
  return {
    openness: Math.min(100, Math.max(0, result.openness)),
    conscientiousness: Math.min(100, Math.max(0, result.conscientiousness)),
    extraversion: Math.min(100, Math.max(0, result.extraversion)),
    agreeableness: Math.min(100, Math.max(0, result.agreeableness)),
    neuroticism: Math.min(100, Math.max(0, result.neuroticism))
  };
}

/**
 * 9つの判断基準の閾値を分析
 */
export async function analyzeJudgmentThresholds(
  rawInput: string,
  personality: string | null,
  description: string | null
): Promise<JudgmentThresholds> {
  const prompt = `あなたは心理学の専門家です。以下のユーザー情報から、9つの判断基準における閾値（価値観の傾向）を分析してください。

【ユーザー情報】
${rawInput}

${personality ? `【性格情報】\n${personality}` : ""}
${description ? `【説明】\n${description}` : ""}

【9つの判断基準】
1. 善悪: 道徳的な判断の厳しさ (0=寛容, 100=厳格)
2. 好き嫌い: 好みへのこだわり (0=何でもOK, 100=強いこだわり)
3. 損得: 損得勘定の重視度 (0=気にしない, 100=非常に重視)
4. 利害: 利害関係の重視度 (0=気にしない, 100=非常に重視)
5. 苦楽: 快楽主義の度合い (0=苦労をいとわない, 100=楽さ重視)
6. 難易: 挑戦への姿勢 (0=難しいことに挑戦, 100=簡単なことを好む)
7. 可否: リスク許容度 (0=何でも試す, 100=確実なことのみ)
8. 快不快: 快適さへのこだわり (0=不快に寛容, 100=快適さ重視)
9. 正誤: 正確さへのこだわり (0=曖昧さを許容, 100=正確さ重視)

各基準を0-100のスコアで評価してください。`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "あなたは心理学の専門家です。価値観の閾値を分析します。" },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "judgment_thresholds",
        strict: true,
        schema: {
          type: "object",
          properties: {
            goodEvil: { type: "number", description: "善悪の閾値 (0-100)" },
            likesDislike: { type: "number", description: "好き嫌いの閾値 (0-100)" },
            profitLoss: { type: "number", description: "損得の閾値 (0-100)" },
            interest: { type: "number", description: "利害の閾値 (0-100)" },
            pleasurePain: { type: "number", description: "苦楽の閾値 (0-100)" },
            difficulty: { type: "number", description: "難易の閾値 (0-100)" },
            possibility: { type: "number", description: "可否の閾値 (0-100)" },
            comfort: { type: "number", description: "快不快の閾値 (0-100)" },
            rightWrong: { type: "number", description: "正誤の閾値 (0-100)" },
            analysis: { type: "string", description: "分析の根拠と説明" }
          },
          required: ["goodEvil", "likesDislike", "profitLoss", "interest", "pleasurePain", "difficulty", "possibility", "comfort", "rightWrong", "analysis"],
          additionalProperties: false
        }
      }
    }
  });

  const rawContent2 = response.choices[0]?.message?.content;
  const content = typeof rawContent2 === 'string' ? rawContent2 : JSON.stringify(rawContent2);
  if (!content) {
    throw new Error("判断基準分析に失敗しました");
  }

  const result = JSON.parse(content);
  return {
    goodEvil: Math.min(100, Math.max(0, result.goodEvil)),
    likesDislike: Math.min(100, Math.max(0, result.likesDislike)),
    profitLoss: Math.min(100, Math.max(0, result.profitLoss)),
    interest: Math.min(100, Math.max(0, result.interest)),
    pleasurePain: Math.min(100, Math.max(0, result.pleasurePain)),
    difficulty: Math.min(100, Math.max(0, result.difficulty)),
    possibility: Math.min(100, Math.max(0, result.possibility)),
    comfort: Math.min(100, Math.max(0, result.comfort)),
    rightWrong: Math.min(100, Math.max(0, result.rightWrong))
  };
}

/**
 * 徳波形・地雷波形を生成
 * 他の分身AIの視点から評価を行う
 */
export async function evaluateValueWaveform(
  targetTwin: {
    id: number;
    name: string;
    rawInput: string | null;
    personality: string | null;
    description: string | null;
  },
  evaluatorTwins: {
    id: number;
    name: string;
    personality: string | null;
    judgmentThresholds: JudgmentThresholds | null;
  }[]
): Promise<{ virtueWaveform: ValueWaveform; mineWaveform: ValueWaveform }> {
  const evaluations: ValueWaveform["evaluations"] = [];

  for (const evaluator of evaluatorTwins) {
    const prompt = `あなたは「${evaluator.name}」という人物です。
${evaluator.personality ? `あなたの性格: ${evaluator.personality}` : ""}

以下の人物「${targetTwin.name}」について、あなたの価値観から評価してください。

【${targetTwin.name}の情報】
${targetTwin.rawInput || "情報なし"}
${targetTwin.personality ? `性格: ${targetTwin.personality}` : ""}
${targetTwin.description ? `説明: ${targetTwin.description}` : ""}

【評価基準】
- 徳（プラス評価）: 感謝できる点、称賛できる点、共感できる点
- 地雷（マイナス評価）: 受け入れられない点、問題と感じる点、警戒すべき点

あなたの価値観に基づいて、この人物を0-100で評価してください。`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: `あなたは「${evaluator.name}」として、他者を評価します。` },
        { role: "user", content: prompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "value_evaluation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              virtueScore: { type: "number", description: "徳スコア (0-100)" },
              mineScore: { type: "number", description: "地雷スコア (0-100)" },
              virtueReasons: { 
                type: "array", 
                items: { type: "string" },
                description: "徳と評価した理由（3つ程度）" 
              },
              mineReasons: { 
                type: "array", 
                items: { type: "string" },
                description: "地雷と評価した理由（3つ程度）" 
              }
            },
            required: ["virtueScore", "mineScore", "virtueReasons", "mineReasons"],
            additionalProperties: false
          }
        }
      }
    });

    const rawContent3 = response.choices[0]?.message?.content;
    const content = typeof rawContent3 === 'string' ? rawContent3 : JSON.stringify(rawContent3);
    if (content) {
      const result = JSON.parse(content);
      evaluations.push({
        evaluatorId: evaluator.id,
        evaluatorName: evaluator.name,
        virtueScore: Math.min(100, Math.max(0, result.virtueScore)),
        mineScore: Math.min(100, Math.max(0, result.mineScore)),
        reasons: [...(result.virtueReasons || []), ...(result.mineReasons || [])]
      });
    }
  }

  // 総合スコアを計算
  const totalVirtueScore = evaluations.length > 0
    ? evaluations.reduce((sum, e) => sum + e.virtueScore, 0) / evaluations.length
    : 0;
  const totalMineScore = evaluations.length > 0
    ? evaluations.reduce((sum, e) => sum + e.mineScore, 0) / evaluations.length
    : 0;

  const waveform: ValueWaveform = {
    evaluations,
    totalVirtueScore,
    totalMineScore,
    lastUpdated: new Date().toISOString()
  };

  return {
    virtueWaveform: waveform,
    mineWaveform: waveform
  };
}

/**
 * 性格類似度を算出（コサイン類似度）
 */
export function calculatePersonalitySimilarity(
  traits1: BigFiveTraits,
  traits2: BigFiveTraits
): number {
  // ベクトルとして扱う
  const v1 = [
    traits1.openness,
    traits1.conscientiousness,
    traits1.extraversion,
    traits1.agreeableness,
    traits1.neuroticism
  ];
  const v2 = [
    traits2.openness,
    traits2.conscientiousness,
    traits2.extraversion,
    traits2.agreeableness,
    traits2.neuroticism
  ];

  // コサイン類似度を計算
  const dotProduct = v1.reduce((sum, val, i) => sum + val * v2[i], 0);
  const magnitude1 = Math.sqrt(v1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(v2.reduce((sum, val) => sum + val * val, 0));

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  // コサイン類似度を0-100のスコアに変換
  const cosineSimilarity = dotProduct / (magnitude1 * magnitude2);
  return Math.round(cosineSimilarity * 100);
}

/**
 * 分身AIの精度スコアを算出
 * - 性格類似度
 * - 情報の充実度
 * - 学習回数
 */
export function calculateAccuracyScore(
  personalitySimilarity: number,
  rawInputLength: number,
  trainingIterations: number,
  hasBigFive: boolean,
  hasJudgmentThresholds: boolean,
  hasWaveform: boolean
): number {
  let score = 0;

  // 性格類似度（最大40点）
  score += (personalitySimilarity / 100) * 40;

  // 情報の充実度（最大30点）
  const infoScore = Math.min(30, (rawInputLength / 1000) * 10);
  score += infoScore;

  // 学習回数（最大15点）
  const trainingScore = Math.min(15, trainingIterations * 3);
  score += trainingScore;

  // 分析完了度（最大15点）
  if (hasBigFive) score += 5;
  if (hasJudgmentThresholds) score += 5;
  if (hasWaveform) score += 5;

  return Math.round(Math.min(100, score));
}

/**
 * ユーザーとの自由会話形式の性格診断を実行
 */
export async function conductPersonalityInterview(
  previousMessages: { role: "user" | "assistant"; content: string }[],
  userResponse?: string
): Promise<{ question: string; isComplete: boolean; traits?: BigFiveTraits }> {
  const systemPrompt = `あなたは心理学の専門家で、ビッグ・ファイブ理論に基づいた性格診断を行っています。
自由会話形式で質問を行い、相手の性格を深く理解してください。

【質問のガイドライン】
- 具体的なシチュエーションを想定した質問をする
- 「はい/いいえ」で答えられない開放的な質問をする
- 相手の回答に基づいて深掘りする
- 5-7回の質問で診断を完了させる

【診断する5つの特性】
1. 開放性: 新しい経験への関心
2. 誠実性: 計画性と責任感
3. 外向性: 社交性と積極性
4. 協調性: 思いやりと協力性
5. 神経症的傾向: 感情の安定性`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...previousMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
  ];

  if (userResponse) {
    messages.push({ role: "user" as const, content: userResponse });
  }

  const response = await invokeLLM({
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "personality_interview",
        strict: true,
        schema: {
          type: "object",
          properties: {
            nextQuestion: { type: "string", description: "次の質問" },
            isComplete: { type: "boolean", description: "診断が完了したかどうか" },
            traits: {
              type: "object",
              properties: {
                openness: { type: "number" },
                conscientiousness: { type: "number" },
                extraversion: { type: "number" },
                agreeableness: { type: "number" },
                neuroticism: { type: "number" }
              },
              required: ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"],
              additionalProperties: false,
              description: "診断完了時のみ設定"
            }
          },
          required: ["nextQuestion", "isComplete"],
          additionalProperties: false
        }
      }
    }
  });

  const rawContent4 = response.choices[0]?.message?.content;
  const content = typeof rawContent4 === 'string' ? rawContent4 : JSON.stringify(rawContent4);
  if (!content) {
    throw new Error("性格診断の質問生成に失敗しました");
  }

  const result = JSON.parse(content);
  return {
    question: result.nextQuestion,
    isComplete: result.isComplete,
    traits: result.isComplete && result.traits ? {
      openness: Math.min(100, Math.max(0, result.traits.openness)),
      conscientiousness: Math.min(100, Math.max(0, result.traits.conscientiousness)),
      extraversion: Math.min(100, Math.max(0, result.traits.extraversion)),
      agreeableness: Math.min(100, Math.max(0, result.traits.agreeableness)),
      neuroticism: Math.min(100, Math.max(0, result.traits.neuroticism))
    } : undefined
  };
}

/**
 * 人格評価サービス
 * - ビッグ・ファイブ性格診断
 * - 9つの判断基準の閾値分析
 * - 徳波形・地雷波形の生成
 * - 性格類似度算出
 */

import { invokeLLM } from "../_core/llm";
import type { BigFiveTraits, JudgmentThresholds, ValueWaveform, MBTIType } from "../../drizzle/schema";

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

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...previousMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
  ];

  if (userResponse) {
    messages.push({ role: "user", content: userResponse });
  }

  // LLM APIにはシステムメッセージ以外のメッセージが必要
  // 初回の場合はユーザーからの開始メッセージを追加
  if (previousMessages.length === 0 && !userResponse) {
    messages.push({ role: "user", content: "性格診断を開始してください。最初の質問をお願いします。" });
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

  // エラーレスポンスをチェック
  if ('error' in response) {
    console.error("LLM API Error (personality):", response.error);
    throw new Error(`性格診断の質問生成に失敗しました: ${(response.error as any)?.message || 'Unknown error'}`);
  }

  const rawContent4 = response.choices?.[0]?.message?.content;
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

/**
 * MBTI性格診断を実行
 * ユーザーの入力情報から16タイプのいずれかを判定
 */
export async function analyzeMBTI(
  rawInput: string,
  personality: string | null,
  description: string | null,
  bigFiveTraits?: BigFiveTraits
): Promise<MBTIType> {
  const prompt = `あなたは心理学の専門家です。以下のユーザー情報から、MBTI（マイヤーズ・ブリッグス・タイプ指標）に基づく性格タイプを分析してください。

【ユーザー情報】
${rawInput}

${personality ? `【性格情報】\n${personality}` : ""}
${description ? `【説明】\n${description}` : ""}
${bigFiveTraits ? `【ビッグ・ファイブ分析結果】\n開放性: ${bigFiveTraits.openness}, 訠実性: ${bigFiveTraits.conscientiousness}, 外向性: ${bigFiveTraits.extraversion}, 協調性: ${bigFiveTraits.agreeableness}, 神経症的傾向: ${bigFiveTraits.neuroticism}` : ""}

【MBTIの4つの次元】
1. E/I (外向型/内向型): エネルギーの源泉
   - E (外向型): 他者との交流からエネルギーを得る
   - I (内向型): 一人の時間からエネルギーを得る

2. S/N (感覚型/直観型): 情報の取得方法
   - S (感覚型): 五感を通じた具体的な事実を重視
   - N (直観型): パターンや可能性を重視

3. T/F (思考型/感情型): 意思決定の方法
   - T (思考型): 論理と客観的分析を重視
   - F (感情型): 価値観と他者への影響を重視

4. J/P (判断型/知覚型): 生活スタイル
   - J (判断型): 計画的で組織的なアプローチ
   - P (知覚型): 柔軟で臨機応変なアプローチ

【16タイプの概要】
- INTJ (建築家): 戦略的思考者、独立心が強い
- INTP (論理学者): 分析的、創造的な問題解決者
- ENTJ (指揮官): リーダーシップ、決断力がある
- ENTP (討論者): 革新的、挑戦的
- INFJ (提唱者): 洞察力があり、理想主義的
- INFP (仲介者): 創造的、共感力が高い
- ENFJ (教育者): カリスマ的、他者を動機付ける
- ENFP (運動家): 熱意的、創造的
- ISTJ (管理者): 責任感が強く、信頼できる
- ISFJ (擁護者): 思いやりがあり、献身的
- ESTJ (幹部): 組織的、実用的
- ESFJ (領事): 社交的、協力的
- ISTP (巨匠): 実践的、観察力が高い
- ISFP (冒険家): 芸術的、柔軟
- ESTP (起業家): エネルギッシュ、行動的
- ESFP (エンターテイナー): 社交的、楽観的

各次元を-100から+100のスケールで評価してください。
- EI: -100 (完全な内向型) 〜 +100 (完全な外向型)
- SN: -100 (完全な感覚型) 〜 +100 (完全な直観型)
- TF: -100 (完全な思考型) 〜 +100 (完全な感情型)
- JP: -100 (完全な判断型) 〜 +100 (完全な知覚型)`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "あなたは心理学の専門家です。MBTIに基づいて性格を分析します。" },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mbti_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            type: { type: "string", description: "MBTIタイプ (INTJ, ENFPなど)" },
            dimensions: {
              type: "object",
              properties: {
                EI: { type: "number", description: "E/Iスコア (-100〜+100)" },
                SN: { type: "number", description: "S/Nスコア (-100〜+100)" },
                TF: { type: "number", description: "T/Fスコア (-100〜+100)" },
                JP: { type: "number", description: "J/Pスコア (-100〜+100)" }
              },
              required: ["EI", "SN", "TF", "JP"],
              additionalProperties: false
            },
            description: { type: "string", description: "タイプの説明" },
            strengths: { 
              type: "array", 
              items: { type: "string" },
              description: "強み（3つ程度）" 
            },
            weaknesses: { 
              type: "array", 
              items: { type: "string" },
              description: "弱み（3つ程度）" 
            },
            compatibleTypes: { 
              type: "array", 
              items: { type: "string" },
              description: "相性の良いタイプ（3つ程度）" 
            },
            careerSuggestions: { 
              type: "array", 
              items: { type: "string" },
              description: "適したキャリア（3つ程度）" 
            }
          },
          required: ["type", "dimensions", "description", "strengths", "weaknesses", "compatibleTypes", "careerSuggestions"],
          additionalProperties: false
        }
      }
    }
  });

  const rawContent = response.choices[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  if (!content) {
    throw new Error("MBTI分析に失敗しました");
  }

  const result = JSON.parse(content);
  return {
    type: result.type,
    dimensions: {
      EI: Math.min(100, Math.max(-100, result.dimensions.EI)),
      SN: Math.min(100, Math.max(-100, result.dimensions.SN)),
      TF: Math.min(100, Math.max(-100, result.dimensions.TF)),
      JP: Math.min(100, Math.max(-100, result.dimensions.JP))
    },
    description: result.description,
    strengths: result.strengths || [],
    weaknesses: result.weaknesses || [],
    compatibleTypes: result.compatibleTypes || [],
    careerSuggestions: result.careerSuggestions || []
  };
}

/**
 * MBTIインタビュー形式の性格診断
 * 自由会話形式で質問を行い、MBTIタイプを判定
 */
export async function conductMBTIInterview(
  previousMessages: { role: "user" | "assistant"; content: string }[],
  userResponse?: string
): Promise<{ question: string; isComplete: boolean; mbtiType?: MBTIType }> {
  const systemPrompt = `あなたは心理学の専門家で、MBTI（マイヤーズ・ブリッグス・タイプ指標）に基づいた性格診断を行っています。
自由会話形式で質問を行い、相手の性格タイプを判定してください。

【質問のガイドライン】
- 具体的なシチュエーションを想定した質問をする
- 「はい/いいえ」で答えられない開放的な質問をする
- 相手の回答に基づいて深堀りする
- 8-10回の質問で診断を完了させる
- 各質問は4つの次元（E/I, S/N, T/F, J/P）のいずれかを判定するためのもの

【4つの次元を判定する質問例】
E/I (外向/内向):
- 「休日の過ごし方で、最もリフレッシュできるのはどんな時ですか？」
- 「新しい環境に入ったとき、どのように人間関係を築きますか？」

S/N (感覚/直観):
- 「新しいプロジェクトを始めるとき、まず何から取りかかりますか？」
- 「問題を解決するとき、過去の経験と新しいアイデア、どちらを重視しますか？」

T/F (思考/感情):
- 「重要な決断をするとき、論理と感情のどちらを優先しますか？」
- 「友人が悩んでいるとき、どのようにサポートしますか？」

J/P (判断/知覚):
- 「旅行の計画を立てるとき、どの程度詳細に決めますか？」
- 「締め切りがあるタスクに対して、どのように取り組みますか？」`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...previousMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
  ];

  if (userResponse) {
    messages.push({ role: "user", content: userResponse });
  }

  // LLM APIにはシステムメッセージ以外のメッセージが必要
  // 初回の場合はユーザーからの開始メッセージを追加
  if (previousMessages.length === 0 && !userResponse) {
    messages.push({ role: "user", content: "MBTI性格診断を開始してください。最初の質問をお願いします。" });
  }

  const response = await invokeLLM({
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mbti_interview",
        strict: true,
        schema: {
          type: "object",
          properties: {
            nextQuestion: { type: "string", description: "次の質問" },
            isComplete: { type: "boolean", description: "診断が完了したかどうか" },
            mbtiType: {
              type: "object",
              properties: {
                type: { type: "string" },
                dimensions: {
                  type: "object",
                  properties: {
                    EI: { type: "number" },
                    SN: { type: "number" },
                    TF: { type: "number" },
                    JP: { type: "number" }
                  },
                  required: ["EI", "SN", "TF", "JP"],
                  additionalProperties: false
                },
                description: { type: "string" },
                strengths: { type: "array", items: { type: "string" } },
                weaknesses: { type: "array", items: { type: "string" } },
                compatibleTypes: { type: "array", items: { type: "string" } },
                careerSuggestions: { type: "array", items: { type: "string" } }
              },
              required: ["type", "dimensions", "description", "strengths", "weaknesses", "compatibleTypes", "careerSuggestions"],
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

  // エラーレスポンスをチェック
  if ('error' in response) {
    console.error("LLM API Error (MBTI):", response.error);
    throw new Error(`MBTI診断の質問生成に失敗しました: ${(response.error as any)?.message || 'Unknown error'}`);
  }

  const rawContent = response.choices?.[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  if (!content) {
    throw new Error("MBTI診断の質問生成に失敗しました");
  }

  const result = JSON.parse(content);
  return {
    question: result.nextQuestion,
    isComplete: result.isComplete,
    mbtiType: result.isComplete && result.mbtiType ? {
      type: result.mbtiType.type,
      dimensions: {
        EI: Math.min(100, Math.max(-100, result.mbtiType.dimensions.EI)),
        SN: Math.min(100, Math.max(-100, result.mbtiType.dimensions.SN)),
        TF: Math.min(100, Math.max(-100, result.mbtiType.dimensions.TF)),
        JP: Math.min(100, Math.max(-100, result.mbtiType.dimensions.JP))
      },
      description: result.mbtiType.description,
      strengths: result.mbtiType.strengths || [],
      weaknesses: result.mbtiType.weaknesses || [],
      compatibleTypes: result.mbtiType.compatibleTypes || [],
      careerSuggestions: result.mbtiType.careerSuggestions || []
    } : undefined
  };
}

/**
 * 統合性格診断（ビッグ・ファイブ + MBTI）
 * 両方の診断結果を統合して分身AIの精度を向上
 */
export async function runIntegratedPersonalityAnalysis(
  rawInput: string,
  personality: string | null,
  description: string | null
): Promise<{
  bigFiveTraits: BigFiveTraits;
  mbtiType: MBTIType;
  judgmentThresholds: JudgmentThresholds;
}> {
  // ビッグ・ファイブ分析
  const bigFiveTraits = await analyzeBigFiveTraits(rawInput, personality, description);
  
  // MBTI分析（ビッグ・ファイブの結果も参考に）
  const mbtiType = await analyzeMBTI(rawInput, personality, description, bigFiveTraits);
  
  // 判断基準分析
  const judgmentThresholds = await analyzeJudgmentThresholds(rawInput, personality, description);
  
  return {
    bigFiveTraits,
    mbtiType,
    judgmentThresholds
  };
}

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
 * 徳波形・G+(U)・地雷波形・G-(U)を生成
 * 特許ドキュメントに基づく実装:
 * - 複数の模倣人格（C1～Cn-1）がユーザーの言動を監視・評価
 * - 各言動項目について「徳」「地雷」「問題なし」を判定
 * - 9つの判断基準（善悪、好き嫌い、損得等）に基づく評価
 * - 評価の累積による波形生成
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
    // 評価者の判断基準をプロンプトに反映
    const thresholdsInfo = evaluator.judgmentThresholds 
      ? `
【あなたの判断基準の閾値】
- 善悪の判断基準: ${evaluator.judgmentThresholds.goodEvil}/100
- 好き嫌いの判断基準: ${evaluator.judgmentThresholds.likesDislike}/100
- 損得の判断基準: ${evaluator.judgmentThresholds.profitLoss}/100
- 利害の判断基準: ${evaluator.judgmentThresholds.interest}/100
- 苦楽の判断基準: ${evaluator.judgmentThresholds.pleasurePain}/100
- 難易の判断基準: ${evaluator.judgmentThresholds.difficulty}/100
- 可否の判断基準: ${evaluator.judgmentThresholds.possibility}/100
- 快不快の判断基準: ${evaluator.judgmentThresholds.comfort}/100
- 正誤の判断基準: ${evaluator.judgmentThresholds.rightWrong}/100`
      : "";

    const prompt = `あなたは「${evaluator.name}」という人物です。
${evaluator.personality ? `あなたの性格: ${evaluator.personality}` : ""}
${thresholdsInfo}

以下の人物「${targetTwin.name}」について、あなたの価値観と判断基準から評価してください。

【${targetTwin.name}の情報】
${targetTwin.rawInput || "情報なし"}
${targetTwin.personality ? `性格: ${targetTwin.personality}` : ""}
${targetTwin.description ? `説明: ${targetTwin.description}` : ""}

【評価の観点】
1. 徳（G+）: 感謝できる点、称賛できる点、共感できる点、肯定的な行為
2. 地雷（G-）: 受け入れられない点、問題と感じる点、警戒すべき点、否定的な行為

【9つの判断基準で評価】
各基準について-100～100で評価してください（マイナスはネガティブ、プラスはポジティブ）:
- 善悪: この人の行動は善いか悪いか
- 好き嫌い: この人を好きになれるか
- 損得: この人と関わることは得か損か
- 利害: この人は利益をもたらすか害をもたらすか
- 苦楽: この人との関係は楽しいか苦しいか
- 難易: この人とのコミュニケーションは簡単か難しいか
- 可否: この人との協力は可能か不可能か
- 快不快: この人との交流は快適か不快か
- 正誤: この人の考え方は正しいか間違っているか

あなたの価値観に基づいて、この人物を評価してください。`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: `あなたは「${evaluator.name}」として、他者を評価します。あなた独自の価値観・判断基準に基づいて評価してください。` },
        { role: "user", content: prompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "value_waveform_evaluation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              virtueScore: { type: "number", description: "徳スコア G+(U) (0-100)" },
              mineScore: { type: "number", description: "地雷スコア G-(U) (0-100)" },
              virtueReasons: { 
                type: "array", 
                items: { type: "string" },
                description: "徳と評価した理由（3つ程度）" 
              },
              mineReasons: { 
                type: "array", 
                items: { type: "string" },
                description: "地雷と評価した理由（3つ程度）" 
              },
              judgmentScores: {
                type: "object",
                properties: {
                  goodEvil: { type: "number", description: "善悪 (-100～100)" },
                  likesDislike: { type: "number", description: "好き嫌い (-100～100)" },
                  profitLoss: { type: "number", description: "損得 (-100～100)" },
                  interest: { type: "number", description: "利害 (-100～100)" },
                  pleasurePain: { type: "number", description: "苦楽 (-100～100)" },
                  difficulty: { type: "number", description: "難易 (-100～100)" },
                  possibility: { type: "number", description: "可否 (-100～100)" },
                  comfort: { type: "number", description: "快不快 (-100～100)" },
                  rightWrong: { type: "number", description: "正誤 (-100～100)" }
                },
                required: ["goodEvil", "likesDislike", "profitLoss", "interest", "pleasurePain", "difficulty", "possibility", "comfort", "rightWrong"],
                additionalProperties: false,
                description: "9つの判断基準に基づく評価"
              }
            },
            required: ["virtueScore", "mineScore", "virtueReasons", "mineReasons", "judgmentScores"],
            additionalProperties: false
          }
        }
      }
    });

    // エラーレスポンスをチェック
    if ('error' in response) {
      console.error("LLM API Error (waveform):", response.error);
      continue; // エラーがあっても他の評価者の評価を続行
    }

    const rawContent3 = response.choices?.[0]?.message?.content;
    const content = typeof rawContent3 === 'string' ? rawContent3 : JSON.stringify(rawContent3);
    if (content) {
      try {
        const result = JSON.parse(content);
        const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
        
        evaluations.push({
          evaluatorId: evaluator.id,
          evaluatorName: evaluator.name,
          virtueScore: clamp(result.virtueScore, 0, 100),
          mineScore: clamp(result.mineScore, 0, 100),
          virtueReasons: result.virtueReasons || [],
          mineReasons: result.mineReasons || [],
          judgmentScores: {
            goodEvil: clamp(result.judgmentScores?.goodEvil ?? 0, -100, 100),
            likesDislike: clamp(result.judgmentScores?.likesDislike ?? 0, -100, 100),
            profitLoss: clamp(result.judgmentScores?.profitLoss ?? 0, -100, 100),
            interest: clamp(result.judgmentScores?.interest ?? 0, -100, 100),
            pleasurePain: clamp(result.judgmentScores?.pleasurePain ?? 0, -100, 100),
            difficulty: clamp(result.judgmentScores?.difficulty ?? 0, -100, 100),
            possibility: clamp(result.judgmentScores?.possibility ?? 0, -100, 100),
            comfort: clamp(result.judgmentScores?.comfort ?? 0, -100, 100),
            rightWrong: clamp(result.judgmentScores?.rightWrong ?? 0, -100, 100)
          }
        });
      } catch (e) {
        console.error("Failed to parse evaluation result:", e);
      }
    }
  }

  // 総合スコアを計算
  const totalVirtueScore = evaluations.length > 0
    ? evaluations.reduce((sum, e) => sum + e.virtueScore, 0) / evaluations.length
    : 0;
  const totalMineScore = evaluations.length > 0
    ? evaluations.reduce((sum, e) => sum + e.mineScore, 0) / evaluations.length
    : 0;

  // 9つの判断基準の平均スコアを計算
  const averageJudgmentScores = evaluations.length > 0 ? {
    goodEvil: evaluations.reduce((sum, e) => sum + e.judgmentScores.goodEvil, 0) / evaluations.length,
    likesDislike: evaluations.reduce((sum, e) => sum + e.judgmentScores.likesDislike, 0) / evaluations.length,
    profitLoss: evaluations.reduce((sum, e) => sum + e.judgmentScores.profitLoss, 0) / evaluations.length,
    interest: evaluations.reduce((sum, e) => sum + e.judgmentScores.interest, 0) / evaluations.length,
    pleasurePain: evaluations.reduce((sum, e) => sum + e.judgmentScores.pleasurePain, 0) / evaluations.length,
    difficulty: evaluations.reduce((sum, e) => sum + e.judgmentScores.difficulty, 0) / evaluations.length,
    possibility: evaluations.reduce((sum, e) => sum + e.judgmentScores.possibility, 0) / evaluations.length,
    comfort: evaluations.reduce((sum, e) => sum + e.judgmentScores.comfort, 0) / evaluations.length,
    rightWrong: evaluations.reduce((sum, e) => sum + e.judgmentScores.rightWrong, 0) / evaluations.length
  } : undefined;

  // 徳波形と地雷波形を別々に生成
  const virtueWaveform: ValueWaveform = {
    evaluations,
    totalVirtueScore,
    totalMineScore,
    averageJudgmentScores,
    lastUpdated: new Date().toISOString()
  };

  const mineWaveform: ValueWaveform = {
    evaluations,
    totalVirtueScore,
    totalMineScore,
    averageJudgmentScores,
    lastUpdated: new Date().toISOString()
  };

  return {
    virtueWaveform,
    mineWaveform
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


/**
 * 自分の波形を生成する（自己評価ベース）
 * 性格診断結果（ビッグファイブ、MBTI、判断基準）から自分の徳波形・地雷波形を生成
 * 友達の評価に依存しない自己波形の作成
 */
export async function generateSelfWaveform(
  twin: {
    id: number;
    name: string;
    rawInput: string | null;
    personality: string | null;
    description: string | null;
    bigFiveTraits: BigFiveTraits | null;
    mbtiType: MBTIType | null;
    judgmentThresholds: JudgmentThresholds | null;
  }
): Promise<{ virtueWaveform: ValueWaveform; mineWaveform: ValueWaveform }> {
  // 性格情報を収集
  const bigFiveInfo = twin.bigFiveTraits ? `
【ビッグ・ファイブ性格特性】
- 開放性: ${twin.bigFiveTraits.openness}/100
- 誠実性: ${twin.bigFiveTraits.conscientiousness}/100
- 外向性: ${twin.bigFiveTraits.extraversion}/100
- 協調性: ${twin.bigFiveTraits.agreeableness}/100
- 神経症的傾向: ${twin.bigFiveTraits.neuroticism}/100` : "";

  const mbtiInfo = twin.mbtiType ? `
【MBTIタイプ】
- タイプ: ${twin.mbtiType.type}
- E/I (外向/内向): ${twin.mbtiType.dimensions.EI}
- S/N (感覚/直観): ${twin.mbtiType.dimensions.SN}
- T/F (思考/感情): ${twin.mbtiType.dimensions.TF}
- J/P (判断/知覚): ${twin.mbtiType.dimensions.JP}
- 説明: ${twin.mbtiType.description}
- 強み: ${twin.mbtiType.strengths?.join(', ') || 'なし'}
- 弱み: ${twin.mbtiType.weaknesses?.join(', ') || 'なし'}` : "";

  const judgmentInfo = twin.judgmentThresholds ? `
【9つの判断基準の閾値】
- 善悪: ${twin.judgmentThresholds.goodEvil}/100
- 好き嫌い: ${twin.judgmentThresholds.likesDislike}/100
- 損得: ${twin.judgmentThresholds.profitLoss}/100
- 利害: ${twin.judgmentThresholds.interest}/100
- 苦楽: ${twin.judgmentThresholds.pleasurePain}/100
- 難易: ${twin.judgmentThresholds.difficulty}/100
- 可否: ${twin.judgmentThresholds.possibility}/100
- 快不快: ${twin.judgmentThresholds.comfort}/100
- 正誤: ${twin.judgmentThresholds.rightWrong}/100` : "";

  const prompt = `あなたは人格分析の専門家です。以下の人物「${twin.name}」の性格情報から、この人物の「徳波形（G+）」と「地雷波形（G-）」を分析してください。

【${twin.name}の情報】
${twin.rawInput || "情報なし"}
${twin.personality ? `性格: ${twin.personality}` : ""}
${twin.description ? `説明: ${twin.description}` : ""}
${bigFiveInfo}
${mbtiInfo}
${judgmentInfo}

【徳波形（G+）とは】
この人物が他者から「徳がある」と評価されやすい特性・行動パターンです。
- 感謝できる点、称賛できる点、共感できる点、肯定的な行為
- 他者に好印象を与える傾向

【地雷波形（G-）とは】
この人物が他者から「地雷」と評価されやすい特性・行動パターンです。
- 受け入れられにくい点、問題と感じられる点、警戒されやすい点
- 他者に悪印象を与える可能性がある傾向

【9つの判断基準で自己評価】
各基準について-100～100で評価してください（マイナスはネガティブ傾向、プラスはポジティブ傾向）:
- 善悪: この人の行動は善い傾向か悪い傾向か
- 好き嫌い: この人は好かれやすいか嫌われやすいか
- 損得: この人と関わることは得になりやすいか損になりやすいか
- 利害: この人は利益をもたらしやすいか害をもたらしやすいか
- 苦楽: この人との関係は楽しくなりやすいか苦しくなりやすいか
- 難易: この人とのコミュニケーションは簡単か難しいか
- 可否: この人との協力は可能になりやすいか不可能になりやすいか
- 快不快: この人との交流は快適になりやすいか不快になりやすいか
- 正誤: この人の考え方は正しい傾向か間違っている傾向か

性格情報に基づいて、この人物の自己波形を分析してください。`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "あなたは人格分析の専門家です。性格情報から徳波形と地雷波形を分析します。" },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "self_waveform_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            virtueScore: { type: "number", description: "徳スコア G+(U) (0-100)" },
            mineScore: { type: "number", description: "地雷スコア G-(U) (0-100)" },
            virtueTraits: { 
              type: "array", 
              items: { type: "string" },
              description: "徳と評価されやすい特性（5つ程度）" 
            },
            mineTraits: { 
              type: "array", 
              items: { type: "string" },
              description: "地雷と評価されやすい特性（5つ程度）" 
            },
            judgmentScores: {
              type: "object",
              properties: {
                goodEvil: { type: "number", description: "善悪 (-100～100)" },
                likesDislike: { type: "number", description: "好き嫌い (-100～100)" },
                profitLoss: { type: "number", description: "損得 (-100～100)" },
                interest: { type: "number", description: "利害 (-100～100)" },
                pleasurePain: { type: "number", description: "苦楽 (-100～100)" },
                difficulty: { type: "number", description: "難易 (-100～100)" },
                possibility: { type: "number", description: "可否 (-100～100)" },
                comfort: { type: "number", description: "快不快 (-100～100)" },
                rightWrong: { type: "number", description: "正誤 (-100～100)" }
              },
              required: ["goodEvil", "likesDislike", "profitLoss", "interest", "pleasurePain", "difficulty", "possibility", "comfort", "rightWrong"],
              additionalProperties: false,
              description: "9つの判断基準に基づく自己評価"
            },
            analysis: { type: "string", description: "総合分析コメント" }
          },
          required: ["virtueScore", "mineScore", "virtueTraits", "mineTraits", "judgmentScores", "analysis"],
          additionalProperties: false
        }
      }
    }
  });

  // エラーレスポンスをチェック
  if ('error' in response) {
    console.error("LLM API Error (self waveform):", response.error);
    throw new Error(`自己波形の生成に失敗しました: ${(response.error as any)?.message || 'Unknown error'}`);
  }

  const rawContent = response.choices?.[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  if (!content) {
    throw new Error("自己波形の生成に失敗しました");
  }

  const result = JSON.parse(content);
  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

  // 自己評価を評価者として追加
  const selfEvaluation = {
    evaluatorId: twin.id,
    evaluatorName: `${twin.name}（自己分析）`,
    virtueScore: clamp(result.virtueScore, 0, 100),
    mineScore: clamp(result.mineScore, 0, 100),
    virtueReasons: result.virtueTraits || [],
    mineReasons: result.mineTraits || [],
    judgmentScores: {
      goodEvil: clamp(result.judgmentScores?.goodEvil ?? 0, -100, 100),
      likesDislike: clamp(result.judgmentScores?.likesDislike ?? 0, -100, 100),
      profitLoss: clamp(result.judgmentScores?.profitLoss ?? 0, -100, 100),
      interest: clamp(result.judgmentScores?.interest ?? 0, -100, 100),
      pleasurePain: clamp(result.judgmentScores?.pleasurePain ?? 0, -100, 100),
      difficulty: clamp(result.judgmentScores?.difficulty ?? 0, -100, 100),
      possibility: clamp(result.judgmentScores?.possibility ?? 0, -100, 100),
      comfort: clamp(result.judgmentScores?.comfort ?? 0, -100, 100),
      rightWrong: clamp(result.judgmentScores?.rightWrong ?? 0, -100, 100)
    }
  };

  const virtueWaveform: ValueWaveform = {
    evaluations: [selfEvaluation],
    totalVirtueScore: selfEvaluation.virtueScore,
    totalMineScore: selfEvaluation.mineScore,
    averageJudgmentScores: selfEvaluation.judgmentScores,
    lastUpdated: new Date().toISOString()
  };

  const mineWaveform: ValueWaveform = {
    evaluations: [selfEvaluation],
    totalVirtueScore: selfEvaluation.virtueScore,
    totalMineScore: selfEvaluation.mineScore,
    averageJudgmentScores: selfEvaluation.judgmentScores,
    lastUpdated: new Date().toISOString()
  };

  return {
    virtueWaveform,
    mineWaveform
  };
}

/**
 * 波形類似度を計算する
 * 2つの波形の類似度を0-100のスコアで返す
 */
export function calculateWaveformSimilarity(
  waveform1: ValueWaveform | null,
  waveform2: ValueWaveform | null
): number {
  if (!waveform1 || !waveform2) {
    return 0;
  }

  // 判断基準スコアがない場合は0を返す
  if (!waveform1.averageJudgmentScores || !waveform2.averageJudgmentScores) {
    return 0;
  }

  // 9つの判断基準のベクトルを作成
  const v1 = [
    waveform1.averageJudgmentScores.goodEvil,
    waveform1.averageJudgmentScores.likesDislike,
    waveform1.averageJudgmentScores.profitLoss,
    waveform1.averageJudgmentScores.interest,
    waveform1.averageJudgmentScores.pleasurePain,
    waveform1.averageJudgmentScores.difficulty,
    waveform1.averageJudgmentScores.possibility,
    waveform1.averageJudgmentScores.comfort,
    waveform1.averageJudgmentScores.rightWrong
  ];

  const v2 = [
    waveform2.averageJudgmentScores.goodEvil,
    waveform2.averageJudgmentScores.likesDislike,
    waveform2.averageJudgmentScores.profitLoss,
    waveform2.averageJudgmentScores.interest,
    waveform2.averageJudgmentScores.pleasurePain,
    waveform2.averageJudgmentScores.difficulty,
    waveform2.averageJudgmentScores.possibility,
    waveform2.averageJudgmentScores.comfort,
    waveform2.averageJudgmentScores.rightWrong
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
  // コサイン類似度は-1〜1なので、0〜100に変換
  return Math.round((cosineSimilarity + 1) * 50);
}

/**
 * 徳・地雷スコアの類似度を計算
 */
export function calculateVirtueMineCompatibility(
  waveform1: ValueWaveform | null,
  waveform2: ValueWaveform | null
): { virtueCompatibility: number; mineCompatibility: number; overallCompatibility: number } {
  if (!waveform1 || !waveform2) {
    return { virtueCompatibility: 0, mineCompatibility: 0, overallCompatibility: 0 };
  }

  // 徳スコアの類似度（差が小さいほど高い）
  const virtueDiff = Math.abs(waveform1.totalVirtueScore - waveform2.totalVirtueScore);
  const virtueCompatibility = Math.max(0, 100 - virtueDiff);

  // 地雷スコアの相補性（自分の地雷が相手の徳で補完されるか）
  // 地雷スコアが低いほど良い、相手の徳スコアが高いほど良い
  const mineCompatibility = Math.round(
    (100 - waveform1.totalMineScore + waveform2.totalVirtueScore) / 2
  );

  // 総合相性
  const overallCompatibility = Math.round(
    (virtueCompatibility + mineCompatibility + calculateWaveformSimilarity(waveform1, waveform2)) / 3
  );

  return {
    virtueCompatibility: Math.min(100, Math.max(0, virtueCompatibility)),
    mineCompatibility: Math.min(100, Math.max(0, mineCompatibility)),
    overallCompatibility: Math.min(100, Math.max(0, overallCompatibility))
  };
}

import { invokeLLM } from "../_core/llm";
import { invokeLLMWithProvider, type AIFeature } from "./aiProviderService";
import { getDb } from "../db";
import { valueScenarioResponses, valueEvaluations, cumulativeWaveforms, digitalTwins, friendships, users } from "../../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

// DBインスタンスを取得するヘルパー関数
async function db() {
  const instance = await getDb();
  if (!instance) {
    throw new Error("Database connection not available");
  }
  return instance;
}

// 価値観シナリオのカテゴリ
export const SCENARIO_CATEGORIES = {
  disaster: "災害・緊急事態",
  business: "ビジネス・仕事",
  relationship: "人間関係",
  ethics: "倫理・道徳",
  money: "お金・経済",
  lifestyle: "ライフスタイル",
  social: "社会問題",
} as const;

// 価値観シナリオのテンプレート
export const VALUE_SCENARIOS = [
  // 災害・緊急事態
  {
    id: "disaster_volunteer",
    category: "disaster",
    text: "大地震が発生し、被災地でボランティアを募集しています。あなたは仕事を休んでボランティアに参加しますか？その理由も教えてください。",
  },
  {
    id: "disaster_donation",
    category: "disaster",
    text: "災害義援金の募集があります。自分の生活に余裕がない状況でも寄付をしますか？どのくらいの金額なら寄付できると思いますか？",
  },
  {
    id: "disaster_help_stranger",
    category: "disaster",
    text: "電車内で急病人が出ました。周りの人は見て見ぬふりをしています。あなたはどうしますか？",
  },
  // ビジネス・仕事
  {
    id: "business_overtime",
    category: "business",
    text: "上司から「今日中に終わらせてほしい」と急な残業を頼まれました。今日は大切な予定があります。どう対応しますか？",
  },
  {
    id: "business_competitor",
    category: "business",
    text: "競合他社の機密情報を偶然入手しました。この情報を使えば大きな利益が得られます。どうしますか？",
  },
  {
    id: "business_whistleblower",
    category: "business",
    text: "会社の不正を発見しました。内部告発すれば自分の立場が危うくなる可能性があります。どうしますか？",
  },
  // 人間関係
  {
    id: "relationship_friend_lie",
    category: "relationship",
    text: "親友が浮気をしていることを知りました。その配偶者はあなたの知り合いでもあります。どうしますか？",
  },
  {
    id: "relationship_money_lend",
    category: "relationship",
    text: "友人から「お金を貸してほしい」と頼まれました。返済の見込みは不明です。どう対応しますか？",
  },
  {
    id: "relationship_criticism",
    category: "relationship",
    text: "友人があなたの悪口を言っていたことを知りました。その友人にどう接しますか？",
  },
  // 倫理・道徳
  {
    id: "ethics_found_money",
    category: "ethics",
    text: "道端で財布を拾いました。中には10万円と身分証明書が入っています。どうしますか？",
  },
  {
    id: "ethics_queue_cut",
    category: "ethics",
    text: "急いでいるとき、長い列に並んでいます。知り合いが前の方にいて「ここに入りなよ」と言ってきました。どうしますか？",
  },
  {
    id: "ethics_white_lie",
    category: "ethics",
    text: "友人が新しい髪型にしましたが、正直似合っていません。「どう？」と聞かれたらどう答えますか？",
  },
  // お金・経済
  {
    id: "money_investment_risk",
    category: "money",
    text: "友人から「絶対儲かる投資話がある」と誘われました。どう対応しますか？",
  },
  {
    id: "money_charity_vs_self",
    category: "money",
    text: "臨時収入が入りました。自分へのご褒美に使うか、寄付するか、貯金するか、どうしますか？",
  },
  // ライフスタイル
  {
    id: "lifestyle_environment",
    category: "lifestyle",
    text: "環境に優しいが高価な商品と、安価だが環境負荷の高い商品があります。どちらを選びますか？",
  },
  {
    id: "lifestyle_work_life",
    category: "lifestyle",
    text: "給料は高いが残業が多い仕事と、給料は低いがプライベートの時間が確保できる仕事、どちらを選びますか？",
  },
  // 社会問題
  {
    id: "social_discrimination",
    category: "social",
    text: "電車内で外国人に対する差別的な発言をしている人を見かけました。どうしますか？",
  },
  {
    id: "social_homeless",
    category: "social",
    text: "ホームレスの人に「お金をください」と言われました。どう対応しますか？",
  },
];

// 9つの判断基準のキー
export const JUDGMENT_CRITERIA = [
  "goodEvil",      // 善悪
  "likesDislike",  // 好き嫌い
  "profitLoss",    // 損得
  "interest",      // 利害
  "pleasurePain",  // 苦楽
  "difficulty",    // 難易
  "possibility",   // 可否
  "comfort",       // 快不快
  "rightWrong",    // 正誤
] as const;

// シナリオに対するユーザーの回答を分析する
export async function analyzeScenarioResponse(
  scenarioText: string,
  userResponse: string
): Promise<{
  judgmentScores: {
    goodEvil: number;
    likesDislike: number;
    profitLoss: number;
    interest: number;
    pleasurePain: number;
    difficulty: number;
    possibility: number;
    comfort: number;
    rightWrong: number;
  };
  virtueIndicators: string[];
  mineIndicators: string[];
  analysisNotes: string;
}> {
  const systemPrompt = `あなたは価値観分析の専門家です。ユーザーの回答を分析し、9つの判断基準に基づいてスコアを算出してください。

9つの判断基準:
1. 善悪 (goodEvil): 道徳的な正しさ (-100=悪い行為を容認 〜 +100=善い行為を重視)
2. 好き嫌い (likesDislike): 個人的な好み (-100=嫌いなことを避ける 〜 +100=好きなことを追求)
3. 損得 (profitLoss): 経済的・実利的な判断 (-100=損を受け入れる 〜 +100=得を重視)
4. 利害 (interest): 利益と害の関係 (-100=他者の利益を優先 〜 +100=自己の利益を優先)
5. 苦楽 (pleasurePain): 苦痛と快楽の判断 (-100=苦労をいとわない 〜 +100=楽さを重視)
6. 難易 (difficulty): 難しさと易しさの判断 (-100=難しいことに挑戦 〜 +100=簡単なことを好む)
7. 可否 (possibility): 可能性の判断 (-100=不可能に挑戦 〜 +100=確実なことのみ)
8. 快不快 (comfort): 感情的な快適さ (-100=不快を受け入れる 〜 +100=快適さを重視)
9. 正誤 (rightWrong): 正しいか間違っているか (-100=曖昧さを許容 〜 +100=正確さを重視)

また、回答から読み取れる「徳の指標」（ポジティブな価値観）と「地雷の指標」（ネガティブな価値観）も抽出してください。

必ず以下のJSON形式で回答してください:
{
  "judgmentScores": {
    "goodEvil": <-100〜100の整数>,
    "likesDislike": <-100〜100の整数>,
    "profitLoss": <-100〜100の整数>,
    "interest": <-100〜100の整数>,
    "pleasurePain": <-100〜100の整数>,
    "difficulty": <-100〜100の整数>,
    "possibility": <-100〜100の整数>,
    "comfort": <-100〜100の整数>,
    "rightWrong": <-100〜100の整数>
  },
  "virtueIndicators": ["徳の指標1", "徳の指標2", ...],
  "mineIndicators": ["地雷の指標1", "地雷の指標2", ...],
  "analysisNotes": "分析メモ"
}`;

  const userPrompt = `シナリオ:
${scenarioText}

ユーザーの回答:
${userResponse}

この回答を分析してください。`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "scenario_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              judgmentScores: {
                type: "object",
                properties: {
                  goodEvil: { type: "integer" },
                  likesDislike: { type: "integer" },
                  profitLoss: { type: "integer" },
                  interest: { type: "integer" },
                  pleasurePain: { type: "integer" },
                  difficulty: { type: "integer" },
                  possibility: { type: "integer" },
                  comfort: { type: "integer" },
                  rightWrong: { type: "integer" },
                },
                required: ["goodEvil", "likesDislike", "profitLoss", "interest", "pleasurePain", "difficulty", "possibility", "comfort", "rightWrong"],
                additionalProperties: false,
              },
              virtueIndicators: { type: "array", items: { type: "string" } },
              mineIndicators: { type: "array", items: { type: "string" } },
              analysisNotes: { type: "string" },
            },
            required: ["judgmentScores", "virtueIndicators", "mineIndicators", "analysisNotes"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error("No response from LLM");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Error analyzing scenario response:", error);
    // デフォルト値を返す
    return {
      judgmentScores: {
        goodEvil: 0,
        likesDislike: 0,
        profitLoss: 0,
        interest: 0,
        pleasurePain: 0,
        difficulty: 0,
        possibility: 0,
        comfort: 0,
        rightWrong: 0,
      },
      virtueIndicators: [],
      mineIndicators: [],
      analysisNotes: "分析に失敗しました",
    };
  }
}

// 他の分身AIによる評価を実行する
export async function evaluateByTwin(
  evaluatorTwinId: number,
  evaluatorTwinName: string,
  evaluatorTwinPersonality: string,
  targetUserResponse: string,
  scenarioText: string
): Promise<{
  verdict: "virtue" | "mine" | "neutral";
  judgmentScores: {
    goodEvil: number;
    likesDislike: number;
    profitLoss: number;
    interest: number;
    pleasurePain: number;
    difficulty: number;
    possibility: number;
    comfort: number;
    rightWrong: number;
  };
  reason: string;
  confidence: number;
}> {
  const systemPrompt = `あなたは「${evaluatorTwinName}」という名前の分身AIです。
あなたの性格・価値観:
${evaluatorTwinPersonality}

あなたの視点から、他のユーザーの回答を評価してください。
あなた自身の価値観に基づいて、この回答が「徳」（ポジティブ）か「地雷」（ネガティブ）か「問題なし」（中立）かを判断してください。

9つの判断基準に基づいてスコアも算出してください:
1. 善悪 (goodEvil): -100〜+100
2. 好き嫌い (likesDislike): -100〜+100
3. 損得 (profitLoss): -100〜+100
4. 利害 (interest): -100〜+100
5. 苦楽 (pleasurePain): -100〜+100
6. 難易 (difficulty): -100〜+100
7. 可否 (possibility): -100〜+100
8. 快不快 (comfort): -100〜+100
9. 正誤 (rightWrong): -100〜+100

必ず以下のJSON形式で回答してください:
{
  "verdict": "virtue" | "mine" | "neutral",
  "judgmentScores": {
    "goodEvil": <-100〜100の整数>,
    "likesDislike": <-100〜100の整数>,
    "profitLoss": <-100〜100の整数>,
    "interest": <-100〜100の整数>,
    "pleasurePain": <-100〜100の整数>,
    "difficulty": <-100〜100の整数>,
    "possibility": <-100〜100の整数>,
    "comfort": <-100〜100の整数>,
    "rightWrong": <-100〜100の整数>
  },
  "reason": "評価理由",
  "confidence": <0〜100の整数>
}`;

  const userPrompt = `シナリオ:
${scenarioText}

評価対象の回答:
${targetUserResponse}

あなたの価値観に基づいて、この回答を評価してください。`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "twin_evaluation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["virtue", "mine", "neutral"] },
              judgmentScores: {
                type: "object",
                properties: {
                  goodEvil: { type: "integer" },
                  likesDislike: { type: "integer" },
                  profitLoss: { type: "integer" },
                  interest: { type: "integer" },
                  pleasurePain: { type: "integer" },
                  difficulty: { type: "integer" },
                  possibility: { type: "integer" },
                  comfort: { type: "integer" },
                  rightWrong: { type: "integer" },
                },
                required: ["goodEvil", "likesDislike", "profitLoss", "interest", "pleasurePain", "difficulty", "possibility", "comfort", "rightWrong"],
                additionalProperties: false,
              },
              reason: { type: "string" },
              confidence: { type: "integer" },
            },
            required: ["verdict", "judgmentScores", "reason", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error("No response from LLM");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Error evaluating by twin:", error);
    return {
      verdict: "neutral",
      judgmentScores: {
        goodEvil: 0,
        likesDislike: 0,
        profitLoss: 0,
        interest: 0,
        pleasurePain: 0,
        difficulty: 0,
        possibility: 0,
        comfort: 0,
        rightWrong: 0,
      },
      reason: "評価に失敗しました",
      confidence: 0,
    };
  }
}

// 価値観シナリオインタビューを実行する
export async function conductValueScenarioInterview(
  userId: number,
  twinId: number,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  userMessage?: string
): Promise<{
  response: string;
  isComplete: boolean;
  currentScenarioIndex: number;
  totalScenarios: number;
  scenarioId?: string;
  scenarioCategory?: string;
  scenarioText?: string;
}> {
  // 完了したシナリオを取得
  const completedResponses = await (await db())
    .select({ scenarioId: valueScenarioResponses.scenarioId })
    .from(valueScenarioResponses)
    .where(and(
      eq(valueScenarioResponses.userId, userId),
      eq(valueScenarioResponses.twinId, twinId)
    ));

  const completedScenarioIds = new Set(completedResponses.map((r: { scenarioId: string }) => r.scenarioId));
  const remainingScenarios = VALUE_SCENARIOS.filter(s => !completedScenarioIds.has(s.id));

  // すべてのシナリオが完了した場合
  if (remainingScenarios.length === 0) {
    return {
      response: "すべての価値観シナリオへの回答が完了しました！あなたの価値観波形が生成されました。",
      isComplete: true,
      currentScenarioIndex: VALUE_SCENARIOS.length,
      totalScenarios: VALUE_SCENARIOS.length,
    };
  }

  const currentScenario = remainingScenarios[0];
  const currentIndex = VALUE_SCENARIOS.length - remainingScenarios.length + 1;

  // 初回または新しいシナリオの開始
  if (conversationHistory.length === 0 || !userMessage) {
    const categoryName = SCENARIO_CATEGORIES[currentScenario.category as keyof typeof SCENARIO_CATEGORIES];
    return {
      response: `【価値観シナリオ ${currentIndex}/${VALUE_SCENARIOS.length}】\nカテゴリ: ${categoryName}\n\n${currentScenario.text}`,
      isComplete: false,
      currentScenarioIndex: currentIndex,
      totalScenarios: VALUE_SCENARIOS.length,
      scenarioId: currentScenario.id,
      scenarioCategory: currentScenario.category,
      scenarioText: currentScenario.text,
    };
  }

  // ユーザーの回答を分析して保存
  if (userMessage) {
    const analysis = await analyzeScenarioResponse(currentScenario.text, userMessage);

    // 回答を保存
    await (await db()).insert(valueScenarioResponses).values({
      userId,
      twinId,
      scenarioId: currentScenario.id,
      scenarioCategory: currentScenario.category,
      scenarioText: currentScenario.text,
      userResponse: userMessage,
      analysisResult: analysis,
    });

    // 友達の分身AIによる評価を実行
    await evaluateByFriendTwins(userId, twinId, currentScenario.text, userMessage);

    // 次のシナリオがあるか確認
    const nextScenarios = remainingScenarios.slice(1);
    if (nextScenarios.length === 0) {
      // 累積波形を更新
      await updateCumulativeWaveform(userId, twinId);

      return {
        response: "ありがとうございます！すべての価値観シナリオへの回答が完了しました。あなたの価値観波形が生成されました。",
        isComplete: true,
        currentScenarioIndex: VALUE_SCENARIOS.length,
        totalScenarios: VALUE_SCENARIOS.length,
      };
    }

    // 次のシナリオを表示
    const nextScenario = nextScenarios[0];
    const nextIndex = currentIndex + 1;
    const categoryName = SCENARIO_CATEGORIES[nextScenario.category as keyof typeof SCENARIO_CATEGORIES];

    return {
      response: `回答を記録しました。\n\n【価値観シナリオ ${nextIndex}/${VALUE_SCENARIOS.length}】\nカテゴリ: ${categoryName}\n\n${nextScenario.text}`,
      isComplete: false,
      currentScenarioIndex: nextIndex,
      totalScenarios: VALUE_SCENARIOS.length,
      scenarioId: nextScenario.id,
      scenarioCategory: nextScenario.category,
      scenarioText: nextScenario.text,
    };
  }

  return {
    response: "エラーが発生しました。もう一度お試しください。",
    isComplete: false,
    currentScenarioIndex: currentIndex,
    totalScenarios: VALUE_SCENARIOS.length,
  };
}

// システム内の全分身AIからランダムに評価者を選択して評価を実行
// 自分の分身AIも評価者として使用可能（自己評価）
async function evaluateByFriendTwins(
  targetUserId: number,
  targetTwinId: number,
  scenarioText: string,
  userResponse: string
): Promise<void> {
  // システム内の全分身AIを取得（自分も含む）
  const allTwins = await (await db())
    .select({
      id: digitalTwins.id,
      userId: digitalTwins.userId,
      name: digitalTwins.name,
      personality: digitalTwins.personality,
    })
    .from(digitalTwins)
    .where(sql`${digitalTwins.personality} IS NOT NULL`);

  if (allTwins.length === 0) {
    return;
  }

  // ランダムに5人まで選択（全員が5人未満なら全員）
  const shuffled = allTwins.sort(() => Math.random() - 0.5);
  const friendTwins = shuffled.slice(0, Math.min(5, shuffled.length));

  // 各友達の分身AIによる評価を実行
  for (const twin of friendTwins) {
    if (!twin.personality) continue;

    const evaluation = await evaluateByTwin(
      twin.id,
      twin.name,
      twin.personality,
      userResponse,
      scenarioText
    );

    // 評価を保存
    await (await db()).insert(valueEvaluations).values({
      targetUserId,
      targetTwinId,
      evaluatorTwinId: twin.id,
      evaluatorUserId: twin.userId,
      verdict: evaluation.verdict,
      judgmentScores: evaluation.judgmentScores,
      reason: evaluation.reason,
      confidence: evaluation.confidence.toString(),
    });
  }
}

// 累積波形を更新（エクスポート）
export async function updateCumulativeWaveform(userId: number, twinId: number): Promise<void> {
  // すべての評価を取得
  const evaluations = await (await db())
    .select()
    .from(valueEvaluations)
    .where(and(
      eq(valueEvaluations.targetUserId, userId),
      eq(valueEvaluations.targetTwinId, twinId)
    ));

  if (evaluations.length === 0) {
    return;
  }

  // 累積スコアを計算
  let totalVirtueCount = 0;
  let totalMineCount = 0;
  let totalNeutralCount = 0;

  const cumulativeJudgmentScores = {
    goodEvil: { sum: 0, count: 0 },
    likesDislike: { sum: 0, count: 0 },
    profitLoss: { sum: 0, count: 0 },
    interest: { sum: 0, count: 0 },
    pleasurePain: { sum: 0, count: 0 },
    difficulty: { sum: 0, count: 0 },
    possibility: { sum: 0, count: 0 },
    comfort: { sum: 0, count: 0 },
    rightWrong: { sum: 0, count: 0 },
  };

  const evaluatorBreakdown: Record<string, {
    evaluatorName: string;
    virtueCount: number;
    mineCount: number;
    neutralCount: number;
    judgmentScores: typeof cumulativeJudgmentScores;
  }> = {};

  // 評価者の名前を取得
  const evaluatorTwinIds: number[] = Array.from(new Set(evaluations.map((e: { evaluatorTwinId: number }) => e.evaluatorTwinId)));
  const evaluatorTwins = await (await db())
    .select({ id: digitalTwins.id, name: digitalTwins.name })
    .from(digitalTwins)
    .where(inArray(digitalTwins.id, evaluatorTwinIds));
  
  const twinNameMap = new Map(evaluatorTwins.map((t: { id: number; name: string }) => [t.id, t.name]));

  for (const evaluation of evaluations) {
    // 全体の累積
    if (evaluation.verdict === "virtue") {
      totalVirtueCount++;
    } else if (evaluation.verdict === "mine") {
      totalMineCount++;
    } else {
      totalNeutralCount++;
    }

    // 判断スコアの累積
    if (evaluation.judgmentScores) {
      const scores = evaluation.judgmentScores as Record<string, number>;
      for (const key of JUDGMENT_CRITERIA) {
        if (scores[key] !== undefined) {
          cumulativeJudgmentScores[key].sum += scores[key];
          cumulativeJudgmentScores[key].count++;
        }
      }
    }

    // 評価者ごとの累積
    const evaluatorKey = evaluation.evaluatorTwinId.toString();
    if (!evaluatorBreakdown[evaluatorKey]) {
      evaluatorBreakdown[evaluatorKey] = {
        evaluatorName: (twinNameMap.get(evaluation.evaluatorTwinId) || "Unknown") as string,
        virtueCount: 0,
        mineCount: 0,
        neutralCount: 0,
        judgmentScores: {
          goodEvil: { sum: 0, count: 0 },
          likesDislike: { sum: 0, count: 0 },
          profitLoss: { sum: 0, count: 0 },
          interest: { sum: 0, count: 0 },
          pleasurePain: { sum: 0, count: 0 },
          difficulty: { sum: 0, count: 0 },
          possibility: { sum: 0, count: 0 },
          comfort: { sum: 0, count: 0 },
          rightWrong: { sum: 0, count: 0 },
        },
      };
    }

    if (evaluation.verdict === "virtue") {
      evaluatorBreakdown[evaluatorKey].virtueCount++;
    } else if (evaluation.verdict === "mine") {
      evaluatorBreakdown[evaluatorKey].mineCount++;
    } else {
      evaluatorBreakdown[evaluatorKey].neutralCount++;
    }

    if (evaluation.judgmentScores) {
      const scores = evaluation.judgmentScores as Record<string, number>;
      for (const key of JUDGMENT_CRITERIA) {
        if (scores[key] !== undefined) {
          evaluatorBreakdown[evaluatorKey].judgmentScores[key].sum += scores[key];
          evaluatorBreakdown[evaluatorKey].judgmentScores[key].count++;
        }
      }
    }
  }

  // 累積波形を保存または更新
  const existing = await (await db())
    .select()
    .from(cumulativeWaveforms)
    .where(and(
      eq(cumulativeWaveforms.userId, userId),
      eq(cumulativeWaveforms.twinId, twinId)
    ))
    .limit(1);

  if (existing.length > 0) {
    await (await db())
      .update(cumulativeWaveforms)
      .set({
        totalVirtueCount,
        totalMineCount,
        totalNeutralCount,
        cumulativeJudgmentScores,
        evaluatorBreakdown,
      })
      .where(eq(cumulativeWaveforms.id, existing[0].id));
  } else {
    await (await db()).insert(cumulativeWaveforms).values({
      userId,
      twinId,
      totalVirtueCount,
      totalMineCount,
      totalNeutralCount,
      cumulativeJudgmentScores,
      evaluatorBreakdown,
    });
  }
}

// 既存のシナリオ回答に対して評価を再実行する（ランダム5人）
export async function reevaluateExistingResponses(
  userId: number,
  twinId: number
): Promise<{
  evaluatedCount: number;
  totalResponses: number;
}> {
  // 既存の回答を取得
  const existingResponses = await (await db())
    .select()
    .from(valueScenarioResponses)
    .where(and(
      eq(valueScenarioResponses.userId, userId),
      eq(valueScenarioResponses.twinId, twinId)
    ));

  if (existingResponses.length === 0) {
    return { evaluatedCount: 0, totalResponses: 0 };
  }

  // 既存の評価を削除（再評価のため）
  await (await db())
    .delete(valueEvaluations)
    .where(and(
      eq(valueEvaluations.targetUserId, userId),
      eq(valueEvaluations.targetTwinId, twinId)
    ));

  // 各回答に対して評価を実行
  let evaluatedCount = 0;
  for (const response of existingResponses) {
    try {
      await evaluateByFriendTwinsExported(
        userId,
        twinId,
        response.scenarioText,
        response.userResponse
      );
      evaluatedCount++;
    } catch (error) {
      console.error(`Error evaluating response ${response.id}:`, error);
    }
  }

  // 累積波形を更新
  await updateCumulativeWaveform(userId, twinId);

  return {
    evaluatedCount,
    totalResponses: existingResponses.length,
  };
}

// 既存のシナリオ回答に対して全ての模倣AIが評価を実行する
export async function evaluateByAllTwins(
  userId: number,
  twinId: number
): Promise<{
  evaluatedCount: number;
  totalResponses: number;
  totalEvaluators: number;
  totalEvaluations: number;
}> {
  // 既存の回答を取得
  const existingResponses = await (await db())
    .select()
    .from(valueScenarioResponses)
    .where(and(
      eq(valueScenarioResponses.userId, userId),
      eq(valueScenarioResponses.twinId, twinId)
    ));

  if (existingResponses.length === 0) {
    return { evaluatedCount: 0, totalResponses: 0, totalEvaluators: 0, totalEvaluations: 0 };
  }

  // 既存の評価を削除（再評価のため）
  await (await db())
    .delete(valueEvaluations)
    .where(and(
      eq(valueEvaluations.targetUserId, userId),
      eq(valueEvaluations.targetTwinId, twinId)
    ));

  // システム内の全分身AIを取得（性格が設定されているもの）
  const allTwins = await (await db())
    .select({
      id: digitalTwins.id,
      userId: digitalTwins.userId,
      name: digitalTwins.name,
      personality: digitalTwins.personality,
    })
    .from(digitalTwins)
    .where(sql`${digitalTwins.personality} IS NOT NULL`);

  if (allTwins.length === 0) {
    return { evaluatedCount: 0, totalResponses: existingResponses.length, totalEvaluators: 0, totalEvaluations: 0 };
  }

  console.log(`[evaluateByAllTwins] Starting evaluation with ${allTwins.length} evaluators for ${existingResponses.length} responses`);

  // 各回答に対して全ての模倣AIが評価を実行
  let evaluatedCount = 0;
  let totalEvaluations = 0;

  for (const response of existingResponses) {
    console.log(`[evaluateByAllTwins] Evaluating response ${response.id}: ${response.scenarioId}`);
    
    for (const twin of allTwins) {
      if (!twin.personality) continue;

      try {
        console.log(`[evaluateByAllTwins] Evaluator: ${twin.name} (ID: ${twin.id})`);
        
        const evaluation = await evaluateByTwin(
          twin.id,
          twin.name,
          twin.personality,
          response.userResponse,
          response.scenarioText
        );

        // 評価を保存
        await (await db()).insert(valueEvaluations).values({
          targetUserId: userId,
          targetTwinId: twinId,
          evaluatorTwinId: twin.id,
          evaluatorUserId: twin.userId,
          verdict: evaluation.verdict,
          judgmentScores: evaluation.judgmentScores,
          reason: evaluation.reason,
          confidence: evaluation.confidence.toString(),
        });

        totalEvaluations++;
        console.log(`[evaluateByAllTwins] ${twin.name} evaluated as: ${evaluation.verdict}`);
      } catch (error) {
        console.error(`[evaluateByAllTwins] Error evaluating by ${twin.name}:`, error);
      }
    }
    evaluatedCount++;
  }

  // 累積波形を更新
  await updateCumulativeWaveform(userId, twinId);

  console.log(`[evaluateByAllTwins] Completed: ${evaluatedCount} responses, ${totalEvaluations} evaluations`);

  return {
    evaluatedCount,
    totalResponses: existingResponses.length,
    totalEvaluators: allTwins.length,
    totalEvaluations,
  };
}

// システム内の全分身AIからランダムに評価者を選択して評価を実行（エクスポート版）
export async function evaluateByFriendTwinsExported(
  targetUserId: number,
  targetTwinId: number,
  scenarioText: string,
  userResponse: string
): Promise<void> {
  // システム内の全分身AIを取得（自分も含む）
  const allTwins = await (await db())
    .select({
      id: digitalTwins.id,
      userId: digitalTwins.userId,
      name: digitalTwins.name,
      personality: digitalTwins.personality,
    })
    .from(digitalTwins)
    .where(sql`${digitalTwins.personality} IS NOT NULL`);

  if (allTwins.length === 0) {
    return;
  }

  // ランダムに5人まで選択（全員が5人未満なら全員）
  const shuffled = allTwins.sort(() => Math.random() - 0.5);
  const friendTwins = shuffled.slice(0, Math.min(5, shuffled.length));

  // 各友達の分身AIによる評価を実行
  for (const twin of friendTwins) {
    if (!twin.personality) continue;

    const evaluation = await evaluateByTwin(
      twin.id,
      twin.name,
      twin.personality,
      userResponse,
      scenarioText
    );

    // 評価を保存
    await (await db()).insert(valueEvaluations).values({
      targetUserId,
      targetTwinId,
      evaluatorTwinId: twin.id,
      evaluatorUserId: twin.userId,
      verdict: evaluation.verdict,
      judgmentScores: evaluation.judgmentScores,
      reason: evaluation.reason,
      confidence: evaluation.confidence.toString(),
    });
  }
}

// 累積波形を取得
export async function getCumulativeWaveform(userId: number, twinId: number) {
  const waveform = await (await db())
    .select()
    .from(cumulativeWaveforms)
    .where(and(
      eq(cumulativeWaveforms.userId, userId),
      eq(cumulativeWaveforms.twinId, twinId)
    ))
    .limit(1);

  return waveform[0] || null;
}

// シナリオ回答の進捗を取得
export async function getScenarioProgress(userId: number, twinId: number) {
  const completedResponses = await (await db())
    .select({ scenarioId: valueScenarioResponses.scenarioId })
    .from(valueScenarioResponses)
    .where(and(
      eq(valueScenarioResponses.userId, userId),
      eq(valueScenarioResponses.twinId, twinId)
    ));

  return {
    completed: completedResponses.length,
    total: VALUE_SCENARIOS.length,
    completedScenarioIds: completedResponses.map((r: { scenarioId: string }) => r.scenarioId),
  };
}


// チャットメッセージをランダムな模倣人格で評価する（通常の会話でも波形を累積）
export async function evaluateChatMessage(
  userId: number,
  twinId: number,
  userMessage: string,
  assistantResponse: string
): Promise<{
  evaluated: boolean;
  evaluatorName?: string;
  verdict?: string;
}> {
  // システム内の全分身AIを取得（自分以外）
  const allTwins = await (await db())
    .select({
      id: digitalTwins.id,
      name: digitalTwins.name,
      personality: digitalTwins.personality,
      bigFiveTraits: digitalTwins.bigFiveTraits,
    })
    .from(digitalTwins)
    .where(sql`${digitalTwins.id} != ${twinId} AND ${digitalTwins.status} = 'active'`)
    .limit(100);

  if (allTwins.length === 0) {
    return { evaluated: false };
  }

  // ランダムに1つの模倣人格を選択
  const randomTwin = allTwins[Math.floor(Math.random() * allTwins.length)];

  // メッセージの内容が価値観に関連するかどうかを判断
  const relevanceCheck = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたは会話の内容が価値観評価に適しているかを判断するアシスタントです。
以下のような内容は価値観評価に適しています：
- 意見や考えを述べている
- 判断や選択について話している
- 行動の理由を説明している
- 倫理的・道徳的な話題
- 人間関係や社会問題についての見解

以下のような内容は価値観評価に適していません：
- 単なる挨拶や雑談
- 事実の確認や質問
- 技術的な質問や回答
- 短すぎる返答（10文字未満）

JSON形式で回答してください: { "isRelevant": true/false, "reason": "理由" }`
      },
      {
        role: "user",
        content: `ユーザーのメッセージ: ${userMessage}`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "relevance_check",
        strict: true,
        schema: {
          type: "object",
          properties: {
            isRelevant: { type: "boolean" },
            reason: { type: "string" }
          },
          required: ["isRelevant", "reason"],
          additionalProperties: false
        }
      }
    }
  });

  const relevanceContent = relevanceCheck.choices[0]?.message?.content;
  if (!relevanceContent || typeof relevanceContent !== 'string') {
    return { evaluated: false };
  }

  const relevance = JSON.parse(relevanceContent);
  if (!relevance.isRelevant) {
    return { evaluated: false };
  }

  // 模倣人格による評価を実行
  const evaluation = await evaluateByTwin(
    randomTwin.id,
    randomTwin.name,
    randomTwin.personality || "",
    userMessage,
    `会話の文脈: ${assistantResponse}`
  );

  // 評価結果を保存
  // 評価者のユーザーIDを取得
  const evaluatorTwin = await (await db())
    .select({ userId: digitalTwins.userId })
    .from(digitalTwins)
    .where(eq(digitalTwins.id, randomTwin.id))
    .limit(1);
  
  const evaluatorUserId = evaluatorTwin[0]?.userId || 0;

  await (await db()).insert(valueEvaluations).values({
    targetUserId: userId,
    targetTwinId: twinId,
    evaluatorTwinId: randomTwin.id,
    evaluatorUserId,
    verdict: evaluation.verdict,
    judgmentScores: evaluation.judgmentScores,
    reason: evaluation.reason,
    confidence: String(evaluation.confidence),
  });

  // 累積波形を更新
  await updateCumulativeWaveform(userId, twinId);

  return {
    evaluated: true,
    evaluatorName: randomTwin.name,
    verdict: evaluation.verdict,
  };
}

// サンプルが少ない時に波形を補間する関数
export function interpolateWaveform(
  evaluatorBreakdown: Record<string, {
    evaluatorName: string;
    virtueCount: number;
    mineCount: number;
    neutralCount: number;
    judgmentScores: Record<string, { sum: number; count: number }>;
  }>,
  targetCount: number = 10
): Array<{
  id: string;
  data: {
    evaluatorName: string;
    virtueCount: number;
    mineCount: number;
    neutralCount: number;
    judgmentScores: Record<string, { sum: number; count: number }>;
  };
}> {
  const evaluators = Object.entries(evaluatorBreakdown).map(([id, data]) => ({ id, data }));
  
  if (evaluators.length === 0) {
    return [];
  }

  if (evaluators.length >= targetCount) {
    return evaluators;
  }

  // サンプルが少ない場合、既存のデータを補間して波形を滑らかにする
  const result: typeof evaluators = [];
  const step = evaluators.length / targetCount;

  for (let i = 0; i < targetCount; i++) {
    const index = Math.min(Math.floor(i * step), evaluators.length - 1);
    const nextIndex = Math.min(index + 1, evaluators.length - 1);
    const t = (i * step) - index;

    const current = evaluators[index];
    const next = evaluators[nextIndex];

    if (index === nextIndex || t === 0) {
      result.push(current);
    } else {
      // 線形補間
      const interpolated = {
        id: `interpolated_${i}`,
        data: {
          evaluatorName: `${current.data.evaluatorName}〜${next.data.evaluatorName}`,
          virtueCount: Math.round(current.data.virtueCount * (1 - t) + next.data.virtueCount * t),
          mineCount: Math.round(current.data.mineCount * (1 - t) + next.data.mineCount * t),
          neutralCount: Math.round(current.data.neutralCount * (1 - t) + next.data.neutralCount * t),
          judgmentScores: {} as Record<string, { sum: number; count: number }>,
        },
      };

      for (const key of JUDGMENT_CRITERIA) {
        const currentScore = current.data.judgmentScores[key] || { sum: 0, count: 0 };
        const nextScore = next.data.judgmentScores[key] || { sum: 0, count: 0 };
        interpolated.data.judgmentScores[key] = {
          sum: Math.round(currentScore.sum * (1 - t) + nextScore.sum * t),
          count: Math.round(currentScore.count * (1 - t) + nextScore.count * t),
        };
      }

      result.push(interpolated);
    }
  }

  return result;
}

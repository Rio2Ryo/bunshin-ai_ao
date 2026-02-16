import { invokeLLM } from "../_core/llm";
import { getAiApiConfigs, getOrchestrationRoles } from "../db";
import { enhanceDialogueWithSearch, createSearchEnhancedPrompt, type WebSearchResponse } from "./webSearch";
import type { AiApiConfig, OrchestrationRole, DigitalTwin, KnowledgeEntry } from "../../drizzle/schema";

type AIProvider = "openai" | "gemini" | "anthropic" | "grok" | "builtin";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OrchestrationContext {
  userId: number;
  twin?: DigitalTwin;
  knowledge?: KnowledgeEntry[];
  configs?: AiApiConfig[];
  roles?: OrchestrationRole[];
}

interface MatchingScoreBreakdown {
  skillMatch: { score: number; reason: string };
  valueAlignment: { score: number; reason: string };
  communicationStyle: { score: number; reason: string };
  businessGoalFit: { score: number; reason: string };
  complementaryStrengths: { score: number; reason: string };
}

/**
 * AI Orchestrator - Manusの役割として複数のAIを使い分け、オーケストレーションする
 * 
 * 設計思想:
 * - Manusは単独AIではなく、Claude、GPT、Geminiなど複数AIを使い分けるオーケストレーター
 * - 各AIに役割を割り当て、全体をプロジェクトマネジメントする
 * - Web検索で世の中の情報を取得し、対話に反映する
 */
export class AIOrchestrator {
  private context: OrchestrationContext;

  constructor(context: OrchestrationContext) {
    this.context = context;
  }

  /**
   * 役割に基づいて最適なAIプロバイダーを選択
   */
  private async selectProvider(taskType: string): Promise<{ provider: AIProvider; model?: string }> {
    const roles = this.context.roles || [];
    const configs = this.context.configs || [];

    // 役割設定から該当するものを探す
    const matchingRole = roles.find(r => 
      r.roleName.toLowerCase().includes(taskType.toLowerCase()) && r.isActive === 1
    );

    if (matchingRole) {
      // ユーザーが設定したAPIキーが有効か確認
      const hasValidConfig = configs.some(c => 
        c.provider === matchingRole.assignedProvider && c.isActive === 1
      );

      if (hasValidConfig || matchingRole.assignedProvider === "builtin") {
        return {
          provider: matchingRole.assignedProvider,
          model: matchingRole.assignedModel || undefined
        };
      }
    }

    // デフォルトはビルトインLLMを使用
    return { provider: "builtin" };
  }

  /**
   * 分身AIの詳細なシステムプロンプトを構築（性格・考え方を強く反映）
   */
  private buildDetailedTwinPrompt(twin: DigitalTwin | undefined, knowledge: KnowledgeEntry[]): string {
    if (!twin) return "";

    let prompt = `【あなたの人物像】
名前: ${twin.name}

`;

    if (twin.personality) {
      prompt += `【性格・価値観・考え方】
${twin.personality}

この性格と価値観に基づいて、すべての発言を行ってください。
例えば：
- 慎重な性格なら、リスクについて言及する
- 積極的な性格なら、チャンスを強調する
- 論理的な性格なら、データや根拠を重視する
- 感情的な性格なら、人間関係や感情面を重視する

`;
    }

    if (twin.systemPrompt) {
      prompt += `【基本的な行動指針】
${twin.systemPrompt}

`;
    }

    if (knowledge.length > 0) {
      prompt += `【あなたの専門知識・経験・実績】
`;
      knowledge.forEach((k, i) => {
        prompt += `\n${i + 1}. ${k.title || "情報"}`;
        if (k.summary) {
          prompt += `\n   概要: ${k.summary}`;
        }
        if (k.content) {
          // 内容の最初の500文字を含める
          const contentPreview = k.content.substring(0, 500);
          prompt += `\n   詳細: ${contentPreview}${k.content.length > 500 ? '...' : ''}`;
        }
      });
      prompt += "\n\n";
    }

    prompt += `【重要】
- 上記の性格・価値観・専門知識を必ず発言に反映してください
- あなたの経験や実績に基づいた具体的な提案をしてください
- 「私の経験では...」「以前のプロジェクトで...」のように、知識ベースの情報を活用してください
`;

    return prompt;
  }

  /**
   * 分身AIのシステムプロンプトを構築
   */
  private buildTwinSystemPrompt(): string {
    const twin = this.context.twin;
    const knowledge = this.context.knowledge || [];

    let prompt = `あなたは「${twin?.name || "分身AI"}」として振る舞います。\n\n`;

    if (twin?.personality) {
      prompt += `【性格・特徴】\n${twin.personality}\n\n`;
    }

    if (twin?.systemPrompt) {
      prompt += `【基本指示】\n${twin.systemPrompt}\n\n`;
    }

    if (knowledge.length > 0) {
      prompt += `【知識ベース】\n`;
      knowledge.forEach((k, i) => {
        if (k.summary) {
          prompt += `${i + 1}. ${k.title || "情報"}: ${k.summary}\n`;
        }
      });
      prompt += "\n";
    }

    prompt += `上記の情報に基づいて、この分身AIの持ち主として自然に会話してください。
持ち主の専門知識、経験、ビジネス情報を活用して回答してください。`;

    return prompt;
  }

  /**
   * ビルトインLLMを使用してメッセージを生成
   */
  private async invokeBuiltinLLM(messages: Message[]): Promise<string> {
    const response = await invokeLLM({ messages });
    const content = response.choices[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }
    return "";
  }

  /**
   * 外部AIプロバイダーを使用（ユーザーのAPIキー）
   */
  private async invokeExternalAI(
    provider: AIProvider,
    model: string | undefined,
    messages: Message[]
  ): Promise<string> {
    const configs = this.context.configs || [];
    const config = configs.find(c => c.provider === provider && c.isActive === 1);

    if (!config?.apiKey) {
      console.log(`[AIOrchestrator] No valid API key for ${provider}, falling back to builtin`);
      return this.invokeBuiltinLLM(messages);
    }

    try {
      if (provider === "anthropic") {
        return await this.invokeAnthropic(config.apiKey, model || "claude-3-5-sonnet-20241022", messages);
      } else if (provider === "openai") {
        return await this.invokeOpenAI(config.apiKey, model || "gpt-4o", messages);
      } else if (provider === "gemini") {
        return await this.invokeGemini(config.apiKey, model || "gemini-2.0-flash", messages);
      } else if (provider === "grok") {
        return await this.invokeGrok(config.apiKey, model || "grok-3", messages);
      }
    } catch (error) {
      console.error(`[AIOrchestrator] Error invoking ${provider}:`, error);
    }

    return this.invokeBuiltinLLM(messages);
  }

  /**
   * Anthropic Claude APIを呼び出す
   */
  private async invokeAnthropic(apiKey: string, model: string, messages: Message[]): Promise<string> {
    const systemMessage = messages.find(m => m.role === "system");
    const otherMessages = messages.filter(m => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemMessage?.content || "",
        messages: otherMessages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data: any = await response.json();
    return data.content?.[0]?.text || "";
  }

  /**
   * OpenAI GPT APIを呼び出す
   */
  private async invokeOpenAI(apiKey: string, model: string, messages: Message[]): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * Google Gemini APIを呼び出す
   */
  private async invokeGemini(apiKey: string, model: string, messages: Message[]): Promise<string> {
    const contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const systemInstruction = messages.find(m => m.role === "system")?.content;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          generationConfig: { maxOutputTokens: 4096 }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data: any = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  /**
   * xAI Grok APIを呼び出す
   */
  private async invokeGrok(apiKey: string, model: string, messages: Message[]): Promise<string> {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * 分身AIとしてチャット応答を生成
   */
  async chat(userMessage: string, conversationHistory: Message[] = []): Promise<string> {
    const { provider, model } = await this.selectProvider("chat");
    
    const systemPrompt = this.buildTwinSystemPrompt();
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: userMessage }
    ];

    if (provider === "builtin") {
      return this.invokeBuiltinLLM(messages);
    }

    return this.invokeExternalAI(provider, model, messages);
  }

  /**
   * ビジネスマッチング対話を生成（性格・考え方を強く反映 + Web検索で情報強化）
   */
  async generateMatchingDialogue(
    otherTwin: DigitalTwin,
    otherKnowledge: KnowledgeEntry[],
    theme: string,
    previousDialogues: { speaker: string; content: string }[],
    isFirstSpeaker: boolean,
    enableWebSearch: boolean = true
  ): Promise<{ content: string; searchResults?: WebSearchResponse[] }> {
    const { provider, model } = await this.selectProvider("matching");

    const myTwin = this.context.twin;
    const myKnowledge = this.context.knowledge || [];

    // 対話の進行度に応じて指示を変える
    const dialogueCount = previousDialogues.length;
    const isEarlyStage = dialogueCount < 4;
    const isMidStage = dialogueCount >= 4 && dialogueCount < 12;
    const isLateStage = dialogueCount >= 12 && dialogueCount < 20;
    const isFinalStage = dialogueCount >= 20;

    let stageInstruction = "";
    if (isEarlyStage) {
      stageInstruction = `
【現在のフェーズ: 導入・課題の明確化】
- 自分の強み、専門分野、実績を具体的に紹介してください
- 相手の強みを理解するための具体的な質問をしてください
- 「何を解決したいのか」を明確にしてください
- 具体的な数字（売上目標、予算、期限など）を出してください
- あなたの性格や価値観に基づいた視点で話してください`;
    } else if (isMidStage) {
      stageInstruction = `
【現在のフェーズ: 具体的なプロジェクト提案】
- これまでの議論を踏まえて、具体的な協業プロジェクトを提案してください
- 「何を作るのか」を具体的に言ってください（例：「AIチャットボットを作る」「ECサイトを構築する」）
- 「誰が何を担当するのか」を明確にしてください
- 「いくらかかるのか」を具体的な金額で議論してください
- 「いつまでに完成させるのか」を具体的な日付で議論してください
- あなたの過去の経験や実績を引用して提案してください`;
    } else if (isLateStage) {
      stageInstruction = `
【現在のフェーズ: 役割分担とスケジュール確定】
- 具体的な役割分担を決めてください（例：「私がバックエンド、あなたがマーケティング」）
- 具体的なスケジュールを決めてください（例：「1週目：要件定義、2週目：プロトタイプ」）
- 必要なリソース（人、金、ツール）を具体的にリストアップしてください
- 成功の定義（KPI）を具体的な数字で決めてください（例：「月間売上100万円」）
- あなたの価値観に基づいて、重視すべきポイントを述べてください`;
    } else {
      stageInstruction = `
【現在のフェーズ: 最終合意・アクションプラン確定】
- 「明日から何をするか」を具体的に決めてください
- 最初のミーティングの日時を提案してください（例：「来週火曜日14時にZoomで」）
- 最初のマイルストーン（最初の成果物）を決めてください
- 合意事項を確認し、「では、これで進めましょう」と結論を出してください
- 具体的な次のアクションをリストアップしてください`;
    }

    // 詳細な人物像を構築
    const myPersonaPrompt = this.buildDetailedTwinPrompt(myTwin, myKnowledge);
    const otherPersonaPrompt = this.buildDetailedTwinPrompt(otherTwin, otherKnowledge);

    let systemPrompt = `あなたは「${myTwin?.name || "分身AI"}」として、ビジネスマッチングの対話に参加しています。

${myPersonaPrompt}

【対話相手の情報】
${otherPersonaPrompt}

【対話テーマ】
${theme}
${stageInstruction}

【重要な指示】
1. あなたの性格・価値観・考え方を必ず発言に反映してください
2. あなたの専門知識や過去の経験を具体的に引用してください
3. 「私の経験では...」「以前のプロジェクトで...」のように具体的に話してください
4. ふんわりした議論は禁止です。必ず具体的な提案をしてください
5. 「できるかもしれない」「検討しましょう」「考えてみます」は禁止です
6. 代わりに「こうしましょう」「これをやります」「私が担当します」と言い切ってください
7. 必ず具体的な数字を含めてください（金額、期限、人数、目標値など）
8. 1回の発言は300-500文字程度にしてください`;

    const messages: Message[] = [{ role: "system", content: systemPrompt }];

    // 過去の対話を追加
    previousDialogues.forEach(d => {
      const role = d.speaker === myTwin?.name ? "assistant" : "user";
      messages.push({ role, content: d.content });
    });

    if (isFirstSpeaker && previousDialogues.length === 0) {
      messages.push({
        role: "user",
        content: `テーマ「${theme}」について、最初の発言をしてください。

以下を具体的に述べてください：
1. あなたの強み・専門分野（具体的な実績や数字を含めて）
2. このテーマで何を実現したいのか（具体的な目標）
3. 相手に期待すること（具体的な役割）
4. あなたの価値観や考え方に基づいた視点`
      });
    } else {
      messages.push({
        role: "user",
        content: "前の発言を受けて、対話を続けてください。必ず具体的な提案や数字を含め、あなたの性格や価値観を反映させてください。"
      });
    }

    // Web検索で情報を強化（中盤以降で実行）
    let searchResults: WebSearchResponse[] | undefined;
    if (enableWebSearch && dialogueCount >= 4 && dialogueCount % 4 === 0) {
      try {
        const searchData = await enhanceDialogueWithSearch(
          previousDialogues,
          theme,
          myTwin?.name || "分身AI",
          otherTwin.name
        );
        searchResults = searchData.searchResults;
        
        // 検索結果をシステムプロンプトに追加
        if (searchResults && searchResults.length > 0) {
          messages[0].content = createSearchEnhancedPrompt(messages[0].content, searchResults);
        }
      } catch (error) {
        console.log("[AIOrchestrator] Web search failed, continuing without search results", error);
      }
    }

    let content: string;
    if (provider === "builtin") {
      content = await this.invokeBuiltinLLM(messages);
    } else {
      content = await this.invokeExternalAI(provider, model, messages);
    }

    return { content, searchResults };
  }

  /**
   * マッチング分析を実行（詳細な内訳付き）
   */
  async analyzeMatching(
    twin1: DigitalTwin,
    twin2: DigitalTwin,
    dialogues: { speaker: string; content: string }[],
    theme: string,
    knowledge1: KnowledgeEntry[] = [],
    knowledge2: KnowledgeEntry[] = []
  ): Promise<{
    compatibilityScore: number;
    scoreBreakdown: MatchingScoreBreakdown;
    collaborationPotential: string;
    strengths: string[];
    challenges: string[];
    recommendations: string[];
    summary: string;
    detailedAnalysis: string;
    actionPlan: {
      roleDivision: string;
      timeline: string;
      requiredResources: string;
      kpis: string;
      immediateActions: string[];
    };
  }> {
    const { provider, model } = await this.selectProvider("analysis");

    const dialogueText = dialogues.map(d => `【${d.speaker}】\n${d.content}`).join("\n\n");

    // 詳細な人物像を構築
    const persona1 = this.buildDetailedTwinPrompt(twin1, knowledge1);
    const persona2 = this.buildDetailedTwinPrompt(twin2, knowledge2);

    const systemPrompt = `あなたはビジネスマッチングの専門アナリストです。
2つの分身AI間の対話を分析し、ビジネス協業の可能性を評価してください。

【重要】マッチングスコアは以下の5つの観点から算出し、各観点の点数と理由を明示してください：
1. スキルマッチ度（20点満点）: 両者のスキルが補完し合えるか
2. 価値観の一致度（20点満点）: ビジネスに対する考え方や優先順位が合うか
3. コミュニケーションスタイル（20点満点）: 対話のスタイルや進め方が合うか
4. ビジネス目標の適合度（20点満点）: 目指す方向性や目標が合致するか
5. 相互補完性（20点満点）: お互いの強みが弱みを補えるか

以下のJSON形式で回答してください:
{
  "compatibilityScore": 0-100の合計スコア,
  "scoreBreakdown": {
    "skillMatch": { "score": 0-20, "reason": "具体的な理由" },
    "valueAlignment": { "score": 0-20, "reason": "具体的な理由" },
    "communicationStyle": { "score": 0-20, "reason": "具体的な理由" },
    "businessGoalFit": { "score": 0-20, "reason": "具体的な理由" },
    "complementaryStrengths": { "score": 0-20, "reason": "具体的な理由" }
  },
  "collaborationPotential": "協業可能性の説明（300文字程度）",
  "strengths": ["強み1", "強み2", "強み3"],
  "challenges": ["課題1", "課題2"],
  "recommendations": ["提案1", "提案2", "提案3"],
  "summary": "総合評価（150文字程度）",
  "detailedAnalysis": "詳細分析（500文字程度）",
  "actionPlan": {
    "roleDivision": "具体的な役割分担",
    "timeline": "具体的なタイムライン",
    "requiredResources": "必要なリソース",
    "kpis": "成功指標（KPI）",
    "immediateActions": ["明日からできるアクション1", "アクション2", "アクション3"]
  }
}`;

    const userMessage = `【分身AI 1の詳細情報】
${persona1}

【分身AI 2の詳細情報】
${persona2}

【対話テーマ】
${theme}

【対話内容】
${dialogueText}

上記の対話を分析し、ビジネスマッチングの結果をJSON形式で出力してください。
特に、マッチングスコアの内訳（各観点の点数と理由）を必ず含めてください。`;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    let response: string;
    if (provider === "builtin") {
      response = await this.invokeBuiltinLLM(messages);
    } else {
      response = await this.invokeExternalAI(provider, model, messages);
    }

    // JSONをパース
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // スコアの整合性チェック
        if (parsed.scoreBreakdown) {
          const breakdown = parsed.scoreBreakdown;
          const calculatedTotal = 
            (breakdown.skillMatch?.score || 0) +
            (breakdown.valueAlignment?.score || 0) +
            (breakdown.communicationStyle?.score || 0) +
            (breakdown.businessGoalFit?.score || 0) +
            (breakdown.complementaryStrengths?.score || 0);
          // 合計スコアを再計算
          parsed.compatibilityScore = calculatedTotal;
        }
        return parsed;
      }
    } catch (e) {
      console.error("[AIOrchestrator] Failed to parse analysis response:", e);
    }

    // パース失敗時のデフォルト値
    return {
      compatibilityScore: 50,
      scoreBreakdown: {
        skillMatch: { score: 10, reason: "分析中にエラーが発生しました" },
        valueAlignment: { score: 10, reason: "分析中にエラーが発生しました" },
        communicationStyle: { score: 10, reason: "分析中にエラーが発生しました" },
        businessGoalFit: { score: 10, reason: "分析中にエラーが発生しました" },
        complementaryStrengths: { score: 10, reason: "分析中にエラーが発生しました" }
      },
      collaborationPotential: "分析中にエラーが発生しました",
      strengths: [],
      challenges: [],
      recommendations: [],
      summary: "分析結果を取得できませんでした",
      detailedAnalysis: response,
      actionPlan: {
        roleDivision: "",
        timeline: "",
        requiredResources: "",
        kpis: "",
        immediateActions: []
      }
    };
  }

  /**
   * ドキュメントを解析して知識ベースエントリを生成
   */
  async analyzeDocument(content: string, filename: string): Promise<{
    title: string;
    summary: string;
    keyPoints: string[];
  }> {
    const { provider, model } = await this.selectProvider("document");

    const systemPrompt = `あなたはドキュメント分析の専門家です。
与えられたドキュメントを分析し、分身AIの知識ベースに追加するための情報を抽出してください。

以下のJSON形式で回答してください:
{
  "title": "ドキュメントのタイトル（推測）",
  "summary": "内容の要約（200-300文字）",
  "keyPoints": ["重要ポイント1", "重要ポイント2", "重要ポイント3"]
}`;

    const userMessage = `ファイル名: ${filename}

内容:
${content.substring(0, 10000)}${content.length > 10000 ? "\n...(以下省略)" : ""}

このドキュメントを分析してください。`;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    let response: string;
    if (provider === "builtin") {
      response = await this.invokeBuiltinLLM(messages);
    } else {
      response = await this.invokeExternalAI(provider, model, messages);
    }

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[AIOrchestrator] Failed to parse document analysis:", e);
    }

    return {
      title: filename,
      summary: "ドキュメントの分析に失敗しました",
      keyPoints: []
    };
  }
}

/**
 * ユーザー用のオーケストレーターを作成
 */
export async function createOrchestratorForUser(
  userId: number,
  twin?: DigitalTwin,
  knowledge?: KnowledgeEntry[]
): Promise<AIOrchestrator> {
  const configs = await getAiApiConfigs(userId);
  const roles = await getOrchestrationRoles(userId);

  return new AIOrchestrator({
    userId,
    twin,
    knowledge,
    configs,
    roles
  });
}

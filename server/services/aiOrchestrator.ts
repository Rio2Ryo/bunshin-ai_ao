import { invokeLLM } from "../_core/llm";
import { getAiApiConfigs, getOrchestrationRoles } from "../db";
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

/**
 * AI Orchestrator - Manusの役割として複数のAIを使い分け、オーケストレーションする
 * 
 * 設計思想:
 * - Manusは単独AIではなく、Claude、GPT、Geminiなど複数AIを使い分けるオーケストレーター
 * - 各AIに役割を割り当て、全体をプロジェクトマネジメントする
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
   * 注: 現在はビルトインにフォールバック。将来的に外部API呼び出しを実装
   */
  private async invokeExternalAI(
    provider: AIProvider,
    model: string | undefined,
    messages: Message[]
  ): Promise<string> {
    // 現時点ではビルトインLLMにフォールバック
    // 将来的にはユーザーのAPIキーを使って外部APIを呼び出す
    console.log(`[AIOrchestrator] Using builtin LLM (fallback from ${provider})`);
    return this.invokeBuiltinLLM(messages);
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
   * ビジネスマッチング対話を生成
   */
  async generateMatchingDialogue(
    otherTwin: DigitalTwin,
    otherKnowledge: KnowledgeEntry[],
    theme: string,
    previousDialogues: { speaker: string; content: string }[],
    isFirstSpeaker: boolean
  ): Promise<string> {
    const { provider, model } = await this.selectProvider("matching");

    const myTwin = this.context.twin;
    const myKnowledge = this.context.knowledge || [];

    // 対話の進行度に応じて指示を変える
    const dialogueCount = previousDialogues.length;
    const isEarlyStage = dialogueCount < 4;  // 最初の2ターン（4発言）
    const isMidStage = dialogueCount >= 4 && dialogueCount < 12;  // 中盤（3-6ターン目）
    const isLateStage = dialogueCount >= 12 && dialogueCount < 20;  // 後半（7-10ターン目）
    const isFinalStage = dialogueCount >= 20;  // 終盤（11ターン目以降）

    let stageInstruction = "";
    if (isEarlyStage) {
      stageInstruction = `
【現在のフェーズ: 導入・課題の明確化】
- 自分の強み、専門分野、実績を具体的に紹介してください
- 相手の強みを理解するための具体的な質問をしてください
- 「何を解決したいのか」を明確にしてください
- 具体的な数字（売上目標、予算、期限など）を出してください`;
    } else if (isMidStage) {
      stageInstruction = `
【現在のフェーズ: 具体的なプロジェクト提案】
- これまでの議論を踏まえて、具体的な協業プロジェクトを提案してください
- 「何を作るのか」を具体的に言ってください（例：「AIチャットボットを作る」「ECサイトを構築する」）
- 「誰が何を担当するのか」を明確にしてください
- 「いくらかかるのか」を具体的な金額で議論してください
- 「いつまでに完成させるのか」を具体的な日付で議論してください`;
    } else if (isLateStage) {
      stageInstruction = `
【現在のフェーズ: 役割分担とスケジュール確定】
- 具体的な役割分担を決めてください（例：「私がバックエンド、あなたがマーケティング」）
- 具体的なスケジュールを決めてください（例：「1週目：要件定義、2週目：プロトタイプ」）
- 必要なリソース（人、金、ツール）を具体的にリストアップしてください
- 成功の定義（KPI）を具体的な数字で決めてください（例：「月間売上100万円」）`;
    } else {
      stageInstruction = `
【現在のフェーズ: 最終合意・アクションプラン確定】
- 「明日から何をするか」を具体的に決めてください
- 最初のミーティングの日時を提案してください（例：「来週火曜日14時にZoomで」）
- 最初のマイルストーン（最初の成果物）を決めてください
- 合意事項を確認し、「では、これで進めましょう」と結論を出してください
- 具体的な次のアクションをリストアップしてください（例：「1. 私が要件書を作成 2. あなたがデザイン案を作成」）`;
    }

    let systemPrompt = `あなたは「${myTwin?.name || "分身AI"}」として、ビジネスマッチングの対話に参加しています。

【あなたの情報】
${myTwin?.personality || ""}
${myKnowledge.map(k => k.summary).filter(Boolean).join("\n")}

【対話相手】
名前: ${otherTwin.name}
${otherTwin.personality || ""}

【対話テーマ】
${theme}
${stageInstruction}

【重要な指示】
- この対話の目的は「具体的に何をやるか」を決めることです
- ふんわりした議論は禁止です。必ず具体的な提案をしてください
- 「できるかもしれない」「検討しましょう」「考えてみます」は禁止です
- 代わりに「こうしましょう」「これをやります」「私が担当します」と言い切ってください
- 必ず具体的な数字を含めてください（金額、期限、人数、目標値など）
- 1回の発言は200-400文字程度にしてください`;

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
3. 相手に期待すること（具体的な役割）`
      });
    } else {
      messages.push({
        role: "user",
        content: "前の発言を受けて、対話を続けてください。必ず具体的な提案や数字を含めてください。"
      });
    }

    if (provider === "builtin") {
      return this.invokeBuiltinLLM(messages);
    }

    return this.invokeExternalAI(provider, model, messages);
  }

  /**
   * マッチング分析を実行
   */
  async analyzeMatching(
    twin1: DigitalTwin,
    twin2: DigitalTwin,
    dialogues: { speaker: string; content: string }[],
    theme: string
  ): Promise<{
    compatibilityScore: number;
    collaborationPotential: string;
    strengths: string[];
    challenges: string[];
    recommendations: string[];
    summary: string;
    detailedAnalysis: string;
  }> {
    const { provider, model } = await this.selectProvider("analysis");

    const dialogueText = dialogues.map(d => `【${d.speaker}】\n${d.content}`).join("\n\n");

    const systemPrompt = `あなたはビジネスマッチングの専門アナリストです。
2つの分身AI間の対話を分析し、ビジネス協業の可能性を評価してください。

以下のJSON形式で回答してください:
{
  "compatibilityScore": 0-100の数値,
  "collaborationPotential": "協業可能性の説明（200文字程度）",
  "strengths": ["強み1", "強み2", "強み3"],
  "challenges": ["課題1", "課題2"],
  "recommendations": ["提案1", "提案2", "提案3"],
  "summary": "総合評価（100文字程度）",
  "detailedAnalysis": "詳細分析（500文字程度）"
}`;

    const userMessage = `【分身AI 1】${twin1.name}
${twin1.personality || ""}

【分身AI 2】${twin2.name}
${twin2.personality || ""}

【対話テーマ】
${theme}

【対話内容】
${dialogueText}

上記の対話を分析し、ビジネスマッチングの結果をJSON形式で出力してください。`;

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
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[AIOrchestrator] Failed to parse analysis response:", e);
    }

    // パース失敗時のデフォルト値
    return {
      compatibilityScore: 50,
      collaborationPotential: "分析中にエラーが発生しました",
      strengths: [],
      challenges: [],
      recommendations: [],
      summary: "分析結果を取得できませんでした",
      detailedAnalysis: response
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

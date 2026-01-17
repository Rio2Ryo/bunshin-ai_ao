import { invokeLLM } from "../_core/llm";

interface TwinInfo {
  name: string;
  description: string | null;
  personality: string | null;
}

interface DialogueEntry {
  speaker: string;
  content: string;
}

interface MatchingResult {
  compatibilityScore: number;
  summary: string;
  collaborationPotential: string;
  strengths: string[];
  challenges: string[];
  recommendations: string[];
  roleDistribution: string;
  timeline: string;
  resources: string;
  kpis: string;
  nextSteps: string;
  detailedAnalysis: string;
}

interface PresentationInput {
  theme: string;
  twin1: TwinInfo;
  twin2: TwinInfo;
  dialogues: DialogueEntry[];
  result: MatchingResult | null;
}

interface SlideContent {
  markdown: string;
  slideCount: number;
}

export interface SlideData {
  slideNumber: number;
  title: string;
  content: string;
  keyPoints: string[];
}

export interface PresentationData {
  title: string;
  subtitle: string;
  slides: SlideData[];
  theme: string;
  twin1Name: string;
  twin2Name: string;
  compatibilityScore: number;
}

/**
 * マッチング結果からプレゼン資料用のコンテンツを生成する
 */
export async function generatePresentationContent(input: PresentationInput): Promise<SlideContent> {
  const { theme, twin1, twin2, dialogues, result } = input;

  // 対話のハイライトを抽出（最大5つ）
  const dialogueHighlights = dialogues.slice(0, 10).map(d => `${d.speaker}: ${d.content.substring(0, 200)}...`).join("\n");

  // LLMを使ってプレゼン資料のコンテンツを生成
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたはビジネスプレゼンテーションの専門家です。ビジネスマッチングの結果を、視覚的に魅力的なプレゼン資料に変換してください。

出力形式: Markdown形式で、各スライドを「---」で区切ってください。

スライド構成（8-10枚）:
1. タイトルスライド（テーマ、参加者名）
2. エグゼクティブサマリー（相性スコア、一言まとめ）
3. 参加者紹介（Twin1）
4. 参加者紹介（Twin2）
5. シナジー・強み（箇条書き）
6. 協業プロジェクト提案（具体的な内容）
7. 役割分担とタイムライン
8. 必要リソースとKPI
9. 課題とリスク対策
10. 次のステップ（明日からのアクション）

各スライドの書き方:
- タイトルは「# 」で始める
- サブタイトルは「## 」で始める
- 箇条書きは「- 」を使用
- 重要な数字や用語は **太字** にする
- 各スライドは簡潔に（箇条書き3-5項目程度）
- ビジネスライクで説得力のある表現を使用`,
      },
      {
        role: "user",
        content: `以下のビジネスマッチング結果からプレゼン資料を作成してください。

【テーマ】
${theme}

【参加者1: ${twin1.name}】
${twin1.description || ""}
${twin1.personality || ""}

【参加者2: ${twin2.name}】
${twin2.description || ""}
${twin2.personality || ""}

【対話のハイライト】
${dialogueHighlights}

【分析結果】
相性スコア: ${result?.compatibilityScore || "N/A"}%
サマリー: ${result?.summary || "N/A"}
協業可能性: ${result?.collaborationPotential || "N/A"}

強み・シナジー:
${result?.strengths?.map(s => `- ${s}`).join("\n") || "N/A"}

課題・リスク:
${result?.challenges?.map(c => `- ${c}`).join("\n") || "N/A"}

提案:
${result?.recommendations?.map(r => `- ${r}`).join("\n") || "N/A"}

役割分担: ${result?.roleDistribution || "N/A"}
タイムライン: ${result?.timeline || "N/A"}
必要リソース: ${result?.resources || "N/A"}
KPI: ${result?.kpis || "N/A"}
次のステップ: ${result?.nextSteps || "N/A"}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Failed to generate presentation content");
  }

  // スライド数をカウント
  const slideCount = (content.match(/---/g) || []).length + 1;

  return {
    markdown: content,
    slideCount: Math.min(slideCount, 12), // 最大12枚
  };
}

/**
 * Markdownコンテンツをスライドデータに変換する
 */
export function parseMarkdownToSlides(markdown: string): SlideData[] {
  const slideTexts = markdown.split(/\n---\n/).map(s => s.trim()).filter(s => s.length > 0);
  
  return slideTexts.map((text, index) => {
    const lines = text.split('\n');
    let title = '';
    const keyPoints: string[] = [];
    const contentLines: string[] = [];
    
    for (const line of lines) {
      if (line.startsWith('# ')) {
        title = line.replace(/^#\s+/, '').replace(/\*\*/g, '');
      } else if (line.startsWith('## ')) {
        contentLines.push(line.replace(/^##\s+/, ''));
      } else if (line.startsWith('- ')) {
        keyPoints.push(line.replace(/^-\s+/, '').replace(/\*\*/g, ''));
      } else if (line.trim()) {
        contentLines.push(line);
      }
    }
    
    return {
      slideNumber: index + 1,
      title: title || `スライド ${index + 1}`,
      content: contentLines.join('\n'),
      keyPoints,
    };
  });
}

/**
 * スライドコンテンツファイルを生成する（nano bananaスライド用）
 */
export function generateSlideContentFile(input: PresentationInput, slides: SlideData[]): string {
  const { theme, twin1, twin2, result } = input;
  
  let content = `# ${theme}\n\n`;
  content += `**参加者**: ${twin1.name} × ${twin2.name}\n`;
  content += `**相性スコア**: ${result?.compatibilityScore || 'N/A'}%\n\n`;
  content += `---\n\n`;
  
  for (const slide of slides) {
    content += `## スライド ${slide.slideNumber}: ${slide.title}\n\n`;
    
    if (slide.content) {
      content += `${slide.content}\n\n`;
    }
    
    if (slide.keyPoints.length > 0) {
      content += `**キーポイント:**\n`;
      for (const point of slide.keyPoints) {
        content += `- ${point}\n`;
      }
      content += '\n';
    }
    
    content += `---\n\n`;
  }
  
  return content;
}

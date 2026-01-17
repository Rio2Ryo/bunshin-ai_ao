/**
 * PDF Generator Service
 * マッチング結果をPDFレポートとして生成する
 */

interface MatchingReport {
  sessionId: number;
  theme: string;
  createdAt: Date;
  twin1: {
    name: string;
    description?: string | null;
  };
  twin2: {
    name: string;
    description?: string | null;
  };
  dialogues: Array<{
    speaker: string;
    content: string;
    createdAt: Date;
  }>;
  analysis?: {
    compatibilityScore?: number;
    strengths?: string[];
    opportunities?: string[];
    recommendations?: string[];
    summary?: string;
  } | null;
}

/**
 * マッチング結果をHTML形式のレポートに変換
 */
export function generateMatchingReportHtml(report: MatchingReport): string {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const analysis = report.analysis;
  const compatibilityScore = analysis?.compatibilityScore ?? 0;

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>マッチングレポート - ${report.theme}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
      line-height: 1.6;
      color: #1a1a2e;
      background: #ffffff;
      padding: 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 3px solid #00d9ff;
    }
    .header h1 {
      font-size: 28px;
      color: #1a1a2e;
      margin-bottom: 10px;
    }
    .header .subtitle {
      color: #666;
      font-size: 14px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #00d9ff;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e0e0e0;
    }
    .participants {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
    }
    .participant {
      flex: 1;
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #00d9ff;
    }
    .participant h3 {
      font-size: 16px;
      margin-bottom: 8px;
    }
    .participant p {
      font-size: 14px;
      color: #666;
    }
    .score-container {
      text-align: center;
      margin: 30px 0;
      padding: 30px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 12px;
      color: white;
    }
    .score {
      font-size: 64px;
      font-weight: bold;
      color: #00d9ff;
    }
    .score-label {
      font-size: 14px;
      opacity: 0.8;
    }
    .dialogue-container {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      max-height: 400px;
      overflow-y: auto;
    }
    .dialogue-item {
      margin-bottom: 15px;
      padding: 15px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .dialogue-speaker {
      font-weight: bold;
      color: #00d9ff;
      margin-bottom: 5px;
      font-size: 14px;
    }
    .dialogue-content {
      font-size: 14px;
      color: #333;
      white-space: pre-wrap;
    }
    .analysis-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .analysis-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
    }
    .analysis-card h4 {
      font-size: 14px;
      color: #00d9ff;
      margin-bottom: 10px;
    }
    .analysis-card ul {
      list-style: none;
      padding: 0;
    }
    .analysis-card li {
      font-size: 13px;
      padding: 5px 0;
      padding-left: 15px;
      position: relative;
    }
    .analysis-card li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #00d9ff;
    }
    .summary {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      padding: 25px;
      border-radius: 8px;
      margin-top: 20px;
    }
    .summary h4 {
      font-size: 16px;
      color: #1a1a2e;
      margin-bottom: 10px;
    }
    .summary p {
      font-size: 14px;
      color: #333;
      white-space: pre-wrap;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    @media print {
      body {
        padding: 20px;
      }
      .dialogue-container {
        max-height: none;
        overflow: visible;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>ビジネスマッチングレポート</h1>
    <p class="subtitle">生成日: ${formatDate(new Date())} | セッションID: ${report.sessionId}</p>
  </div>

  <div class="section">
    <h2 class="section-title">対話テーマ</h2>
    <p style="font-size: 18px; font-weight: 500;">${report.theme}</p>
    <p style="font-size: 14px; color: #666; margin-top: 5px;">開始日時: ${formatDate(report.createdAt)}</p>
  </div>

  <div class="section">
    <h2 class="section-title">参加者</h2>
    <div class="participants">
      <div class="participant">
        <h3>${report.twin1.name}</h3>
        <p>${report.twin1.description || '説明なし'}</p>
      </div>
      <div class="participant">
        <h3>${report.twin2.name}</h3>
        <p>${report.twin2.description || '説明なし'}</p>
      </div>
    </div>
  </div>

  ${analysis ? `
  <div class="section">
    <h2 class="section-title">マッチング分析結果</h2>
    <div class="score-container">
      <div class="score-label">相性スコア</div>
      <div class="score">${compatibilityScore}%</div>
    </div>
    
    <div class="analysis-grid">
      ${analysis.strengths && analysis.strengths.length > 0 ? `
      <div class="analysis-card">
        <h4>強み・共通点</h4>
        <ul>
          ${analysis.strengths.map(s => `<li>${s}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
      
      ${analysis.opportunities && analysis.opportunities.length > 0 ? `
      <div class="analysis-card">
        <h4>ビジネス機会</h4>
        <ul>
          ${analysis.opportunities.map(o => `<li>${o}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
      
      ${analysis.recommendations && analysis.recommendations.length > 0 ? `
      <div class="analysis-card" style="grid-column: span 2;">
        <h4>推奨アクション</h4>
        <ul>
          ${analysis.recommendations.map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    
    ${analysis.summary ? `
    <div class="summary">
      <h4>総合評価</h4>
      <p>${analysis.summary}</p>
    </div>
    ` : ''}
  </div>
  ` : ''}

  <div class="section">
    <h2 class="section-title">対話履歴</h2>
    <div class="dialogue-container">
      ${report.dialogues.map(d => `
        <div class="dialogue-item">
          <div class="dialogue-speaker">${d.speaker}</div>
          <div class="dialogue-content">${d.content}</div>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="footer">
    <p>分身AI ビジネスマッチングプラットフォーム</p>
    <p>このレポートは自動生成されました</p>
  </div>
</body>
</html>
`;
}

export type { MatchingReport };

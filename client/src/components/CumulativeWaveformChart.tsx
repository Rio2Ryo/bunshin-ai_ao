import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Users, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// 累積波形の型定義（特許図7準拠）
interface EvaluatorBreakdown {
  evaluatorName: string;
  virtueCount: number;
  mineCount: number;
  neutralCount: number;
  judgmentScores: {
    goodEvil: { sum: number; count: number };
    likesDislike: { sum: number; count: number };
    profitLoss: { sum: number; count: number };
    interest: { sum: number; count: number };
    pleasurePain: { sum: number; count: number };
    difficulty: { sum: number; count: number };
    possibility: { sum: number; count: number };
    comfort: { sum: number; count: number };
    rightWrong: { sum: number; count: number };
  };
}

interface CumulativeWaveform {
  totalVirtueCount: number;
  totalMineCount: number;
  totalNeutralCount: number;
  cumulativeJudgmentScores: {
    goodEvil: { sum: number; count: number };
    likesDislike: { sum: number; count: number };
    profitLoss: { sum: number; count: number };
    interest: { sum: number; count: number };
    pleasurePain: { sum: number; count: number };
    difficulty: { sum: number; count: number };
    possibility: { sum: number; count: number };
    comfort: { sum: number; count: number };
    rightWrong: { sum: number; count: number };
  };
  evaluatorBreakdown: Record<string, EvaluatorBreakdown>;
}

interface CumulativeWaveformChartProps {
  waveform?: CumulativeWaveform | null;
  onGenerate?: () => void;
  isGenerating?: boolean;
  scenarioProgress?: {
    completed: number;
    total: number;
  };
}

// 模倣人格を傾向の類似度でソートする関数
function sortEvaluatorsBySimilarity(
  evaluators: Array<{ id: string; data: EvaluatorBreakdown }>
): Array<{ id: string; data: EvaluatorBreakdown }> {
  if (evaluators.length <= 1) return evaluators;

  // 各評価者の「傾向ベクトル」を計算（徳-地雷の比率と判断スコアの平均）
  const getFeatureVector = (data: EvaluatorBreakdown): number[] => {
    const total = data.virtueCount + data.mineCount + data.neutralCount;
    const virtueRatio = total > 0 ? data.virtueCount / total : 0.5;
    const mineRatio = total > 0 ? data.mineCount / total : 0.5;
    
    const scores = data.judgmentScores;
    const avgScores = Object.values(scores).map(s => 
      s.count > 0 ? s.sum / s.count / 100 : 0
    );
    
    return [virtueRatio, mineRatio, ...avgScores];
  };

  // コサイン類似度を計算
  const cosineSimilarity = (a: number[], b: number[]): number => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  // 最近傍法でソート（似ている人格が連番になるように）
  const sorted: typeof evaluators = [];
  const remaining = [...evaluators];
  
  // 最初の要素を選択（最も徳が多い人から開始）
  remaining.sort((a, b) => b.data.virtueCount - a.data.virtueCount);
  sorted.push(remaining.shift()!);

  while (remaining.length > 0) {
    const lastVector = getFeatureVector(sorted[sorted.length - 1].data);
    
    // 最も類似している次の評価者を見つける
    let maxSimilarity = -Infinity;
    let maxIndex = 0;
    
    for (let i = 0; i < remaining.length; i++) {
      const similarity = cosineSimilarity(lastVector, getFeatureVector(remaining[i].data));
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        maxIndex = i;
      }
    }
    
    sorted.push(remaining.splice(maxIndex, 1)[0]);
  }

  return sorted;
}

// 上下対称の波形グラフコンポーネント（特許図7準拠）
// 上半分: 徳（+方向）、下半分: 地雷（-方向）
function CombinedWaveformGraph({
  evaluators
}: {
  evaluators: Array<{ id: string; data: EvaluatorBreakdown }>;
}) {
  const width = 600;
  const height = 400;
  const padding = { top: 40, right: 40, bottom: 60, left: 60 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  const centerY = padding.top + graphHeight / 2;

  // 各評価者の徳と地雷の値
  const values = useMemo(() => {
    return evaluators.map(e => ({
      virtue: e.data.virtueCount,
      mine: e.data.mineCount,
      name: e.data.evaluatorName
    }));
  }, [evaluators]);

  // 最大値を計算（上下対称にするため、徳と地雷の最大値のうち大きい方を使用）
  const maxValue = useMemo(() => {
    const maxVirtue = Math.max(...values.map(v => v.virtue), 1);
    const maxMine = Math.max(...values.map(v => v.mine), 1);
    return Math.max(maxVirtue, maxMine, 5);
  }, [values]);

  // 徳の波形ポイント（上方向）
  const virtuePoints = useMemo(() => {
    if (evaluators.length === 0) return "";
    const step = graphWidth / Math.max(evaluators.length - 1, 1);
    return values.map((v, i) => {
      const x = padding.left + i * step;
      const y = centerY - (v.virtue / maxValue) * (graphHeight / 2);
      return `${x},${y}`;
    }).join(" ");
  }, [evaluators, values, graphWidth, graphHeight, maxValue, centerY]);

  // 地雷の波形ポイント（下方向）
  const minePoints = useMemo(() => {
    if (evaluators.length === 0) return "";
    const step = graphWidth / Math.max(evaluators.length - 1, 1);
    return values.map((v, i) => {
      const x = padding.left + i * step;
      const y = centerY + (v.mine / maxValue) * (graphHeight / 2);
      return `${x},${y}`;
    }).join(" ");
  }, [evaluators, values, graphWidth, graphHeight, maxValue, centerY]);

  // 徳のエリア（塗りつぶし用）
  const virtueAreaPoints = useMemo(() => {
    if (evaluators.length === 0) return "";
    const step = graphWidth / Math.max(evaluators.length - 1, 1);
    const topPoints = values.map((v, i) => {
      const x = padding.left + i * step;
      const y = centerY - (v.virtue / maxValue) * (graphHeight / 2);
      return `${x},${y}`;
    }).join(" ");
    const firstX = padding.left;
    const lastX = padding.left + (evaluators.length - 1) * step;
    return `${firstX},${centerY} ${topPoints} ${lastX},${centerY}`;
  }, [evaluators, values, graphWidth, graphHeight, maxValue, centerY]);

  // 地雷のエリア（塗りつぶし用）
  const mineAreaPoints = useMemo(() => {
    if (evaluators.length === 0) return "";
    const step = graphWidth / Math.max(evaluators.length - 1, 1);
    const bottomPoints = values.map((v, i) => {
      const x = padding.left + i * step;
      const y = centerY + (v.mine / maxValue) * (graphHeight / 2);
      return `${x},${y}`;
    }).join(" ");
    const firstX = padding.left;
    const lastX = padding.left + (evaluators.length - 1) * step;
    return `${firstX},${centerY} ${bottomPoints} ${lastX},${centerY}`;
  }, [evaluators, values, graphWidth, graphHeight, maxValue, centerY]);

  if (evaluators.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-muted-foreground">
        評価データがありません
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
      {/* 背景グラデーション */}
      <defs>
        <linearGradient id="virtueGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="mineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      {/* 上半分の背景（徳エリア） */}
      <rect
        x={padding.left}
        y={padding.top}
        width={graphWidth}
        height={graphHeight / 2}
        fill="#22c55e"
        fillOpacity={0.05}
      />
      
      {/* 下半分の背景（地雷エリア） */}
      <rect
        x={padding.left}
        y={centerY}
        width={graphWidth}
        height={graphHeight / 2}
        fill="#ef4444"
        fillOpacity={0.05}
      />

      {/* グリッドライン（上半分：徳） */}
      {[0.25, 0.5, 0.75, 1].map((level) => {
        const y = centerY - level * (graphHeight / 2);
        const value = Math.round(maxValue * level);
        return (
          <g key={`virtue-${level}`}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeDasharray="4,4"
            />
            <text
              x={padding.left - 10}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="text-[10px] fill-green-600"
            >
              +{value}
            </text>
          </g>
        );
      })}

      {/* グリッドライン（下半分：地雷） */}
      {[0.25, 0.5, 0.75, 1].map((level) => {
        const y = centerY + level * (graphHeight / 2);
        const value = Math.round(maxValue * level);
        return (
          <g key={`mine-${level}`}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeDasharray="4,4"
            />
            <text
              x={padding.left - 10}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="text-[10px] fill-red-600"
            >
              -{value}
            </text>
          </g>
        );
      })}

      {/* 中心線（0ライン） */}
      <line
        x1={padding.left}
        y1={centerY}
        x2={width - padding.right}
        y2={centerY}
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={2}
      />
      <text
        x={padding.left - 10}
        y={centerY}
        textAnchor="end"
        dominantBaseline="middle"
        className="text-[11px] fill-muted-foreground font-medium"
      >
        0
      </text>

      {/* 徳の波形エリア */}
      <polygon
        points={virtueAreaPoints}
        fill="url(#virtueGradient)"
      />

      {/* 地雷の波形エリア */}
      <polygon
        points={mineAreaPoints}
        fill="url(#mineGradient)"
      />

      {/* 徳の波形ライン */}
      <polyline
        points={virtuePoints}
        fill="none"
        stroke="#22c55e"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 地雷の波形ライン */}
      <polyline
        points={minePoints}
        fill="none"
        stroke="#ef4444"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* データポイントと評価者名 */}
      {evaluators.map((evaluator, i) => {
        const step = graphWidth / Math.max(evaluators.length - 1, 1);
        const x = padding.left + i * step;
        const virtueY = centerY - (values[i].virtue / maxValue) * (graphHeight / 2);
        const mineY = centerY + (values[i].mine / maxValue) * (graphHeight / 2);
        
        return (
          <g key={i}>
            {/* 垂直の接続線 */}
            <line
              x1={x}
              y1={virtueY}
              x2={x}
              y2={mineY}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={1}
              strokeDasharray="2,2"
            />

            {/* 徳のデータポイント */}
            <circle
              cx={x}
              cy={virtueY}
              r={7}
              fill="#22c55e"
              stroke="white"
              strokeWidth={2}
              className="cursor-pointer"
            />
            {/* 徳の値ラベル */}
            <text
              x={x}
              y={virtueY - 14}
              textAnchor="middle"
              className="text-[10px] font-bold"
              fill="#22c55e"
            >
              +{values[i].virtue}
            </text>

            {/* 地雷のデータポイント */}
            <circle
              cx={x}
              cy={mineY}
              r={7}
              fill="#ef4444"
              stroke="white"
              strokeWidth={2}
              className="cursor-pointer"
            />
            {/* 地雷の値ラベル */}
            <text
              x={x}
              y={mineY + 18}
              textAnchor="middle"
              className="text-[10px] font-bold"
              fill="#ef4444"
            >
              -{values[i].mine}
            </text>

            {/* 評価者名（C1, C2, ... 形式） */}
            <text
              x={x}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="text-[11px] fill-muted-foreground font-medium"
            >
              C{i + 1}
            </text>
            {/* 評価者の実名（短縮） */}
            <text
              x={x}
              y={height - padding.bottom + 32}
              textAnchor="middle"
              className="text-[9px] fill-muted-foreground"
            >
              {evaluator.data.evaluatorName.slice(0, 6)}
            </text>
          </g>
        );
      })}

      {/* Y軸ラベル（左側） */}
      <text
        x={15}
        y={padding.top + graphHeight / 4}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(-90, 15, ${padding.top + graphHeight / 4})`}
        className="text-[12px] fill-green-600 font-medium"
      >
        徳 G+(U)
      </text>
      <text
        x={15}
        y={centerY + graphHeight / 4}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(-90, 15, ${centerY + graphHeight / 4})`}
        className="text-[12px] fill-red-600 font-medium"
      >
        地雷 G-(U)
      </text>

      {/* X軸ラベル */}
      <text
        x={width / 2}
        y={height - 8}
        textAnchor="middle"
        className="text-[12px] fill-muted-foreground font-medium"
      >
        模倣人格（類似度順）
      </text>

      {/* 凡例 */}
      <g transform={`translate(${width - padding.right - 100}, ${padding.top - 25})`}>
        <circle cx={0} cy={0} r={5} fill="#22c55e" />
        <text x={10} y={4} className="text-[10px] fill-muted-foreground">徳（上）</text>
        <circle cx={60} cy={0} r={5} fill="#ef4444" />
        <text x={70} y={4} className="text-[10px] fill-muted-foreground">地雷（下）</text>
      </g>
    </svg>
  );
}

// 評価者ごとの内訳表示
function EvaluatorBreakdownCard({
  evaluatorId,
  data,
  index
}: {
  evaluatorId: string;
  data: EvaluatorBreakdown;
  index: number;
}) {
  const total = data.virtueCount + data.mineCount + data.neutralCount;
  const virtuePercent = total > 0 ? (data.virtueCount / total * 100).toFixed(0) : 0;
  const minePercent = total > 0 ? (data.mineCount / total * 100).toFixed(0) : 0;

  // 判断スコアの平均を計算
  const avgScores = Object.entries(data.judgmentScores).map(([key, val]) => ({
    key,
    avg: val.count > 0 ? Math.round(val.sum / val.count) : 0
  }));

  const criteriaLabels: Record<string, string> = {
    goodEvil: "善悪",
    likesDislike: "好嫌",
    profitLoss: "損得",
    interest: "利害",
    pleasurePain: "苦楽",
    difficulty: "難易",
    possibility: "可否",
    comfort: "快不快",
    rightWrong: "正誤"
  };

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">C{index + 1}</Badge>
          <span className="font-medium text-sm">{data.evaluatorName}</span>
        </div>
        <span className="text-xs text-muted-foreground">{total}回評価</span>
      </div>
      
      {/* 徳/地雷/中立の内訳バー */}
      <div className="mb-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-muted">
          {data.virtueCount > 0 && (
            <div 
              className="bg-green-500 transition-all"
              style={{ width: `${virtuePercent}%` }}
            />
          )}
          {data.neutralCount > 0 && (
            <div 
              className="bg-gray-400 transition-all"
              style={{ width: `${100 - Number(virtuePercent) - Number(minePercent)}%` }}
            />
          )}
          {data.mineCount > 0 && (
            <div 
              className="bg-red-500 transition-all"
              style={{ width: `${minePercent}%` }}
            />
          )}
        </div>
        <div className="flex justify-between mt-1 text-xs">
          <span className="text-green-600">徳 {data.virtueCount}</span>
          <span className="text-gray-500">中立 {data.neutralCount}</span>
          <span className="text-red-600">地雷 {data.mineCount}</span>
        </div>
      </div>

      {/* 判断スコアの小さなバー */}
      <div className="grid grid-cols-3 gap-1 text-xs">
        {avgScores.slice(0, 6).map(({ key, avg }) => (
          <div key={key} className="flex items-center gap-1">
            <span className="text-muted-foreground w-8">{criteriaLabels[key]}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${avg >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                style={{ width: `${Math.abs(avg) / 2}%`, marginLeft: avg >= 0 ? '50%' : `${50 - Math.abs(avg) / 2}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CumulativeWaveformChart({
  waveform,
  onGenerate,
  isGenerating = false,
  scenarioProgress
}: CumulativeWaveformChartProps) {
  // 評価者データを類似度順にソート
  const sortedEvaluators = useMemo(() => {
    if (!waveform?.evaluatorBreakdown) return [];
    
    const evaluators = Object.entries(waveform.evaluatorBreakdown).map(([id, data]) => ({
      id,
      data
    }));
    
    return sortEvaluatorsBySimilarity(evaluators);
  }, [waveform]);

  if (!waveform || sortedEvaluators.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            価値観波形 G+(U) / G-(U)
          </CardTitle>
          <CardDescription>
            価値観シナリオへの回答を通じて、あなたの徳波形・地雷波形を生成します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>まだ波形が生成されていません</p>
            {scenarioProgress && (
              <p className="text-sm mt-2">
                進捗: {scenarioProgress.completed} / {scenarioProgress.total} シナリオ完了
              </p>
            )}
            <p className="text-sm mt-2">
              価値観シナリオインタビューに回答して波形を生成してください
            </p>
            {onGenerate && (
              <Button
                onClick={onGenerate}
                disabled={isGenerating}
                className="mt-4"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Activity className="mr-2 h-4 w-4" />
                    波形を更新
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            価値観波形 G+(U) / G-(U)
          </CardTitle>
          <CardDescription>
            {sortedEvaluators.length}人の模倣人格による評価（類似度順に並び替え済み）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 総合スコア */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">徳の合計</p>
                <p className="text-2xl font-bold text-green-600">
                  {waveform.totalVirtueCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-gray-500/10 rounded-lg">
              <Users className="h-8 w-8 text-gray-500" />
              <div>
                <p className="text-sm text-muted-foreground">中立</p>
                <p className="text-2xl font-bold text-gray-600">
                  {waveform.totalNeutralCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-red-500/10 rounded-lg">
              <TrendingDown className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">地雷の合計</p>
                <p className="text-2xl font-bold text-red-600">
                  {waveform.totalMineCount}
                </p>
              </div>
            </div>
          </div>

          {/* 上下対称の波形グラフ（特許図7準拠） */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              波形グラフ（上: 徳 / 下: 地雷）
            </h4>
            <div className="bg-muted/30 rounded-lg p-4">
              <CombinedWaveformGraph evaluators={sortedEvaluators} />
            </div>
          </div>

          {/* 各模倣人格の評価内訳 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              各模倣人格の評価内訳
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedEvaluators.map((evaluator, i) => (
                <EvaluatorBreakdownCard
                  key={evaluator.id}
                  evaluatorId={evaluator.id}
                  data={evaluator.data}
                  index={i}
                />
              ))}
            </div>
          </div>

          {/* 波形更新ボタン */}
          {onGenerate && (
            <div className="flex justify-center">
              <Button
                onClick={onGenerate}
                disabled={isGenerating}
                variant="outline"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    更新中...
                  </>
                ) : (
                  <>
                    <Activity className="mr-2 h-4 w-4" />
                    波形を更新
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

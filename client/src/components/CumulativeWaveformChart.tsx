import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Users, Target, Activity } from "lucide-react";
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

// 波形グラフコンポーネント（特許図7準拠）
function WaveformGraph({
  evaluators,
  type,
  color
}: {
  evaluators: Array<{ id: string; data: EvaluatorBreakdown }>;
  type: "virtue" | "mine";
  color: string;
}) {
  const width = 500;
  const height = 220;
  const padding = { top: 30, right: 30, bottom: 50, left: 50 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // 累積値を計算
  const cumulativeValues = useMemo(() => {
    let cumulative = 0;
    return evaluators.map(e => {
      const value = type === "virtue" ? e.data.virtueCount : e.data.mineCount;
      cumulative += value;
      return cumulative;
    });
  }, [evaluators, type]);

  const maxValue = Math.max(...cumulativeValues, 10);

  const points = useMemo(() => {
    if (evaluators.length === 0) return "";
    const step = graphWidth / Math.max(evaluators.length - 1, 1);
    return cumulativeValues.map((value, i) => {
      const x = padding.left + i * step;
      const y = padding.top + graphHeight - (value / maxValue) * graphHeight;
      return `${x},${y}`;
    }).join(" ");
  }, [evaluators, cumulativeValues, graphWidth, graphHeight, maxValue]);

  const areaPoints = useMemo(() => {
    if (evaluators.length === 0) return "";
    const step = graphWidth / Math.max(evaluators.length - 1, 1);
    const baseY = padding.top + graphHeight;
    const topPoints = cumulativeValues.map((value, i) => {
      const x = padding.left + i * step;
      const y = padding.top + graphHeight - (value / maxValue) * graphHeight;
      return `${x},${y}`;
    }).join(" ");
    const firstX = padding.left;
    const lastX = padding.left + (evaluators.length - 1) * step;
    return `${firstX},${baseY} ${topPoints} ${lastX},${baseY}`;
  }, [evaluators, cumulativeValues, graphWidth, graphHeight, maxValue]);

  if (evaluators.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-muted-foreground">
        評価データがありません
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
      {/* グリッドライン */}
      {[0, 0.25, 0.5, 0.75, 1].map((level) => {
        const y = padding.top + graphHeight - level * graphHeight;
        const value = Math.round(maxValue * level);
        return (
          <g key={level}>
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
              x={padding.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="text-[10px] fill-muted-foreground"
            >
              {value}
            </text>
          </g>
        );
      })}

      {/* 波形エリア */}
      <polygon
        points={areaPoints}
        fill={color}
        fillOpacity={0.2}
      />

      {/* 波形ライン */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* データポイントと評価者名 */}
      {evaluators.map((evaluator, i) => {
        const step = graphWidth / Math.max(evaluators.length - 1, 1);
        const x = padding.left + i * step;
        const y = padding.top + graphHeight - (cumulativeValues[i] / maxValue) * graphHeight;
        const individualValue = type === "virtue" ? evaluator.data.virtueCount : evaluator.data.mineCount;
        
        return (
          <g key={i}>
            {/* データポイント */}
            <circle
              cx={x}
              cy={y}
              r={6}
              fill={color}
              className="cursor-pointer"
            />
            {/* 個別値のラベル */}
            <text
              x={x}
              y={y - 12}
              textAnchor="middle"
              className="text-[9px] fill-current font-medium"
              fill={color}
            >
              +{individualValue}
            </text>
            {/* 評価者名（C1, C2, ... 形式） */}
            <text
              x={x}
              y={height - padding.bottom + 15}
              textAnchor="middle"
              className="text-[10px] fill-muted-foreground"
            >
              C{i + 1}
            </text>
            {/* 評価者の実名（短縮） */}
            <text
              x={x}
              y={height - padding.bottom + 28}
              textAnchor="middle"
              className="text-[8px] fill-muted-foreground"
            >
              {evaluator.data.evaluatorName.slice(0, 5)}
            </text>
          </g>
        );
      })}

      {/* Y軸ラベル */}
      <text
        x={15}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(-90, 15, ${height / 2})`}
        className="text-[11px] fill-muted-foreground font-medium"
      >
        {type === "virtue" ? "徳の累積 G+(U)" : "地雷の累積 G-(U)"}
      </text>

      {/* X軸ラベル */}
      <text
        x={width / 2}
        y={height - 5}
        textAnchor="middle"
        className="text-[11px] fill-muted-foreground"
      >
        模倣人格（類似度順）
      </text>
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
            {sortedEvaluators.length}人の模倣人格による累積評価（類似度順に並び替え済み）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 総合スコア */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">徳の累積</p>
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
                <p className="text-sm text-muted-foreground">地雷の累積</p>
                <p className="text-2xl font-bold text-red-600">
                  {waveform.totalMineCount}
                </p>
              </div>
            </div>
          </div>

          {/* 波形グラフ（特許図7準拠） */}
          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-medium mb-2 text-green-600 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                徳波形 G+(U)
              </h4>
              <div className="bg-muted/30 rounded-lg p-2">
                <WaveformGraph
                  evaluators={sortedEvaluators}
                  type="virtue"
                  color="#22c55e"
                />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2 text-red-600 flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                地雷波形 G-(U)
              </h4>
              <div className="bg-muted/30 rounded-lg p-2">
                <WaveformGraph
                  evaluators={sortedEvaluators}
                  type="mine"
                  color="#ef4444"
                />
              </div>
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

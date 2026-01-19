import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Users, Target } from "lucide-react";

// 特許ドキュメント準拠の波形型定義
interface ValueWaveformEvaluation {
  evaluatorId: number;
  evaluatorName: string;
  virtueScore: number;
  mineScore: number;
  virtueReasons: string[];
  mineReasons: string[];
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
}

interface ValueWaveform {
  evaluations: ValueWaveformEvaluation[];
  totalVirtueScore: number;
  totalMineScore: number;
  averageJudgmentScores?: {
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
  lastUpdated: string;
}

interface ValueWaveformChartProps {
  virtueWaveform?: ValueWaveform | null;
  mineWaveform?: ValueWaveform | null;
  showDetails?: boolean;
  onGenerate?: () => void;
  isGenerating?: boolean;
}

// 波形グラフコンポーネント（特許図7準拠）
function WaveformGraph({
  evaluations,
  type,
  color
}: {
  evaluations: ValueWaveformEvaluation[];
  type: "virtue" | "mine";
  color: string;
}) {
  const width = 400;
  const height = 200;
  const padding = 40;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  const scores = evaluations.map(e => type === "virtue" ? e.virtueScore : e.mineScore);
  const maxScore = Math.max(...scores, 100);

  const points = useMemo(() => {
    if (evaluations.length === 0) return "";
    const step = graphWidth / Math.max(evaluations.length - 1, 1);
    return evaluations.map((_, i) => {
      const x = padding + i * step;
      const score = type === "virtue" ? evaluations[i].virtueScore : evaluations[i].mineScore;
      const y = padding + graphHeight - (score / maxScore) * graphHeight;
      return `${x},${y}`;
    }).join(" ");
  }, [evaluations, type, graphWidth, graphHeight, maxScore, padding]);

  const areaPoints = useMemo(() => {
    if (evaluations.length === 0) return "";
    const step = graphWidth / Math.max(evaluations.length - 1, 1);
    const baseY = padding + graphHeight;
    const topPoints = evaluations.map((_, i) => {
      const x = padding + i * step;
      const score = type === "virtue" ? evaluations[i].virtueScore : evaluations[i].mineScore;
      const y = padding + graphHeight - (score / maxScore) * graphHeight;
      return `${x},${y}`;
    }).join(" ");
    const firstX = padding;
    const lastX = padding + (evaluations.length - 1) * step;
    return `${firstX},${baseY} ${topPoints} ${lastX},${baseY}`;
  }, [evaluations, type, graphWidth, graphHeight, maxScore, padding]);

  if (evaluations.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        評価データがありません
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="w-full max-w-[400px]">
      {/* グリッドライン */}
      {[0, 25, 50, 75, 100].map((level) => {
        const y = padding + graphHeight - (level / maxScore) * graphHeight;
        return (
          <g key={level}>
            <line
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeDasharray="4,4"
            />
            <text
              x={padding - 5}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="text-[10px] fill-muted-foreground"
            >
              {level}
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
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* データポイント */}
      {evaluations.map((evaluation, i) => {
        const step = graphWidth / Math.max(evaluations.length - 1, 1);
        const x = padding + i * step;
        const score = type === "virtue" ? evaluation.virtueScore : evaluation.mineScore;
        const y = padding + graphHeight - (score / maxScore) * graphHeight;
        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={5}
              fill={color}
              className="cursor-pointer"
            />
            <text
              x={x}
              y={height - 10}
              textAnchor="middle"
              className="text-[9px] fill-muted-foreground"
            >
              {evaluation.evaluatorName.slice(0, 4)}
            </text>
          </g>
        );
      })}

      {/* Y軸ラベル */}
      <text
        x={10}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(-90, 10, ${height / 2})`}
        className="text-[10px] fill-muted-foreground"
      >
        {type === "virtue" ? "徳スコア" : "地雷スコア"}
      </text>

      {/* X軸ラベル */}
      <text
        x={width / 2}
        y={height - 2}
        textAnchor="middle"
        className="text-[10px] fill-muted-foreground"
      >
        評価者（模倣人格 C1〜Cn-1）
      </text>
    </svg>
  );
}

// 9つの判断基準の棒グラフ
function JudgmentScoresBar({
  scores,
  evaluatorName
}: {
  scores: ValueWaveformEvaluation["judgmentScores"];
  evaluatorName: string;
}) {
  const criteria = [
    { key: "goodEvil", label: "善悪", value: scores.goodEvil },
    { key: "likesDislike", label: "好嫌", value: scores.likesDislike },
    { key: "profitLoss", label: "損得", value: scores.profitLoss },
    { key: "interest", label: "利害", value: scores.interest },
    { key: "pleasurePain", label: "苦楽", value: scores.pleasurePain },
    { key: "difficulty", label: "難易", value: scores.difficulty },
    { key: "possibility", label: "可否", value: scores.possibility },
    { key: "comfort", label: "快不快", value: scores.comfort },
    { key: "rightWrong", label: "正誤", value: scores.rightWrong },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{evaluatorName}の評価</p>
      {criteria.map(({ key, label, value }) => {
        const isPositive = value >= 0;
        const width = Math.abs(value);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs w-12 text-right">{label}</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden relative">
              <div className="absolute inset-0 flex">
                <div className="w-1/2" />
                <div className="w-px bg-border" />
                <div className="w-1/2" />
              </div>
              <div
                className={`absolute h-full transition-all ${
                  isPositive ? "bg-green-500 left-1/2" : "bg-red-500 right-1/2"
                }`}
                style={{ width: `${width / 2}%` }}
              />
            </div>
            <span className={`text-xs w-10 ${isPositive ? "text-green-600" : "text-red-600"}`}>
              {value > 0 ? "+" : ""}{value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 平均判断基準のレーダーチャート
function AverageJudgmentRadar({
  scores
}: {
  scores: ValueWaveform["averageJudgmentScores"];
}) {
  if (!scores) return null;

  const size = 200;
  const center = size / 2;
  const radius = size * 0.35;
  
  const criteria = [
    { key: "goodEvil", label: "善悪", value: scores.goodEvil },
    { key: "likesDislike", label: "好嫌", value: scores.likesDislike },
    { key: "profitLoss", label: "損得", value: scores.profitLoss },
    { key: "interest", label: "利害", value: scores.interest },
    { key: "pleasurePain", label: "苦楽", value: scores.pleasurePain },
    { key: "difficulty", label: "難易", value: scores.difficulty },
    { key: "possibility", label: "可否", value: scores.possibility },
    { key: "comfort", label: "快不快", value: scores.comfort },
    { key: "rightWrong", label: "正誤", value: scores.rightWrong },
  ];

  const angleStep = (2 * Math.PI) / criteria.length;

  // -100〜100を0〜100に正規化
  const normalizedData = criteria.map(c => (c.value + 100) / 2);

  const points = normalizedData.map((value, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (value / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle)
    };
  });

  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <div className="flex flex-col items-center">
      <h4 className="text-sm font-medium mb-2">9つの判断基準（平均）</h4>
      <svg width={size} height={size} className="overflow-visible">
        {/* グリッドライン */}
        {gridLevels.map((level, levelIdx) => {
          const gridPoints = criteria.map((_, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const r = level * radius;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(" ");
          return (
            <polygon
              key={levelIdx}
              points={gridPoints}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          );
        })}

        {/* 中心線（0点） */}
        {criteria.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const r = 0.5 * radius; // 50%が0点
          return (
            <circle
              key={`center-${i}`}
              cx={center + r * Math.cos(angle)}
              cy={center + r * Math.sin(angle)}
              r={2}
              fill="currentColor"
              fillOpacity={0.3}
            />
          );
        })}

        {/* 軸線 */}
        {criteria.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x2 = center + radius * Math.cos(angle);
          const y2 = center + radius * Math.sin(angle);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={1}
            />
          );
        })}

        {/* データエリア */}
        <polygon
          points={points.map(p => `${p.x},${p.y}`).join(" ")}
          fill="#8b5cf6"
          fillOpacity={0.3}
          stroke="#8b5cf6"
          strokeWidth={2}
        />

        {/* データポイント */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            fill={normalizedData[i] >= 50 ? "#22c55e" : "#ef4444"}
          />
        ))}

        {/* ラベル */}
        {criteria.map((c, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const labelRadius = radius + 25;
          const x = center + labelRadius * Math.cos(angle);
          const y = center + labelRadius * Math.sin(angle);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-[10px] fill-current"
            >
              {c.label}
            </text>
          );
        })}
      </svg>
      <p className="text-xs text-muted-foreground mt-2">
        中心が-100、外側が+100（中間の点が0）
      </p>
    </div>
  );
}

export function ValueWaveformChart({
  virtueWaveform,
  mineWaveform,
  showDetails = true,
  onGenerate,
  isGenerating = false
}: ValueWaveformChartProps) {
  const waveform = virtueWaveform || mineWaveform;
  
  if (!waveform || waveform.evaluations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            価値観波形 G+(U) / G-(U)
          </CardTitle>
          <CardDescription>
            友達の分身AIからの評価に基づく波形を生成します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>まだ評価データがありません</p>
            <p className="text-sm mt-2">
              友達を追加して「波形を生成」ボタンをクリックしてください
            </p>
            {onGenerate && (
              <button
                onClick={onGenerate}
                disabled={isGenerating}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    生成中...
                  </>
                ) : (
                  <>
                    <TrendingUp className="h-4 w-4" />
                    波形を生成
                  </>
                )}
              </button>
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
            <Target className="h-5 w-5" />
            価値観波形 G+(U) / G-(U)
          </CardTitle>
          <CardDescription>
            特許ドキュメント準拠：複数の模倣人格（C1〜Cn-1）による多角的評価
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 総合スコア */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">徳スコア G+(U)</p>
                <p className="text-2xl font-bold text-green-600">
                  {waveform.totalVirtueScore.toFixed(1)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-red-500/10 rounded-lg">
              <TrendingDown className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">地雷スコア G-(U)</p>
                <p className="text-2xl font-bold text-red-600">
                  {waveform.totalMineScore.toFixed(1)}
                </p>
              </div>
            </div>
          </div>

          {/* 波形グラフ（特許図7準拠） */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium mb-2 text-green-600">徳波形 G+(U)</h4>
              <WaveformGraph
                evaluations={waveform.evaluations}
                type="virtue"
                color="#22c55e"
              />
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2 text-red-600">地雷波形 G-(U)</h4>
              <WaveformGraph
                evaluations={waveform.evaluations}
                type="mine"
                color="#ef4444"
              />
            </div>
          </div>

          {/* 9つの判断基準の平均 */}
          {waveform.averageJudgmentScores && (
            <div className="flex justify-center">
              <AverageJudgmentRadar scores={waveform.averageJudgmentScores} />
            </div>
          )}

          {/* 詳細評価 */}
          {showDetails && waveform.evaluations.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium">各評価者の詳細</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {waveform.evaluations.map((evaluation, i) => (
                  <Card key={i} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium">{evaluation.evaluatorName}</span>
                      <div className="flex gap-2">
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className="bg-green-500/10 text-green-600">
                              G+ {evaluation.virtueScore}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1">
                              <p className="font-medium">徳の理由:</p>
                              {evaluation.virtueReasons.map((r, j) => (
                                <p key={j} className="text-sm">• {r}</p>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className="bg-red-500/10 text-red-600">
                              G- {evaluation.mineScore}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1">
                              <p className="font-medium">地雷の理由:</p>
                              {evaluation.mineReasons.map((r, j) => (
                                <p key={j} className="text-sm">• {r}</p>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <JudgmentScoresBar
                      scores={evaluation.judgmentScores}
                      evaluatorName={evaluation.evaluatorName}
                    />
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* 最終更新日時 */}
          <p className="text-xs text-muted-foreground text-right">
            最終更新: {new Date(waveform.lastUpdated).toLocaleString("ja-JP")}
          </p>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

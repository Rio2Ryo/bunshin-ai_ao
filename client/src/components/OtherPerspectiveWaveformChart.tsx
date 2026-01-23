import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Users, Eye, AlertTriangle, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

// 他者視点波形の型定義
interface PredictorBreakdown {
  predictorName: string;
  intimacyScore: number;
  intimacyLevel: string;
  weight: number;
  virtueCount: number;
  mineCount: number;
  neutralCount: number;
  predictionAccuracy: number;
}

interface OtherPerspectiveWaveform {
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
  predictorBreakdown: Record<string, PredictorBreakdown>;
  selfReportGap?: number;
}

interface OtherPerspectiveWaveformChartProps {
  waveform?: OtherPerspectiveWaveform | null;
  selfWaveform?: {
    totalVirtueCount: number;
    totalMineCount: number;
    totalNeutralCount: number;
  } | null;
  onUpdate?: () => void;
  isUpdating?: boolean;
}

// 親密度レベルのラベルと色
const INTIMACY_LEVEL_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  stranger: { label: "知らない人", color: "text-gray-500", bgColor: "bg-gray-100" },
  acquaintance: { label: "知り合い", color: "text-blue-500", bgColor: "bg-blue-100" },
  friend: { label: "友達", color: "text-green-500", bgColor: "bg-green-100" },
  close_friend: { label: "親しい友達", color: "text-purple-500", bgColor: "bg-purple-100" },
  best_friend: { label: "親友", color: "text-pink-500", bgColor: "bg-pink-100" },
};

// 予測者の内訳カード
function PredictorBreakdownCard({
  predictorId,
  data,
  index
}: {
  predictorId: string;
  data: PredictorBreakdown;
  index: number;
}) {
  if (!data) return null;
  
  const total = (data.virtueCount || 0) + (data.mineCount || 0) + (data.neutralCount || 0);
  const virtuePercent = total > 0 ? (((data.virtueCount || 0) / total) * 100).toFixed(0) : "0";
  const minePercent = total > 0 ? (((data.mineCount || 0) / total) * 100).toFixed(0) : "0";
  
  const levelConfig = INTIMACY_LEVEL_CONFIG[data.intimacyLevel] || INTIMACY_LEVEL_CONFIG.stranger;
  const intimacyScore = data.intimacyScore ?? 0;
  const weight = data.weight ?? 0;
  const predictionAccuracy = data.predictionAccuracy ?? 0;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">P{index + 1}</Badge>
          <span className="font-medium text-sm">{data.predictorName}</span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge className={`text-xs ${levelConfig.bgColor} ${levelConfig.color}`}>
                {levelConfig.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>親密度: {intimacyScore.toFixed(0)}点</p>
              <p>重み: {(weight * 100).toFixed(0)}%</p>
              {predictionAccuracy > 0 && (
                <p>予測精度: {predictionAccuracy.toFixed(0)}%</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      
      {/* 親密度バー */}
      <div className="mb-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Heart className="h-3 w-3" />
          <span>親密度</span>
          <span className="ml-auto">{intimacyScore.toFixed(0)}%</span>
        </div>
        <Progress value={intimacyScore} className="h-1.5" />
      </div>
      
      {/* 徳/地雷/中立の内訳バー */}
      <div className="mb-2">
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
    </Card>
  );
}

// 自己申告波形と他者視点波形の比較グラフ
function ComparisonGraph({
  selfWaveform,
  otherWaveform
}: {
  selfWaveform: { totalVirtueCount: number; totalMineCount: number; totalNeutralCount: number } | null | undefined;
  otherWaveform: { totalVirtueCount: number; totalMineCount: number; totalNeutralCount: number };
}) {
  if (!selfWaveform) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        自己申告波形がまだ生成されていません
      </div>
    );
  }
  
  const selfTotal = selfWaveform.totalVirtueCount + selfWaveform.totalMineCount + selfWaveform.totalNeutralCount;
  const otherTotal = otherWaveform.totalVirtueCount + otherWaveform.totalMineCount + otherWaveform.totalNeutralCount;
  
  const selfVirtueRatio = selfTotal > 0 ? (selfWaveform.totalVirtueCount / selfTotal) * 100 : 0;
  const selfMineRatio = selfTotal > 0 ? (selfWaveform.totalMineCount / selfTotal) * 100 : 0;
  
  const otherVirtueRatio = otherTotal > 0 ? (otherWaveform.totalVirtueCount / otherTotal) * 100 : 0;
  const otherMineRatio = otherTotal > 0 ? (otherWaveform.totalMineCount / otherTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* 徳の比較 */}
      <div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-green-600 font-medium">徳の割合</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs w-16 text-muted-foreground">自己申告</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all"
                style={{ width: `${selfVirtueRatio}%` }}
              />
            </div>
            <span className="text-xs w-12 text-right">{selfVirtueRatio.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs w-16 text-muted-foreground">他者視点</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-400 transition-all"
                style={{ width: `${otherVirtueRatio}%` }}
              />
            </div>
            <span className="text-xs w-12 text-right">{otherVirtueRatio.toFixed(0)}%</span>
          </div>
        </div>
      </div>
      
      {/* 地雷の比較 */}
      <div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-red-600 font-medium">地雷の割合</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs w-16 text-muted-foreground">自己申告</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-red-500 transition-all"
                style={{ width: `${selfMineRatio}%` }}
              />
            </div>
            <span className="text-xs w-12 text-right">{selfMineRatio.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs w-16 text-muted-foreground">他者視点</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-red-400 transition-all"
                style={{ width: `${otherMineRatio}%` }}
              />
            </div>
            <span className="text-xs w-12 text-right">{otherMineRatio.toFixed(0)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OtherPerspectiveWaveformChart({
  waveform,
  selfWaveform,
  onUpdate,
  isUpdating = false
}: OtherPerspectiveWaveformChartProps) {
  // 予測者データを親密度順にソート
  const sortedPredictors = useMemo(() => {
    if (!waveform?.predictorBreakdown) return [];
    
    return Object.entries(waveform.predictorBreakdown)
      .map(([id, data]) => ({ id, data }))
      .sort((a, b) => b.data.intimacyScore - a.data.intimacyScore);
  }, [waveform]);

  // 乖離度の解釈
  const getGapInterpretation = (gap: number) => {
    if (gap < 10) return { level: "低", color: "text-green-600", message: "自己認識と他者からの評価がほぼ一致しています" };
    if (gap < 25) return { level: "中", color: "text-yellow-600", message: "自己認識と他者からの評価に若干の差があります" };
    return { level: "高", color: "text-red-600", message: "自己認識と他者からの評価に大きな差があります" };
  };

  if (!waveform || sortedPredictors.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5" />
            他者視点波形
          </CardTitle>
          <CardDescription>
            友達があなたの行動をどう予測するかに基づく波形です
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>まだ他者視点波形が生成されていません</p>
            <p className="text-sm mt-2">
              友達の分身AIがあなたの行動を予測することで生成されます
            </p>
            {onUpdate && (
              <Button
                onClick={onUpdate}
                disabled={isUpdating}
                className="mt-4"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    更新中...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    他者視点波形を生成
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const gapInterpretation = waveform.selfReportGap !== undefined 
    ? getGapInterpretation(waveform.selfReportGap) 
    : null;

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5" />
            他者視点波形
          </CardTitle>
          <CardDescription>
            {sortedPredictors.length}人の友達による予測（親密度順）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 乖離度アラート */}
          {gapInterpretation && waveform.selfReportGap !== undefined && (
            <div className={`flex items-start gap-3 p-4 rounded-lg ${
              waveform.selfReportGap >= 25 ? 'bg-red-500/10' : 
              waveform.selfReportGap >= 10 ? 'bg-yellow-500/10' : 'bg-green-500/10'
            }`}>
              <AlertTriangle className={`h-5 w-5 mt-0.5 ${gapInterpretation.color}`} />
              <div>
                <p className={`font-medium ${gapInterpretation.color}`}>
                  自己認識ギャップ: {(waveform.selfReportGap ?? 0).toFixed(1)}%（{gapInterpretation.level}）
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {gapInterpretation.message}
                </p>
              </div>
            </div>
          )}

          {/* 総合スコア */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">徳（予測）</p>
                <p className="text-2xl font-bold text-green-600">
                  {waveform.totalVirtueCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-gray-500/10 rounded-lg">
              <Users className="h-8 w-8 text-gray-500" />
              <div>
                <p className="text-sm text-muted-foreground">中立（予測）</p>
                <p className="text-2xl font-bold text-gray-600">
                  {waveform.totalNeutralCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-red-500/10 rounded-lg">
              <TrendingDown className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">地雷（予測）</p>
                <p className="text-2xl font-bold text-red-600">
                  {waveform.totalMineCount}
                </p>
              </div>
            </div>
          </div>

          {/* 自己申告との比較 */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4" />
              自己申告波形との比較
            </h4>
            <div className="bg-muted/30 rounded-lg p-4">
              <ComparisonGraph 
                selfWaveform={selfWaveform} 
                otherWaveform={waveform} 
              />
            </div>
          </div>

          {/* 各予測者の内訳 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              各友達の予測内訳（親密度順）
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedPredictors.map((predictor, i) => (
                <PredictorBreakdownCard
                  key={predictor.id}
                  predictorId={predictor.id}
                  data={predictor.data}
                  index={i}
                />
              ))}
            </div>
          </div>

          {/* 更新ボタン */}
          {onUpdate && (
            <div className="flex justify-center">
              <Button
                onClick={onUpdate}
                disabled={isUpdating}
                variant="outline"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    更新中...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    他者視点波形を更新
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

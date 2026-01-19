import { useMemo } from "react";

interface BigFiveTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

interface JudgmentThresholds {
  goodEvil: number;
  likesDislike: number;
  profitLoss: number;
  interest: number;
  pleasurePain: number;
  difficulty: number;
  possibility: number;
  comfort: number;
  rightWrong: number;
}

interface PersonalityRadarChartProps {
  bigFiveTraits?: BigFiveTraits | null;
  judgmentThresholds?: JudgmentThresholds | null;
  size?: number;
  showLabels?: boolean;
}

// SVGベースのレーダーチャート
function RadarChart({ 
  data, 
  labels, 
  color, 
  size = 200,
  title
}: { 
  data: number[]; 
  labels: string[]; 
  color: string;
  size?: number;
  title: string;
}) {
  const center = size / 2;
  const radius = size * 0.35;
  const angleStep = (2 * Math.PI) / data.length;

  // データポイントの座標を計算
  const points = useMemo(() => {
    return data.map((value, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = (value / 100) * radius;
      return {
        x: center + r * Math.cos(angle),
        y: center + r * Math.sin(angle)
      };
    });
  }, [data, center, radius, angleStep]);

  // グリッドラインの座標
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <div className="flex flex-col items-center">
      <h4 className="text-sm font-medium mb-2">{title}</h4>
      <svg width={size} height={size} className="overflow-visible">
        {/* グリッドライン */}
        {gridLevels.map((level, levelIdx) => {
          const gridPoints = data.map((_, i) => {
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

        {/* 軸線 */}
        {data.map((_, i) => {
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
          fill={color}
          fillOpacity={0.3}
          stroke={color}
          strokeWidth={2}
        />

        {/* データポイント */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            fill={color}
          />
        ))}

        {/* ラベル */}
        {labels.map((label, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const labelRadius = radius + 20;
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
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function PersonalityRadarChart({
  bigFiveTraits,
  judgmentThresholds,
  size = 200
}: PersonalityRadarChartProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* ビッグ・ファイブ */}
      {bigFiveTraits && (
        <RadarChart
          title="ビッグ・ファイブ性格特性"
          data={[
            bigFiveTraits.openness,
            bigFiveTraits.conscientiousness,
            bigFiveTraits.extraversion,
            bigFiveTraits.agreeableness,
            100 - bigFiveTraits.neuroticism // 神経症的傾向は逆転（安定性として表示）
          ]}
          labels={["開放性", "誠実性", "外向性", "協調性", "安定性"]}
          color="#3b82f6"
          size={size}
        />
      )}

      {/* 判断基準閾値 */}
      {judgmentThresholds && (
        <RadarChart
          title="9つの判断基準"
          data={[
            judgmentThresholds.goodEvil,
            judgmentThresholds.likesDislike,
            judgmentThresholds.profitLoss,
            judgmentThresholds.interest,
            judgmentThresholds.pleasurePain,
            judgmentThresholds.difficulty,
            judgmentThresholds.possibility,
            judgmentThresholds.comfort,
            judgmentThresholds.rightWrong
          ]}
          labels={["善悪", "好嫌", "損得", "利害", "苦楽", "難易", "可否", "快不快", "正誤"]}
          color="#10b981"
          size={size}
        />
      )}
    </div>
  );
}

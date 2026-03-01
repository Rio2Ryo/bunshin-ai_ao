import { Radar, RadarChart as RechartsRadar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from "recharts";

type RadarChartProps = {
  data: Array<{ trait: string; value: number; fullMark?: number }>;
  compareData?: Array<{ trait: string; value: number }>;
  userName?: string;
  compareName?: string;
};

export function RadarChart({ data, compareData, userName = "自分", compareName = "比較対象" }: RadarChartProps) {
  const merged = data.map((d, i) => ({
    trait: d.trait,
    value: d.value,
    compare: compareData?.[i]?.value ?? undefined,
    fullMark: d.fullMark ?? 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsRadar cx="50%" cy="50%" outerRadius="80%" data={merged}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis dataKey="trait" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Radar
          name={userName}
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.3}
        />
        {compareData && (
          <Radar
            name={compareName}
            dataKey="compare"
            stroke="hsl(var(--chart-2))"
            fill="hsl(var(--chart-2))"
            fillOpacity={0.2}
          />
        )}
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </RechartsRadar>
    </ResponsiveContainer>
  );
}

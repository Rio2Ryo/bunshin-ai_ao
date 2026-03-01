import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

export function AnalyticsWidget() {
  const { data: analytics } = trpc.analytics.dashboard.useQuery(undefined, { staleTime: 120_000 });

  const chartData = (analytics?.monthlyTrend ?? []).map((m: any) => ({
    month: m.month?.split("-")[1] || "",
    count: m.count,
    avgScore: m.avgScore,
  }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            アクティビティ
          </CardTitle>
          <Link href="/analytics">
            <Button variant="ghost" size="sm" className="text-xs">詳細</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">データがありません</p>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData}>
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: any, name: string) => [value, name === "count" ? "件数" : "平均スコア"]}
              />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Activity, Database, HardDrive, Brain, CreditCard, MessageSquare, RefreshCw, Clock, AlertTriangle, CheckCircle2, XCircle, Users, Zap, Server } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

const API_BASE = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:8787"
  : "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

type HealthData = {
  ok: boolean;
  timestamp: string;
  version: string;
  checks: {
    database: { ok: boolean; latencyMs: number };
    r2Storage: { ok: boolean };
    llm: { ok: boolean };
  };
  responseTimeMs: number;
  requestCount: number;
  errorCount: number;
  startedAt: string;
};

type DetailedHealth = {
  ok: boolean;
  timestamp: string;
  version: string;
  responseTimeMs: number;
  database: {
    users: number;
    twins: number;
    matchingSessions: number;
    chatMessages: number;
    unreadNotifications: number;
    failedMatchings: number;
  };
  activity: {
    activeUsers24h: number;
  };
  services: {
    database: boolean;
    r2Storage: boolean;
    llm: boolean;
    stripe: boolean;
    slack: boolean;
  };
};

export default function HealthDashboard() {
  usePageMeta({ title: "システムヘルス", description: "API・DB・サービスの稼働状況", path: "/health" });
  const [health, setHealth] = useState<HealthData | null>(null);
  const [detailed, setDetailed] = useState<DetailedHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ time: string; latency: number; ok: boolean }[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      const data = await res.json() as HealthData;
      setHealth(data);
      setHistory(prev => [...prev.slice(-29), {
        time: new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        latency: data.responseTimeMs,
        ok: data.ok,
      }]);

      // Try detailed (admin only, may fail)
      try {
        const dRes = await fetch(`${API_BASE}/api/health/detailed`, { credentials: "include" });
        if (dRes.ok) {
          const dData = await dRes.json() as DetailedHealth;
          setDetailed(dData);
        }
      } catch { /* not admin */ }

      setError(null);
    } catch (err) {
      setError("ヘルスチェックに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    if (!autoRefresh) return;
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, [fetchHealth, autoRefresh]);

  const errorRate = health ? (health.requestCount > 0 ? ((health.errorCount / health.requestCount) * 100).toFixed(2) : "0.00") : "--";
  const uptime = health?.ok ? "稼働中" : "停止中";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              ヘルスダッシュボード
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              本番環境の稼働状況・パフォーマンスモニタリング
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={autoRefresh ? "border-green-500/50 text-green-500" : ""}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: "3s" } : {}} />
              {autoRefresh ? "自動更新中" : "自動更新OFF"}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {error}
          </div>
        )}

        {/* Status Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatusCard
            icon={<Server className="h-5 w-5" />}
            label="ステータス"
            value={uptime}
            status={health?.ok ? "ok" : "error"}
          />
          <StatusCard
            icon={<Clock className="h-5 w-5" />}
            label="応答時間"
            value={health ? `${health.responseTimeMs}ms` : "--"}
            status={health && health.responseTimeMs < 1000 ? "ok" : health && health.responseTimeMs < 3000 ? "warning" : "error"}
          />
          <StatusCard
            icon={<AlertTriangle className="h-5 w-5" />}
            label="エラー率"
            value={`${errorRate}%`}
            status={parseFloat(errorRate) < 1 ? "ok" : parseFloat(errorRate) < 5 ? "warning" : "error"}
          />
          <StatusCard
            icon={<Zap className="h-5 w-5" />}
            label="リクエスト数"
            value={health ? health.requestCount.toLocaleString() : "--"}
            status="ok"
          />
        </div>

        {/* Service Health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">サービス状態</CardTitle>
            <CardDescription>各コンポーネントの稼働状況</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <ServiceBadge
                icon={<Database className="h-4 w-4" />}
                name="データベース"
                ok={health?.checks.database.ok ?? false}
                detail={health ? `${health.checks.database.latencyMs}ms` : ""}
              />
              <ServiceBadge
                icon={<HardDrive className="h-4 w-4" />}
                name="R2ストレージ"
                ok={health?.checks.r2Storage.ok ?? false}
              />
              <ServiceBadge
                icon={<Brain className="h-4 w-4" />}
                name="LLM (Azure AI)"
                ok={health?.checks.llm.ok ?? false}
              />
              <ServiceBadge
                icon={<CreditCard className="h-4 w-4" />}
                name="Stripe"
                ok={detailed?.services.stripe ?? false}
              />
              <ServiceBadge
                icon={<MessageSquare className="h-4 w-4" />}
                name="Slack"
                ok={detailed?.services.slack ?? false}
              />
            </div>
          </CardContent>
        </Card>

        {/* Response Time Chart (simple bar chart) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">応答時間推移</CardTitle>
            <CardDescription>30秒間隔で自動計測（最新30件）</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">データ収集中...</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {history.map((h, i) => {
                  const maxLatency = Math.max(...history.map(x => x.latency), 100);
                  const height = Math.max((h.latency / maxLatency) * 100, 4);
                  const color = h.ok
                    ? h.latency < 1000 ? "bg-green-500" : h.latency < 3000 ? "bg-yellow-500" : "bg-red-500"
                    : "bg-red-500";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${h.time}: ${h.latency}ms`}>
                      <div className={`w-full rounded-t ${color} transition-all`} style={{ height: `${height}%` }} />
                    </div>
                  );
                })}
              </div>
            )}
            {history.length > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>{history[0]?.time}</span>
                <span>{history[history.length - 1]?.time}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Version & Meta */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">システム情報</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">バージョン</p>
                <p className="font-mono font-semibold">{health?.version ?? "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">最終チェック</p>
                <p className="font-mono">{health?.timestamp ? new Date(health.timestamp).toLocaleString("ja-JP") : "--"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ワーカー起動</p>
                <p className="font-mono">{health?.startedAt && health.startedAt !== "1970-01-01T00:00:00.000Z" ? new Date(health.startedAt).toLocaleString("ja-JP") : "CF Workers (stateless)"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">DBレイテンシ</p>
                <p className="font-mono">{health?.checks.database.latencyMs ?? "--"}ms</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Detailed Stats (admin only) */}
        {detailed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                詳細統計（管理者専用）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatItem label="ユーザー数" value={detailed.database.users} />
                <StatItem label="ツイン数" value={detailed.database.twins} />
                <StatItem label="マッチング数" value={detailed.database.matchingSessions} />
                <StatItem label="チャットメッセージ" value={detailed.database.chatMessages} />
                <StatItem label="未読通知" value={detailed.database.unreadNotifications} />
                <StatItem label="失敗マッチング" value={detailed.database.failedMatchings} />
                <StatItem label="24h アクティブユーザー" value={detailed.activity.activeUsers24h} />
                <StatItem label="API応答時間" value={`${detailed.responseTimeMs}ms`} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusCard({ icon, label, value, status }: { icon: React.ReactNode; label: string; value: string; status: "ok" | "warning" | "error" }) {
  const colors = {
    ok: "border-green-500/30 text-green-500",
    warning: "border-yellow-500/30 text-yellow-500",
    error: "border-red-500/30 text-red-500",
  };
  return (
    <Card className={`${colors[status]} bg-card/80`}>
      <CardContent className="p-4 text-center">
        <div className="flex justify-center mb-2">{icon}</div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function ServiceBadge({ icon, name, ok, detail }: { icon: React.ReactNode; name: string; ok: boolean; detail?: string }) {
  return (
    <div className={`flex items-center gap-2 p-3 rounded-lg border ${ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
      {ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{name}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg text-center">
      <p className="text-xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

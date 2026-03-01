import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Shield, Bot, UserPlus, MessageSquare, FileText } from "lucide-react";
import { Link } from "wouter";

export function KpiWidget() {
  const { data: trustData } = trpc.trust.getScore.useQuery(undefined, { staleTime: 60_000 });
  const { data: friends } = trpc.friends.list.useQuery(undefined, { staleTime: 30_000 });
  const { data: chatSessions } = trpc.chat.sessions.useQuery(undefined, { staleTime: 30_000 });
  const { data: matchingSessions } = trpc.matching.sessions.useQuery(undefined, { staleTime: 30_000 });
  const { data: myTwin } = trpc.myTwin.get.useQuery(undefined, { staleTime: 30_000 });

  const completedMatchings = matchingSessions?.filter((s: any) => s.status === "completed").length || 0;

  const stats = [
    { icon: Shield, label: "信頼度", value: `${trustData?.score ?? 0}pt`, href: "/trust" },
    { icon: Bot, label: "分身AI", value: myTwin ? "作成済み" : "未作成", href: "/twins" },
    { icon: UserPlus, label: "友達", value: `${friends?.length || 0}人`, href: "/friends" },
    { icon: MessageSquare, label: "チャット", value: `${chatSessions?.length || 0}件`, href: "/chat" },
    { icon: FileText, label: "マッチング", value: `${completedMatchings}件完了`, href: "/matching" },
  ];

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
      {stats.map(({ icon: Icon, label, value, href }) => (
        <Link key={href} href={href}>
          <div className="flex items-center gap-2.5 p-3 rounded-lg border bg-card hover:border-primary/50 transition-colors cursor-pointer">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-medium truncate">{value}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

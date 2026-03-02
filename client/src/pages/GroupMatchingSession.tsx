import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { ArrowLeft, Bot, Loader2, BarChart3, MessageSquare, Lightbulb, AlertTriangle, CheckCircle, Users } from "lucide-react";
import { LazyStreamdown as Streamdown } from "@/components/LazyStreamdown";

// Color palette for participants
const PARTICIPANT_COLORS = [
  { bg: "bg-primary/20", text: "text-primary", badge: "bg-primary/10 text-primary" },
  { bg: "bg-green-500/20", text: "text-green-600", badge: "bg-green-500/10 text-green-700" },
  { bg: "bg-orange-500/20", text: "text-orange-600", badge: "bg-orange-500/10 text-orange-700" },
  { bg: "bg-purple-500/20", text: "text-purple-600", badge: "bg-purple-500/10 text-purple-700" },
  { bg: "bg-pink-500/20", text: "text-pink-600", badge: "bg-pink-500/10 text-pink-700" },
];

export default function GroupMatchingSession() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  usePageMeta({
    title: `グループマッチング #${sessionId}`,
    description: "グループマッチング結果の詳細",
    path: `/matching/group/${id}`,
  });

  const { data, isLoading, isError } = trpc.matching.getGroupSession.useQuery(
    { id: sessionId },
    { enabled: sessionId > 0 }
  );

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !data?.session) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">セッションが見つかりません</p>
          <Link href="/matching">
            <Button className="mt-4">一覧に戻る</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const { session, participants, dialogues, result } = data;
  const overallScore = result?.compatibilityScore ? parseFloat(result.compatibilityScore) : 0;
  const pairwise = result?.scoreBreakdown || {};

  // Build twinId → participant map for coloring
  const twinMap = new Map<number, { name: string; colorIdx: number }>();
  participants.forEach((p: any, i: number) => {
    twinMap.set(p.twinId, { name: p.twinName, colorIdx: i % PARTICIPANT_COLORS.length });
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/matching">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              {session.theme}
            </h1>
            <p className="text-muted-foreground">
              グループマッチング（{participants.length}人）
            </p>
          </div>
        </div>

        {/* Participants */}
        <div className="flex flex-wrap gap-3">
          {participants.map((p: any, i: number) => {
            const color = PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length];
            return (
              <div key={p.userId} className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${color.badge}`}>
                <Avatar className="h-6 w-6">
                  {p.avatarUrl ? <AvatarImage src={`${API_BASE}${p.avatarUrl}`} alt={p.userName} /> : null}
                  <AvatarFallback className="text-xs">{(p.userName || "?").slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{p.twinName}</span>
              </div>
            );
          })}
        </div>

        {/* Overall Score */}
        {result && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                グループ相性スコア
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">全体スコア</span>
                  <span className="text-3xl font-bold text-primary">{overallScore}%</span>
                </div>
                <Progress value={overallScore} className="h-3" />
                {result.summary && (
                  <p className="text-sm text-muted-foreground mt-2">{result.summary}</p>
                )}

                {/* Pairwise scores */}
                {Object.keys(pairwise).length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <h4 className="text-sm font-medium mb-3">ペア別スコア</h4>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(pairwise).map(([pair, data]: [string, any]) => (
                        <div key={pair} className="bg-muted/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium truncate">{pair}</span>
                            <Badge variant="secondary" className="ml-2">{data?.score ?? 0}%</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{data?.summary || ""}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Dialogue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              グループ対話
            </CardTitle>
            <CardDescription>{dialogues.length}ターン・ラウンドロビン形式</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-3">
                {dialogues.map((d: any, i: number) => {
                  const info = twinMap.get(d.speakerTwinId);
                  const colorIdx = info?.colorIdx ?? 0;
                  const color = PARTICIPANT_COLORS[colorIdx];
                  const speakerName = d.speakerName || info?.name || `Twin #${d.speakerTwinId}`;

                  return (
                    <div key={d.id || i} className="flex gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${color.bg}`}>
                        <Bot className={`h-4 w-4 ${color.text}`} />
                      </div>
                      <div className="flex-1">
                        <p className={`text-xs font-medium mb-1 ${color.text}`}>{speakerName}</p>
                        <div className="rounded-lg p-3 bg-muted">
                          <Streamdown>{d.content}</Streamdown>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Analysis */}
        {result && (
          <div className="grid gap-6 md:grid-cols-2">
            {result.strengths && result.strengths.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    強み
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {result.strengths.map((s: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{s}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {result.challenges && result.challenges.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                    課題
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {result.challenges.map((c: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{c}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {result.recommendations && result.recommendations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    提案
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {result.recommendations.map((r: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center flex-shrink-0">{i + 1}</span>
                        <span className="text-sm">{r}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {result.detailedAnalysis && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>グループダイナミクス</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <Streamdown>{result.detailedAnalysis}</Streamdown>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

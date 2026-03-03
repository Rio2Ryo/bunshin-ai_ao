import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Tag, Filter, BarChart3, Search, X, Plus, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const TAG_CATEGORIES = [
  { value: "industry", label: "業種" },
  { value: "purpose", label: "目的" },
  { value: "partner_type", label: "相手タイプ" },
  { value: "custom", label: "カスタム" },
];

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export default function SessionTags() {
  usePageMeta({ title: "セッションタグ", description: "マッチングセッションのタグ管理と分析", path: "/session-tags" });

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagCategory, setNewTagCategory] = useState("custom");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterOperator, setFilterOperator] = useState<"AND" | "OR">("AND");
  const [scoreRange, setScoreRange] = useState([0, 100]);

  const { data: sessionsRaw } = trpc.matching.sessions.useQuery();
  const sessions = (sessionsRaw as any[]) || [];

  const { data: sessionTagsRaw, refetch: refetchSessionTags } = trpc.matching.getSessionTags.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: selectedSessionId != null }
  );
  const sessionTags = (sessionTagsRaw as any[]) || [];

  const { data: allTagsRaw, refetch: refetchAllTags } = trpc.matching.getAllTags.useQuery();
  const allTags = (allTagsRaw as any[]) || [];

  const { data: analyticsRaw } = trpc.matching.getTagAnalytics.useQuery();
  const analytics = (analyticsRaw as any[]) || [];

  const { data: filteredRaw } = trpc.matching.filterSessionsByTags.useQuery(
    { tags: filterTags, operator: filterOperator, minScore: scoreRange[0], maxScore: scoreRange[1] },
    { enabled: filterTags.length > 0 }
  );
  const filteredSessions = (filteredRaw as any[]) || [];

  const addTag = trpc.matching.addSessionTag.useMutation({
    onSuccess: () => {
      toast.success("タグを追加しました");
      setNewTagName("");
      refetchSessionTags();
      refetchAllTags();
    },
    onError: (err: any) => toast.error(err.message || "タグ追加に失敗しました"),
  });

  const removeTag = trpc.matching.removeSessionTag.useMutation({
    onSuccess: () => {
      toast.success("タグを削除しました");
      refetchSessionTags();
      refetchAllTags();
    },
    onError: (err: any) => toast.error(err.message || "タグ削除に失敗しました"),
  });

  const handleAddTag = () => {
    if (selectedSessionId == null) { toast.error("セッションを選択してください"); return; }
    if (!newTagName.trim()) { toast.error("タグ名を入力してください"); return; }
    addTag.mutate({ sessionId: selectedSessionId, tag: newTagName.trim(), category: newTagCategory });
  };

  const toggleFilterTag = (tagName: string) => {
    setFilterTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Tag className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">セッションタグ</h1>
            <p className="text-muted-foreground text-sm">マッチングセッションにタグを付けて分析</p>
          </div>
        </div>

        <Tabs defaultValue="manage" className="space-y-4">
          <TabsList>
            <TabsTrigger value="manage" className="gap-1.5"><Tag className="h-4 w-4" />タグ管理</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="h-4 w-4" />タグ別分析</TabsTrigger>
            <TabsTrigger value="filter" className="gap-1.5"><Filter className="h-4 w-4" />スマートフィルタ</TabsTrigger>
          </TabsList>

          {/* Tab 1: タグ管理 */}
          <TabsContent value="manage" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">セッション選択</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select
                  value={selectedSessionId != null ? String(selectedSessionId) : ""}
                  onValueChange={(v) => setSelectedSessionId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="セッションを選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.title || s.name || s.theme || `セッション #${s.id}`} - {s.createdAt ? new Date(s.createdAt).toLocaleDateString("ja-JP") : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedSessionId != null && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {sessionTags.length === 0 && <p className="text-sm text-muted-foreground">タグなし</p>}
                      {sessionTags.map((tag: any) => (
                        <Badge key={tag.id || tag.tag} variant="secondary" className="gap-1 pr-1">
                          {tag.tag || tag.name}
                          <button
                            onClick={() => removeTag.mutate({ sessionId: selectedSessionId, tag: tag.tag || tag.name })}
                            className="ml-1 hover:text-red-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Select value={newTagCategory} onValueChange={setNewTagCategory}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TAG_CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="タグ名を入力..."
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                        className="flex-1"
                      />
                      <Button onClick={handleAddTag} disabled={addTag.isPending} size="icon">
                        {addTag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">全タグ一覧</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {allTags.length === 0 && <p className="text-sm text-muted-foreground">タグがまだありません</p>}
                  {allTags.map((tag: any) => (
                    <Badge key={tag.tag || tag.name} variant="outline" className="gap-1">
                      {tag.tag || tag.name}
                      <span className="text-xs text-muted-foreground ml-1">({tag.count || 0})</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: タグ別分析 */}
          <TabsContent value="analytics" className="space-y-4">
            {analytics.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">
                タグデータがありません。セッションにタグを追加してください。
              </CardContent></Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">タグ別平均スコア</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analytics}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="tag" tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 100]} />
                          <Tooltip />
                          <Bar dataKey="avgScore" name="平均スコア" radius={[4, 4, 0, 0]}>
                            {analytics.map((_: any, idx: number) => (
                              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {analytics.map((item: any) => (
                    <Card key={item.tag}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Tag className="h-4 w-4" />{item.tag}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-muted-foreground">平均:</span> <span className="font-medium">{(item.avgScore ?? 0).toFixed(1)}</span></div>
                          <div><span className="text-muted-foreground">最高:</span> <span className="font-medium text-green-500">{item.maxScore ?? 0}</span></div>
                          <div><span className="text-muted-foreground">最低:</span> <span className="font-medium text-red-500">{item.minScore ?? 0}</span></div>
                          <div><span className="text-muted-foreground">件数:</span> <span className="font-medium">{item.sessionCount ?? 0}</span></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* Tab 3: スマートフィルタ */}
          <TabsContent value="filter" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Search className="h-5 w-5" />フィルタ設定
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>タグ選択</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {allTags.length === 0 && <p className="text-sm text-muted-foreground">タグがありません</p>}
                    {allTags.map((tag: any) => {
                      const name = tag.tag || tag.name;
                      const selected = filterTags.includes(name);
                      return (
                        <Badge
                          key={name}
                          variant={selected ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => toggleFilterTag(name)}
                        >
                          {name}
                          {selected && <X className="h-3 w-3 ml-1" />}
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Label>条件:</Label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={filterOperator === "AND" ? "default" : "outline"}
                      onClick={() => setFilterOperator("AND")}
                    >AND</Button>
                    <Button
                      size="sm"
                      variant={filterOperator === "OR" ? "default" : "outline"}
                      onClick={() => setFilterOperator("OR")}
                    >OR</Button>
                  </div>
                </div>

                <div>
                  <Label>スコア範囲: {scoreRange[0]} - {scoreRange[1]}</Label>
                  <Slider
                    value={scoreRange}
                    onValueChange={setScoreRange}
                    min={0}
                    max={100}
                    step={5}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  検索結果 {filterTags.length > 0 && `(${filteredSessions.length}件)`}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filterTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">タグを選択してフィルタを実行してください</p>
                ) : filteredSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">条件に一致するセッションがありません</p>
                ) : (
                  <div className="space-y-2">
                    {filteredSessions.map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{s.title || s.name || s.theme || `セッション #${s.id}`}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(typeof s.tags === "string" ? s.tags.split(",") : (s.tags as string[]) || []).map((t: string) => (
                              <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                            ))}
                          </div>
                        </div>
                        <Badge variant={Number(s.compatibilityScore || s.score) >= 70 ? "default" : "secondary"}>
                          {s.compatibilityScore ?? s.score ?? "-"}点
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

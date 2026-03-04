import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useWorkspaceRoom } from "@/hooks/useWorkspaceRoom";
import {
  ArrowLeft, Loader2, Plus, Users, Trash2, StickyNote, Target,
  Lightbulb, CheckCircle, AlertTriangle, BarChart3, Wifi, WifiOff,
  UserPlus, Edit, Save, X, LayoutGrid, Import, Zap, Columns, GripVertical,
} from "lucide-react";

const ITEM_COLORS: Record<string, string> = {
  note: "border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20",
  matching_result: "border-blue-300 bg-blue-50 dark:bg-blue-900/20",
  goal: "border-green-300 bg-green-50 dark:bg-green-900/20",
  insight: "border-purple-300 bg-purple-50 dark:bg-purple-900/20",
  action: "border-orange-300 bg-orange-50 dark:bg-orange-900/20",
};

const ITEM_ICONS: Record<string, React.ElementType> = {
  note: StickyNote,
  matching_result: BarChart3,
  goal: Target,
  insight: Lightbulb,
  action: Zap,
};

const ITEM_LABELS: Record<string, string> = {
  note: "メモ",
  matching_result: "マッチング結果",
  goal: "目標",
  insight: "インサイト",
  action: "アクション",
};

/* ------------------------------------------------------------------ */
/*  Sub-component 1: WorkspaceBoardTab                                 */
/* ------------------------------------------------------------------ */

type WorkspaceBoardTabProps = {
  workspaceId: number;
  items: any[];
  sessions: any[];
  onRefetch: () => void;
  broadcastItemAdd: (item: any) => void;
  broadcastItemUpdate: (itemId: number, changes: any) => void;
  broadcastItemDelete: (itemId: number) => void;
};

function WorkspaceBoardTab({
  workspaceId,
  items,
  sessions,
  onRefetch,
  broadcastItemAdd,
  broadcastItemUpdate,
  broadcastItemDelete,
}: WorkspaceBoardTabProps) {
  const addItemMut = trpc.workspace.addItem.useMutation();
  const updateItemMut = trpc.workspace.updateItem.useMutation();
  const deleteItemMut = trpc.workspace.deleteItem.useMutation();
  const importMatchingMut = trpc.workspace.importMatching.useMutation();

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [newItemType, setNewItemType] = useState<string>("note");
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemContent, setNewItemContent] = useState("");
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [importSessionId, setImportSessionId] = useState("");

  const completedSessions = sessions?.filter((s: any) => s.status === "completed") || [];

  const handleAddItem = async () => {
    if (!newItemTitle.trim()) { toast.error("タイトルを入力してください"); return; }
    try {
      const result = await addItemMut.mutateAsync({
        workspaceId,
        type: newItemType as any,
        title: newItemTitle.trim(),
        content: newItemContent.trim() || undefined,
      });
      broadcastItemAdd({ id: result.id, type: newItemType, title: newItemTitle });
      setIsAddItemOpen(false);
      setNewItemTitle("");
      setNewItemContent("");
      onRefetch();
      toast.success("アイテムを追加しました");
    } catch (e: any) { toast.error(e.message || "追加に失敗しました"); }
  };

  const handleUpdateItem = async (itemId: number) => {
    try {
      await updateItemMut.mutateAsync({ itemId, title: editTitle, content: editContent });
      broadcastItemUpdate(itemId, { title: editTitle, content: editContent });
      setEditingItem(null);
      onRefetch();
    } catch (e: any) { toast.error(e.message || "更新に失敗しました"); }
  };

  const handleDeleteItem = async (itemId: number) => {
    try {
      await deleteItemMut.mutateAsync({ itemId });
      broadcastItemDelete(itemId);
      onRefetch();
      toast.success("削除しました");
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  const handleImport = async () => {
    if (!importSessionId) return;
    try {
      await importMatchingMut.mutateAsync({ workspaceId, sessionId: parseInt(importSessionId) });
      setIsImportOpen(false);
      setImportSessionId("");
      onRefetch();
      toast.success("マッチング結果をインポートしました");
    } catch (e: any) { toast.error(e.message || "インポートに失敗しました"); }
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />アイテム追加</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>アイテム追加</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>タイプ</Label>
                <Select value={newItemType} onValueChange={setNewItemType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ITEM_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>タイトル</Label><Input value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} placeholder="タイトル" /></div>
              <div><Label>内容</Label><Textarea value={newItemContent} onChange={(e) => setNewItemContent(e.target.value)} placeholder="内容（任意）" /></div>
              <Button onClick={handleAddItem} className="w-full" disabled={!newItemTitle.trim() || addItemMut.isPending}>
                {addItemMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}追加
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline"><Import className="h-4 w-4 mr-1" />マッチング結果をインポート</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>マッチング結果をインポート</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <Select value={importSessionId} onValueChange={setImportSessionId}>
                <SelectTrigger><SelectValue placeholder="セッションを選択" /></SelectTrigger>
                <SelectContent>
                  {completedSessions.map((s: any) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.theme} ({s.compatibilityScore ? `${s.compatibilityScore}%` : "未分析"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleImport} className="w-full" disabled={!importSessionId || importMatchingMut.isPending}>
                {importMatchingMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Import className="h-4 w-4 mr-2" />}インポート
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <StickyNote className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>アイテムがありません。追加して共同編集を始めましょう。</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item: any) => {
            const Icon = ITEM_ICONS[item.type] || StickyNote;
            const colorClass = ITEM_COLORS[item.type] || "border-gray-300";
            const isEditing = editingItem === item.id;

            return (
              <Card key={item.id} className={`border-l-4 ${colorClass} transition-all`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      {isEditing ? (
                        <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-7 text-sm" />
                      ) : (
                        <CardTitle className="text-sm">{item.title}</CardTitle>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleUpdateItem(item.id)}><Save className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingItem(null)}><X className="h-3 w-3" /></Button>
                        </>
                      ) : (
                        <>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingItem(item.id); setEditTitle(item.title); setEditContent(item.content || ""); }}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] w-fit">{ITEM_LABELS[item.type]}</Badge>
                </CardHeader>
                <CardContent>
                  {isEditing ? (
                    <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="text-sm min-h-[60px]" />
                  ) : (
                    <>
                      {item.content && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.content}</p>}
                      {item.type === "matching_result" && item.metadata?.score != null && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2"><span className="text-2xl font-bold text-primary">{item.metadata.score}%</span></div>
                          {item.metadata.strengths?.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {item.metadata.strengths.slice(0, 2).map((s: string, i: number) => (
                                <p key={i} className="text-xs flex items-start gap-1"><CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />{s}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2">{item.creatorName} · {item.updatedAt?.slice(5, 16)}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component 2: WorkspaceKanbanTab                                */
/* ------------------------------------------------------------------ */

type WorkspaceKanbanTabProps = {
  workspaceId: number;
  items: any[];
  onRefetch: () => void;
};

function WorkspaceKanbanTab({ workspaceId, items, onRefetch }: WorkspaceKanbanTabProps) {
  const createBoardItemMut = trpc.workspace.createBoardItem.useMutation();
  const updateBoardItemMut = trpc.workspace.updateBoardItem.useMutation();
  const moveBoardItemMut = trpc.workspace.moveBoardItem.useMutation();
  const deleteBoardItemMut = trpc.workspace.deleteBoardItem.useMutation();

  const [isBoardAddOpen, setIsBoardAddOpen] = useState<string | null>(null);
  const [boardNewTitle, setBoardNewTitle] = useState("");
  const [boardNewContent, setBoardNewContent] = useState("");
  const [boardNewType, setBoardNewType] = useState<string>("note");
  const [boardNewTags, setBoardNewTags] = useState("");
  const [editingBoardItem, setEditingBoardItem] = useState<number | null>(null);
  const [boardEditTitle, setBoardEditTitle] = useState("");
  const [boardEditContent, setBoardEditContent] = useState("");
  const [boardEditTags, setBoardEditTags] = useState("");
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);

  const kanbanColumns = [
    { key: "backlog", label: "検討中", color: "border-t-yellow-400", icon: Lightbulb },
    { key: "in_progress", label: "進行中", color: "border-t-blue-400", icon: Zap },
    { key: "done", label: "完了", color: "border-t-green-400", icon: CheckCircle },
  ];

  const getBoardItemsByStatus = (status: string) => {
    if (!items) return [];
    return (items as any[]).filter((item: any) => item.status === status);
  };

  const handleBoardAdd = async (status: string) => {
    if (!boardNewTitle.trim()) { toast.error("タイトルを入力してください"); return; }
    try {
      await createBoardItemMut.mutateAsync({
        workspaceId,
        title: boardNewTitle.trim(),
        content: boardNewContent.trim() || undefined,
        type: boardNewType as any,
        status: status as "backlog" | "in_progress" | "done",
        tags: boardNewTags.trim() ? boardNewTags.split(",").map(t => t.trim()).filter(Boolean).join(",") : undefined,
      });
      setIsBoardAddOpen(null);
      setBoardNewTitle("");
      setBoardNewContent("");
      setBoardNewType("note");
      setBoardNewTags("");
      onRefetch();
      toast.success("アイテムを追加しました");
    } catch (e: any) { toast.error(e.message || "追加に失敗しました"); }
  };

  const handleBoardUpdate = async (itemId: number) => {
    try {
      await updateBoardItemMut.mutateAsync({
        itemId,
        title: boardEditTitle,
        content: boardEditContent,
        tags: boardEditTags.trim() ? boardEditTags.split(",").map(t => t.trim()).filter(Boolean).join(",") : undefined,
      });
      setEditingBoardItem(null);
      onRefetch();
      toast.success("更新しました");
    } catch (e: any) { toast.error(e.message || "更新に失敗しました"); }
  };

  const handleBoardDelete = async (itemId: number) => {
    try {
      await deleteBoardItemMut.mutateAsync({ itemId });
      onRefetch();
      toast.success("削除しました");
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(itemId));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    const itemId = parseInt(e.dataTransfer.getData("text/plain"));
    if (!itemId || isNaN(itemId)) return;
    setDraggedItemId(null);
    try {
      await moveBoardItemMut.mutateAsync({ itemId, status: targetStatus as "backlog" | "in_progress" | "done" });
      onRefetch();
    } catch (e: any) { toast.error(e.message || "移動に失敗しました"); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {kanbanColumns.map((col) => {
        const colItems = getBoardItemsByStatus(col.key);
        const ColIcon = col.icon;
        return (
          <div
            key={col.key}
            className={`rounded-lg border ${col.color} border-t-4 bg-muted/20 min-h-[300px]`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.key)}
          >
            <div className="p-3 flex items-center justify-between border-b">
              <div className="flex items-center gap-2">
                <ColIcon className="h-4 w-4" />
                <span className="font-medium text-sm">{col.label}</span>
                <Badge variant="secondary" className="text-[10px] h-5">{colItems.length}</Badge>
              </div>
              <Dialog open={isBoardAddOpen === col.key} onOpenChange={(open) => { setIsBoardAddOpen(open ? col.key : null); if (!open) { setBoardNewTitle(""); setBoardNewContent(""); setBoardNewType("note"); setBoardNewTags(""); } }}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7"><Plus className="h-4 w-4" /></Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{col.label}にアイテムを追加</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-2">
                    <div>
                      <Label>タイプ</Label>
                      <Select value={boardNewType} onValueChange={setBoardNewType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(ITEM_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>タイトル *</Label><Input value={boardNewTitle} onChange={(e) => setBoardNewTitle(e.target.value)} placeholder="タイトル" /></div>
                    <div><Label>内容</Label><Textarea value={boardNewContent} onChange={(e) => setBoardNewContent(e.target.value)} placeholder="内容（任意）" rows={3} /></div>
                    <div><Label>タグ（カンマ区切り）</Label><Input value={boardNewTags} onChange={(e) => setBoardNewTags(e.target.value)} placeholder="例: 重要, フォローアップ" /></div>
                    <Button onClick={() => handleBoardAdd(col.key)} className="w-full" disabled={!boardNewTitle.trim() || createBoardItemMut.isPending}>
                      {createBoardItemMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}追加
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="p-2 space-y-2">
              {colItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">ドラッグ＆ドロップでアイテムを移動</p>
              ) : (
                colItems.map((item: any) => {
                  const Icon = ITEM_ICONS[item.type] || StickyNote;
                  const colorClass = ITEM_COLORS[item.type] || "border-gray-300";
                  const isEditing = editingBoardItem === item.id;

                  return (
                    <div
                      key={item.id}
                      draggable={!isEditing}
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      className={`rounded-lg border ${colorClass} p-3 bg-card cursor-grab active:cursor-grabbing transition-all ${draggedItemId === item.id ? "opacity-50 scale-95" : "hover:shadow-md"}`}
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <Input value={boardEditTitle} onChange={(e) => setBoardEditTitle(e.target.value)} className="h-7 text-sm" placeholder="タイトル" />
                          <Textarea value={boardEditContent} onChange={(e) => setBoardEditContent(e.target.value)} className="text-sm min-h-[40px]" placeholder="内容" rows={2} />
                          <Input value={boardEditTags} onChange={(e) => setBoardEditTags(e.target.value)} className="h-7 text-xs" placeholder="タグ（カンマ区切り）" />
                          <div className="flex gap-1">
                            <Button size="sm" className="h-6 text-xs" onClick={() => handleBoardUpdate(item.id)} disabled={updateBoardItemMut.isPending}>
                              <Save className="h-3 w-3 mr-1" />保存
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingBoardItem(null)}>
                              <X className="h-3 w-3 mr-1" />キャンセル
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                              <Icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="text-sm font-medium truncate">{item.title}</span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingBoardItem(item.id); setBoardEditTitle(item.title); setBoardEditContent(item.content || ""); setBoardEditTags(item.tags?.join(", ") || ""); }}>
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => { if (confirm("削除しますか？")) handleBoardDelete(item.id); }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          {item.content && <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">{item.content}</p>}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[9px] h-4">{ITEM_LABELS[item.type] || item.type}</Badge>
                            {item.tags?.map((tag: string, ti: number) => (
                              <Badge key={ti} variant="secondary" className="text-[9px] h-4">{tag}</Badge>
                            ))}
                          </div>
                          {item.creatorName && (
                            <p className="text-[9px] text-muted-foreground mt-1.5">{item.creatorName}</p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component 3: WorkspaceGoalsTab                                 */
/* ------------------------------------------------------------------ */

type WorkspaceGoalsTabProps = {
  workspaceId: number;
  goals: any[];
  myRole: string;
  onRefetch: () => void;
};

function WorkspaceGoalsTab({ workspaceId, goals, myRole, onRefetch }: WorkspaceGoalsTabProps) {
  const addGoalMut = trpc.workspace.addGoal.useMutation();
  const updateGoalMut = trpc.workspace.updateGoal.useMutation();
  const deleteGoalMut = trpc.workspace.deleteGoal.useMutation();

  const [isGoalOpen, setIsGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [goalTarget, setGoalTarget] = useState(80);

  const handleAddGoal = async () => {
    if (!goalTitle.trim()) return;
    try {
      await addGoalMut.mutateAsync({ workspaceId, title: goalTitle.trim(), description: goalDesc.trim() || undefined, targetScore: goalTarget });
      setIsGoalOpen(false);
      setGoalTitle("");
      setGoalDesc("");
      onRefetch();
      toast.success("目標を追加しました");
    } catch (e: any) { toast.error(e.message || "追加に失敗しました"); }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Dialog open={isGoalOpen} onOpenChange={setIsGoalOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />目標追加</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>チーム目標を追加</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div><Label>目標</Label><Input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="例: 全員70%以上のスコアを達成" /></div>
              <div><Label>説明</Label><Input value={goalDesc} onChange={(e) => setGoalDesc(e.target.value)} placeholder="詳細（任意）" /></div>
              <div><Label>目標スコア: {goalTarget}%</Label>
                <input type="range" min={10} max={100} value={goalTarget} onChange={(e) => setGoalTarget(parseInt(e.target.value))} className="w-full" />
              </div>
              <Button onClick={handleAddGoal} className="w-full" disabled={!goalTitle.trim() || addGoalMut.isPending}>追加</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {goals.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground"><Target className="h-8 w-8 mx-auto mb-2 opacity-50" /><p>チーム目標がまだありません</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {goals.map((g: any) => (
            <Card key={g.id}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {g.status === "completed" ? <CheckCircle className="h-5 w-5 text-green-500" /> : <Target className="h-5 w-5 text-primary" />}
                    <span className="font-medium">{g.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={g.status === "completed" ? "default" : "outline"}>
                      {g.status === "completed" ? "達成" : g.status === "cancelled" ? "キャンセル" : "進行中"}
                    </Badge>
                    {myRole === "admin" && g.status === "active" && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => { await updateGoalMut.mutateAsync({ goalId: g.id, status: "completed" }); onRefetch(); }}>達成</Button>
                        <Button size="sm" variant="ghost" onClick={async () => { await deleteGoalMut.mutateAsync({ goalId: g.id }); onRefetch(); }}><Trash2 className="h-3 w-3" /></Button>
                      </>
                    )}
                  </div>
                </div>
                {g.description && <p className="text-sm text-muted-foreground mb-2">{g.description}</p>}
                {g.targetScore && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs"><span>進捗</span><span>{g.currentScore || 0}% / {g.targetScore}%</span></div>
                    <Progress value={((g.currentScore || 0) / g.targetScore) * 100} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component 4: WorkspaceMembersTab                               */
/* ------------------------------------------------------------------ */

type WorkspaceMembersTabProps = {
  workspaceId: number;
  members: any[];
  friends: any[];
  myRole: string;
  ownerId: number;
  onRefetch: () => void;
};

function WorkspaceMembersTab({ workspaceId, members, friends, myRole, ownerId, onRefetch }: WorkspaceMembersTabProps) {
  const inviteMut = trpc.workspace.inviteMember.useMutation();
  const removeMemberMut = trpc.workspace.removeMember.useMutation();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteFriendId, setInviteFriendId] = useState("");

  const nonMemberFriends = friends?.filter((f: any) => !members.some((m: any) => m.userId === f.friend.id)) || [];

  const handleInvite = async () => {
    if (!inviteFriendId) return;
    try {
      await inviteMut.mutateAsync({ workspaceId, userId: parseInt(inviteFriendId) });
      setIsInviteOpen(false);
      setInviteFriendId("");
      onRefetch();
      toast.success("メンバーを招待しました");
    } catch (e: any) { toast.error(e.message || "招待に失敗しました"); }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        {(myRole === "admin" || myRole === "editor") && (
          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild><Button size="sm"><UserPlus className="h-4 w-4 mr-1" />メンバー招待</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>メンバー招待</DialogTitle><DialogDescription>友達をワークスペースに招待します</DialogDescription></DialogHeader>
              <div className="space-y-4 mt-2">
                <Select value={inviteFriendId} onValueChange={setInviteFriendId}>
                  <SelectTrigger><SelectValue placeholder="友達を選択" /></SelectTrigger>
                  <SelectContent>
                    {nonMemberFriends.map((f: any) => (
                      <SelectItem key={f.friend.id} value={f.friend.id.toString()}>{f.friend.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleInvite} className="w-full" disabled={!inviteFriendId || inviteMut.isPending}>招待</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="space-y-2">
        {members.map((m: any) => (
          <div key={m.userId} className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              {m.avatarUrl ? (
                <img src={m.avatarUrl} className="w-8 h-8 rounded-full" alt="" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold">{m.userName?.charAt(0)}</div>
              )}
              <span className="font-medium">{m.userName}</span>
              <Badge variant="outline" className="text-xs">{m.role === "admin" ? "管理者" : m.role === "editor" ? "編集者" : "メンバー"}</Badge>
            </div>
            {myRole === "admin" && m.userId !== ownerId && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await removeMemberMut.mutateAsync({ workspaceId, userId: m.userId }); onRefetch(); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component: WorkspaceDetail                                    */
/* ------------------------------------------------------------------ */

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = parseInt(id || "0");
  usePageMeta({ title: "ワークスペース", path: `/workspaces/${id}` });

  const { data, isLoading, refetch } = trpc.workspace.get.useQuery(
    { id: workspaceId },
    { enabled: workspaceId > 0 }
  );
  const { data: friends } = trpc.friends.list.useQuery();
  const { data: sessions } = trpc.matching.sessions.useQuery();

  // Kanban board query
  const { data: boardItems, refetch: refetchBoard } = trpc.workspace.listBoardItems.useQuery(
    { workspaceId },
    { enabled: workspaceId > 0 }
  );

  // WebSocket real-time
  const onItemUpdate = useCallback(() => { refetch(); }, [refetch]);
  const onItemAdd = useCallback(() => { refetch(); }, [refetch]);
  const onItemDelete = useCallback(() => { refetch(); }, [refetch]);

  const { connected, onlineUsers, broadcastItemUpdate, broadcastItemAdd, broadcastItemDelete } = useWorkspaceRoom({
    workspaceId,
    enabled: workspaceId > 0,
    onItemUpdate,
    onItemAdd,
    onItemDelete,
  });

  if (isLoading) {
    return <DashboardLayout><div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;
  }
  if (!data) {
    return <DashboardLayout><p className="text-center text-muted-foreground py-8">ワークスペースが見つかりません</p></DashboardLayout>;
  }

  const { workspace, members, items, goals, myRole } = data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/workspaces"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{workspace.name}</h1>
            {workspace.description && <p className="text-sm text-muted-foreground">{workspace.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <Badge variant="secondary" className="gap-1"><Wifi className="h-3 w-3 text-green-500" />{onlineUsers.length}人オンライン</Badge>
            ) : (
              <Badge variant="outline" className="gap-1"><WifiOff className="h-3 w-3 text-muted-foreground" />オフライン</Badge>
            )}
          </div>
        </div>

        {/* Online users */}
        {onlineUsers.length > 0 && (
          <div className="flex items-center gap-2">
            {onlineUsers.map((u: any) => (
              <Badge key={u.userId} variant="outline" className="text-xs">{u.userName}</Badge>
            ))}
          </div>
        )}

        <Tabs defaultValue="board">
          <TabsList>
            <TabsTrigger value="board"><LayoutGrid className="h-4 w-4 mr-1" />ボード</TabsTrigger>
            <TabsTrigger value="kanban"><Columns className="h-4 w-4 mr-1" />カンバン</TabsTrigger>
            <TabsTrigger value="goals"><Target className="h-4 w-4 mr-1" />目標</TabsTrigger>
            <TabsTrigger value="members"><Users className="h-4 w-4 mr-1" />メンバー</TabsTrigger>
          </TabsList>

          <TabsContent value="board">
            <WorkspaceBoardTab
              workspaceId={workspaceId}
              items={items}
              sessions={sessions || []}
              onRefetch={refetch}
              broadcastItemAdd={broadcastItemAdd}
              broadcastItemUpdate={broadcastItemUpdate}
              broadcastItemDelete={broadcastItemDelete}
            />
          </TabsContent>

          <TabsContent value="kanban">
            <WorkspaceKanbanTab
              workspaceId={workspaceId}
              items={(boardItems as any[]) || []}
              onRefetch={refetchBoard}
            />
          </TabsContent>

          <TabsContent value="goals">
            <WorkspaceGoalsTab
              workspaceId={workspaceId}
              goals={goals}
              myRole={myRole}
              onRefetch={refetch}
            />
          </TabsContent>

          <TabsContent value="members">
            <WorkspaceMembersTab
              workspaceId={workspaceId}
              members={members}
              friends={friends || []}
              myRole={myRole}
              ownerId={workspace.ownerId}
              onRefetch={refetch}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

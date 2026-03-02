import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Users, FolderOpen, Clock, LayoutGrid, StickyNote } from "lucide-react";

export default function Workspaces() {
  usePageMeta({ title: "チームワークスペース", description: "チームでリアルタイム共同編集", path: "/workspaces" });
  const [, navigate] = useLocation();
  const { data: workspaces, isLoading, refetch } = trpc.workspace.list.useQuery();
  const createMut = trpc.workspace.create.useMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("名前を入力してください"); return; }
    try {
      const result = await createMut.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      setIsCreateOpen(false);
      setName("");
      setDescription("");
      navigate(`/workspaces/${result.id}`);
    } catch (e: any) {
      toast.error(e.message || "作成に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="チームワークスペース">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <LayoutGrid className="h-8 w-8 text-primary" />
              チームワークスペース
            </h1>
            <p className="text-muted-foreground mt-1">
              チームでマッチング分析を共同編集・目標管理
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />新規作成</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>ワークスペース作成</DialogTitle>
                <DialogDescription>チームで共同作業するワークスペースを作成します</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="ws-name">名前</Label>
                  <Input id="ws-name" placeholder="例: 新規事業チーム" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="ws-desc">説明（任意）</Label>
                  <Input id="ws-desc" placeholder="目的や概要" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <Button onClick={handleCreate} className="w-full" disabled={!name.trim() || createMut.isPending}>
                  {createMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />作成中...</> : <><Plus className="h-4 w-4 mr-2" />作成</>}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !workspaces?.length ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">ワークスペースがありません</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">チームでの共同作業を始めましょう</p>
              <Button onClick={() => setIsCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />最初のワークスペースを作成</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws: any) => (
              <Link key={ws.id} href={`/workspaces/${ws.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{ws.name}</CardTitle>
                      <Badge variant={ws.role === "admin" ? "default" : "secondary"} className="text-xs">
                        {ws.role === "admin" ? "管理者" : ws.role === "editor" ? "編集者" : "メンバー"}
                      </Badge>
                    </div>
                    {ws.description && <CardDescription>{ws.description}</CardDescription>}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{ws.memberCount}人</span>
                      <span className="flex items-center gap-1"><StickyNote className="h-3.5 w-3.5" />{ws.itemCount}件</span>
                      <span className="flex items-center gap-1 ml-auto"><Clock className="h-3.5 w-3.5" />{ws.updatedAt?.slice(5, 10)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

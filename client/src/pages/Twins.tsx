import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Bot, Plus, Loader2, MessageSquare, Settings, Trash2 } from "lucide-react";

export default function Twins() {
  const { data: twins, isLoading, refetch } = trpc.twins.list.useQuery();
  const createTwin = trpc.twins.create.useMutation();
  const deleteTwin = trpc.twins.delete.useMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTwin, setNewTwin] = useState({
    name: "",
    description: "",
    personality: "",
    systemPrompt: "",
  });

  const handleCreate = async () => {
    if (!newTwin.name.trim()) {
      toast.error("名前を入力してください");
      return;
    }

    try {
      await createTwin.mutateAsync(newTwin);
      toast.success("分身AIを作成しました");
      setIsCreateOpen(false);
      setNewTwin({ name: "", description: "", personality: "", systemPrompt: "" });
      refetch();
    } catch (error) {
      toast.error("作成に失敗しました");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`「${name}」を削除しますか？この操作は取り消せません。`)) {
      return;
    }

    try {
      await deleteTwin.mutateAsync({ id });
      toast.success("削除しました");
      refetch();
    } catch (error) {
      toast.error("削除に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">分身AI</h1>
            <p className="text-muted-foreground mt-2">
              あなたの分身AIを作成・管理します。
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新規作成
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>分身AIを作成</DialogTitle>
                <DialogDescription>
                  新しい分身AIの基本情報を入力してください。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">名前 *</Label>
                  <Input
                    id="name"
                    value={newTwin.name}
                    onChange={(e) => setNewTwin({ ...newTwin, name: e.target.value })}
                    placeholder="例: ビジネス太郎"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">説明</Label>
                  <Textarea
                    id="description"
                    value={newTwin.description}
                    onChange={(e) => setNewTwin({ ...newTwin, description: e.target.value })}
                    placeholder="この分身AIの目的や役割"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="personality">性格・特徴</Label>
                  <Textarea
                    id="personality"
                    value={newTwin.personality}
                    onChange={(e) => setNewTwin({ ...newTwin, personality: e.target.value })}
                    placeholder="例: 丁寧で論理的、ビジネスに精通している"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="systemPrompt">システムプロンプト（上級者向け）</Label>
                  <Textarea
                    id="systemPrompt"
                    value={newTwin.systemPrompt}
                    onChange={(e) => setNewTwin({ ...newTwin, systemPrompt: e.target.value })}
                    placeholder="AIへの詳細な指示（オプション）"
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    キャンセル
                  </Button>
                  <Button onClick={handleCreate} disabled={createTwin.isPending}>
                    {createTwin.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    作成
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="pt-6">
                  <div className="h-32 bg-muted rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : twins && twins.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {twins.map((twin) => (
              <Card key={twin.id} className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <Bot className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{twin.name}</CardTitle>
                        <CardDescription>
                          {twin.status === "active" ? (
                            <span className="text-green-500">アクティブ</span>
                          ) : twin.status === "training" ? (
                            <span className="text-yellow-500">学習中</span>
                          ) : (
                            <span className="text-muted-foreground">非アクティブ</span>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {twin.description || twin.personality || "説明なし"}
                  </p>
                  <div className="flex gap-2">
                    <Link href={`/twins/${twin.id}`} className="flex-1">
                      <Button variant="outline" className="w-full" size="sm">
                        <Settings className="h-4 w-4 mr-1" />
                        詳細
                      </Button>
                    </Link>
                    <Link href={`/chat?twinId=${twin.id}`} className="flex-1">
                      <Button variant="outline" className="w-full" size="sm">
                        <MessageSquare className="h-4 w-4 mr-1" />
                        チャット
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(twin.id, twin.name)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-16">
              <div className="text-center">
                <Bot className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">分身AIがありません</h3>
                <p className="text-muted-foreground mb-6">
                  最初の分身AIを作成して、あなたのデジタルツインを始めましょう。
                </p>
                <Button onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  分身AIを作成
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

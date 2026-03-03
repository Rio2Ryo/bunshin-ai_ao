import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LayoutTemplate, Plus, Download, Globe, Lock, Trash2, Loader2, Users } from "lucide-react";
import { useState } from "react";

export default function TwinGallery() {
  const [tab, setTab] = useState<"gallery" | "mine">("gallery");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const templates = trpc.myTwin.listTemplates.useQuery({ publicOnly: tab === "gallery" });
  const createMutation = trpc.myTwin.createTemplate.useMutation();
  const applyMutation = trpc.myTwin.applyTemplate.useMutation();
  const toggleMutation = trpc.myTwin.toggleTemplatePublic.useMutation();
  const deleteMutation = trpc.myTwin.deleteTemplate.useMutation();

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("テンプレート名を入力してください"); return; }
    try {
      await createMutation.mutateAsync({ name: name.trim(), description: description.trim() });
      toast.success("テンプレートを作成しました");
      setName(""); setDescription(""); setDialogOpen(false);
      templates.refetch();
    } catch (e: any) { toast.error(e.message || "作成に失敗しました"); }
  };

  const handleApply = async (templateId: number) => {
    try {
      const res = await applyMutation.mutateAsync({ templateId });
      toast.success(`テンプレート「${res.templateName}」を適用しました`);
    } catch (e: any) { toast.error(e.message || "適用に失敗しました"); }
  };

  const handleToggle = async (templateId: number) => {
    try {
      const res = await toggleMutation.mutateAsync({ templateId });
      toast.success(res.isPublic ? "公開しました" : "非公開にしました");
      templates.refetch();
    } catch (e: any) { toast.error(e.message || "切替に失敗しました"); }
  };

  const handleDelete = async (templateId: number) => {
    try {
      await deleteMutation.mutateAsync({ templateId });
      toast.success("削除しました");
      templates.refetch();
    } catch (e: any) { toast.error(e.message || "削除に失敗しました"); }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">テンプレートギャラリー</h1>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />テンプレート作成</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>現在のツインからテンプレート作成</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="テンプレート名" value={name} onChange={(e) => setName(e.target.value)} />
                <Textarea placeholder="説明（任意）" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  作成
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-2">
          <Button variant={tab === "gallery" ? "default" : "outline"} size="sm" onClick={() => setTab("gallery")}>
            <Globe className="h-4 w-4 mr-1" />公開ギャラリー
          </Button>
          <Button variant={tab === "mine" ? "default" : "outline"} size="sm" onClick={() => setTab("mine")}>
            <Lock className="h-4 w-4 mr-1" />マイテンプレート
          </Button>
        </div>

        {templates.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (templates.data || []).length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">テンプレートがありません</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(templates.data || []).map((t: any) => (
              <Card key={t.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <div className="flex items-center gap-1">
                      {t.isPublic ? <Badge variant="secondary" className="text-xs"><Globe className="h-3 w-3 mr-1" />公開</Badge> : <Badge variant="outline" className="text-xs"><Lock className="h-3 w-3 mr-1" />非公開</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {t.description && <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span><Users className="h-3 w-3 inline mr-1" />{t.authorName || '不明'}</span>
                    <span>使用: {t.useCount}回</span>
                  </div>
                  {t.tags && (
                    <div className="flex flex-wrap gap-1">
                      {(t.tags || '').split(',').filter(Boolean).slice(0, 4).map((tag: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{tag.trim()}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="default" onClick={() => handleApply(t.id)} disabled={applyMutation.isPending}>
                      <Download className="h-3 w-3 mr-1" />適用
                    </Button>
                    {t.userId === undefined || tab === "mine" ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handleToggle(t.id)}>
                          {t.isPublic ? "非公開に" : "公開する"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

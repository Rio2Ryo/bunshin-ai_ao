import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { Bot, Save, Loader2, Upload, FileText, Trash2, ArrowLeft, MessageSquare, Plus } from "lucide-react";

export default function TwinDetail() {
  const [, navigate] = useLocation();
  const { data: twin, isLoading, refetch } = trpc.myTwin.get.useQuery();
  const { data: knowledge, refetch: refetchKnowledge } = trpc.knowledge.list.useQuery();
  const { data: files } = trpc.files.list.useQuery();

  const updateTwin = trpc.myTwin.update.useMutation();
  const uploadFile = trpc.files.upload.useMutation();
  const processFile = trpc.files.process.useMutation();
  const addKnowledge = trpc.knowledge.add.useMutation();
  const deleteKnowledge = trpc.knowledge.delete.useMutation();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [manualKnowledge, setManualKnowledge] = useState({
    title: "",
    content: "",
  });

  const handleSave = async () => {
    try {
      await updateTwin.mutateAsync({ 
        name: name || undefined, 
        rawInput: rawInput || undefined 
      });
      toast.success("保存しました");
      refetch();
    } catch (error) {
      toast.error("保存に失敗しました");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const result = await uploadFile.mutateAsync({
          filename: file.name,
          content: base64,
          mimeType: file.type,
        });

        toast.success("ファイルをアップロードしました。処理中...");

        await processFile.mutateAsync({
          fileId: result.id,
        });

        toast.success("ファイルを処理しました");
        refetchKnowledge();
      } catch (error) {
        toast.error("アップロードに失敗しました");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddManualKnowledge = async () => {
    if (!manualKnowledge.content.trim()) {
      toast.error("内容を入力してください");
      return;
    }

    try {
      await addKnowledge.mutateAsync({
        sourceType: "manual",
        title: manualKnowledge.title || "手動追加",
        content: manualKnowledge.content,
        summary: manualKnowledge.content.substring(0, 200),
      });
      toast.success("知識を追加しました");
      setManualKnowledge({ title: "", content: "" });
      refetchKnowledge();
    } catch (error) {
      toast.error("追加に失敗しました");
    }
  };

  const handleDeleteKnowledge = async (knowledgeId: number) => {
    if (!confirm("この知識を削除しますか？")) return;

    try {
      await deleteKnowledge.mutateAsync({ id: knowledgeId });
      toast.success("削除しました");
      refetchKnowledge();
    } catch (error) {
      toast.error("削除に失敗しました");
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!twin) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <Bot className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">分身AIがありません</p>
          <Button onClick={() => navigate("/twins")}>分身AIを作成</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/twins">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{twin.name}</h1>
              <p className="text-muted-foreground">分身AIの設定と知識ベース</p>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Link href="/chat">
              <Button variant="outline">
                <MessageSquare className="h-4 w-4 mr-2" />
                チャット
              </Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">設定</TabsTrigger>
            <TabsTrigger value="knowledge">知識ベース ({knowledge?.length || 0})</TabsTrigger>
            <TabsTrigger value="upload">アップロード</TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>基本設定</CardTitle>
                <CardDescription>分身AIの情報を編集します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">名前</Label>
                  <Input
                    id="name"
                    value={name || twin.name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={twin.name}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rawInput">情報（自由入力）</Label>
                  <Textarea
                    id="rawInput"
                    value={rawInput || twin.rawInput || ""}
                    onChange={(e) => setRawInput(e.target.value)}
                    rows={6}
                    placeholder="スキル、経歴、趣味など...なんでも書いてOK"
                  />
                  <p className="text-sm text-muted-foreground">
                    AIが自動で整理してプロフィールを作成します
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={updateTwin.isPending}>
                    {updateTwin.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <Save className="h-4 w-4 mr-2" />
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>

            {twin.description && (
              <Card>
                <CardHeader>
                  <CardTitle>AIが整理した情報</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-muted-foreground">紹介</Label>
                    <p className="mt-1">{twin.description}</p>
                  </div>
                  {twin.personality && (
                    <div>
                      <Label className="text-muted-foreground">特徴・スキル</Label>
                      <p className="mt-1 whitespace-pre-wrap">{twin.personality}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Knowledge Tab */}
          <TabsContent value="knowledge" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>手動で知識を追加</CardTitle>
                <CardDescription>テキストで直接知識を追加します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="knowledgeTitle">タイトル</Label>
                  <Input
                    id="knowledgeTitle"
                    value={manualKnowledge.title}
                    onChange={(e) => setManualKnowledge({ ...manualKnowledge, title: e.target.value })}
                    placeholder="知識のタイトル（オプション）"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="knowledgeContent">内容</Label>
                  <Textarea
                    id="knowledgeContent"
                    value={manualKnowledge.content}
                    onChange={(e) => setManualKnowledge({ ...manualKnowledge, content: e.target.value })}
                    rows={4}
                    placeholder="詳細な内容"
                  />
                </div>
                <Button onClick={handleAddManualKnowledge} disabled={addKnowledge.isPending}>
                  {addKnowledge.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Plus className="h-4 w-4 mr-2" />
                  追加
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>知識ベース一覧</CardTitle>
                <CardDescription>この分身AIが学習した知識</CardDescription>
              </CardHeader>
              <CardContent>
                {knowledge && knowledge.length > 0 ? (
                  <div className="space-y-3">
                    {knowledge.map((k) => (
                      <div key={k.id} className="p-4 rounded-lg bg-muted/50 border border-border/50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <FileText className="h-4 w-4 text-primary" />
                              <span className="font-medium">{k.title || "無題"}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                                {k.sourceType === "upload" ? "アップロード" :
                                 k.sourceType === "api" ? "API" : "手動"}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {k.summary || k.content?.substring(0, 200)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteKnowledge(k.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">知識ベースが空です</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>ファイルアップロード</CardTitle>
                <CardDescription>
                  テキストファイルやPDFをアップロードして知識ベースに追加します
                </CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">ファイルをアップロード</p>
                  <p className="text-sm text-muted-foreground">
                    .txt, .pdf, .md ファイルに対応
                  </p>
                  {(uploadFile.isPending || processFile.isPending) && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">処理中...</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

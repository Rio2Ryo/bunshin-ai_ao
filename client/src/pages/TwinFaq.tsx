import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Loader2, HelpCircle, Sparkles, Trash2, ArrowLeft, Eye, EyeOff, Globe } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function TwinFaq() {
  usePageMeta({ title: "FAQ自動生成", description: "ツインのFAQをAIで自動生成・公開管理", path: "/twin-faq" });

  const { data: faqs, isLoading, refetch } = trpc.myTwin.getFaqs.useQuery();
  const generateMut = trpc.myTwin.generateFaq.useMutation();
  const toggleMut = trpc.myTwin.toggleFaqPublic.useMutation();
  const deleteMut = trpc.myTwin.deleteFaq.useMutation();

  const handleGenerate = async () => {
    try {
      const result = await generateMut.mutateAsync();
      toast.success(`FAQ ${result.count}件を生成しました`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "FAQ生成に失敗しました");
    }
  };

  const handleToggle = async (faqId: number, isPublic: boolean) => {
    try {
      await toggleMut.mutateAsync({ faqId, isPublic });
      refetch();
    } catch (e: any) {
      toast.error(e.message || "更新に失敗しました");
    }
  };

  const handleDelete = async (faqId: number) => {
    try {
      await deleteMut.mutateAsync({ faqId });
      toast.success("FAQを削除しました");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "削除に失敗しました");
    }
  };

  const publicCount = (faqs ?? []).filter((f: any) => f.isPublic).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/twins">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HelpCircle className="h-6 w-6 text-primary" />
              FAQ自動生成
            </h1>
            <p className="text-muted-foreground">ナレッジ+対話パターンからFAQをAI生成</p>
          </div>
          <Button onClick={handleGenerate} disabled={generateMut.isPending}>
            {generateMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            FAQ生成
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{faqs?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">総FAQ数</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{publicCount}</p>
              <p className="text-xs text-muted-foreground">公開中</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{(faqs?.length ?? 0) - publicCount}</p>
              <p className="text-xs text-muted-foreground">非公開</p>
            </CardContent>
          </Card>
        </div>

        {/* Info */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Globe className="h-5 w-5 text-primary mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">公開FAQは /users/:id プロフィールに表示されます</p>
              <p className="text-muted-foreground">公開トグルで表示/非表示を切り替えられます</p>
            </div>
          </CardContent>
        </Card>

        {/* FAQ List */}
        <Card>
          <CardHeader>
            <CardTitle>FAQ一覧</CardTitle>
            <CardDescription>生成されたFAQ（{faqs?.length ?? 0}件）</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : !faqs?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>FAQがまだありません</p>
                <p className="text-sm mt-1">「FAQ生成」ボタンでAIが自動生成します</p>
              </div>
            ) : (
              <div className="space-y-4">
                {faqs.map((faq: any, i: number) => (
                  <div key={faq.id} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">Q{i + 1}</Badge>
                          {faq.isPublic ? (
                            <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/30"><Eye className="h-3 w-3 mr-1" />公開</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs"><EyeOff className="h-3 w-3 mr-1" />非公開</Badge>
                          )}
                        </div>
                        <p className="font-medium text-sm">{faq.question}</p>
                        <p className="text-sm text-muted-foreground mt-1">{faq.answer}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!faq.isPublic}
                          onCheckedChange={(checked) => handleToggle(faq.id, checked)}
                          disabled={toggleMut.isPending}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(faq.id)}
                          disabled={deleteMut.isPending}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Code, Copy, ExternalLink, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/trpc";

export default function TwinEmbedCard() {
  const { data, isLoading } = trpc.myTwin.getEmbedCardData.useQuery({});

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="container mx-auto p-4 max-w-3xl">
          <Card><CardContent className="py-8 text-center text-muted-foreground">ツインが見つかりません。まずツインを作成してください。</CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  const embedUrl = `${API_BASE}/api/embed/${data.twinId}`;
  const iframeCode = `<iframe src="${embedUrl}" width="380" height="280" frameborder="0" style="border-radius:12px;overflow:hidden"></iframe>`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}をコピーしました`);
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 max-w-3xl space-y-6">
        <div className="flex items-center gap-2">
          <Code className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">埋め込みカード</h1>
        </div>

        {/* Preview */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">プレビュー</CardTitle></CardHeader>
          <CardContent>
            <div className="border rounded-xl p-5 max-w-[380px] bg-white dark:bg-zinc-950">
              <div className="flex items-center gap-3 mb-3">
                {data.avatarUrl ? (
                  <img src={data.avatarUrl} className="w-12 h-12 rounded-full object-cover" alt="アバター" loading="lazy" decoding="async" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-muted" />
                )}
                <div>
                  <p className="font-semibold text-sm">{data.userName}</p>
                  {data.company && <p className="text-xs text-muted-foreground">{data.company}</p>}
                </div>
              </div>
              {data.description && <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{data.description}</p>}
              {data.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {data.tags.map((tag: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mb-3">FAQ: {data.faqCount}件 | マッチング: {data.matchCount}件</p>
              <div className="bg-primary text-primary-foreground text-center py-2 rounded-lg text-sm font-medium">
                プロフィールを見る
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Embed code */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">iframeコード</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Input readOnly value={iframeCode} className="pr-10 text-xs font-mono" />
              <Button size="sm" variant="ghost" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => copyToClipboard(iframeCode, "iframeコード")}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">このコードを外部サイトのHTMLに貼り付けてください</p>
          </CardContent>
        </Card>

        {/* Direct URL */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">直接リンク</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Input readOnly value={embedUrl} className="pr-10 text-xs font-mono" />
              <Button size="sm" variant="ghost" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => copyToClipboard(embedUrl, "URL")}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => window.open(embedUrl, '_blank')}>
              <ExternalLink className="h-4 w-4 mr-1" />プレビューを開く
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Bot, Globe, Loader2 } from "lucide-react";
import { Link, useRoute } from "wouter";

export default function TwinDetail() {
  const [, params] = useRoute("/twins/:id");
  const twinId = Number(params?.id);

  const { data: twin, isLoading } = trpc.myTwin.getPublicTwin.useQuery(
    { twinId },
    { enabled: Number.isFinite(twinId) }
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

  if (!Number.isFinite(twinId)) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">不正なURLです</p>
          <Link href="/twins">
            <Button className="mt-4">戻る</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  if (!twin) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <Bot className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">
            この分身AIは見つかりません（非公開の可能性があります）
          </p>
          <Link href="/twins">
            <Button>戻る</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
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
              <p className="text-muted-foreground">公開プロフィール</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              公開情報
            </CardTitle>
            <CardDescription>
              公開設定がONの分身AIのみ表示されます
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {twin.publicBio ? (
              <div>
                <p className="text-sm text-muted-foreground mb-1">自己紹介</p>
                <p className="whitespace-pre-wrap">{twin.publicBio}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                公開プロフィールは未設定です。
              </p>
            )}

            {twin.tags && twin.tags.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">タグ</p>
                <div className="flex flex-wrap gap-2">
                  {twin.tags.map((t: string, i: number) => (
                    <Badge key={`${t}-${i}`} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

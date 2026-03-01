import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Bot, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export function TwinStatusWidget() {
  const { data: myTwin } = trpc.myTwin.get.useQuery(undefined, { staleTime: 30_000 });

  if (!myTwin) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 flex items-center justify-center h-full">
          <div className="text-center">
            <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">分身AIが未作成です</p>
            <Link href="/twins">
              <Button size="sm">作成する</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">{myTwin.name}</p>
              <p className="text-xs text-muted-foreground">
                {myTwin.isPublic ? "公開中" : "非公開"} · {myTwin.description ? myTwin.description.slice(0, 30) + (myTwin.description.length > 30 ? "..." : "") : "プロフィール未設定"}
              </p>
            </div>
          </div>
          <Link href="/twins">
            <Button variant="ghost" size="sm">
              管理
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Globe, Zap } from "lucide-react";
import { Link } from "wouter";

export function QuickActionsWidget() {
  const actions = [
    { icon: MessageSquare, label: "チャット", href: "/chat", description: "分身AIと会話" },
    { icon: Users, label: "マッチング", href: "/matching", description: "新しいマッチング" },
    { icon: Globe, label: "発見", href: "/discover", description: "ユーザーを探す" },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          クイックアクション
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-2">
          {actions.map(({ icon: Icon, label, href, description }) => (
            <Link key={href} href={href}>
              <Button variant="outline" className="w-full justify-start gap-3 h-auto py-2.5">
                <Icon className="h-4 w-4 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </Button>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

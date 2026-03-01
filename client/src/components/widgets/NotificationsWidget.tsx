import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Bell } from "lucide-react";

export function NotificationsWidget() {
  const { data: notifData } = trpc.notification.list.useQuery({ unreadOnly: false, limit: 5 }, { staleTime: 30_000 });
  const notifications = notifData?.notifications ?? [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" />
          通知
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">通知はありません</p>
        ) : (
          <div className="space-y-2">
            {notifications.map((n: any) => (
              <div key={n.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-xs font-medium">{n.title}</p>
                  {n.message && <p className="text-[11px] text-muted-foreground line-clamp-1">{n.message}</p>}
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

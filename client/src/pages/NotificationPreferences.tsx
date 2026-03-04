import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Bell, Loader2, BellRing, BellOff, Clock, CalendarDays, Zap } from "lucide-react";

const FREQUENCY_OPTIONS = [
  { value: "immediate", label: "即時", icon: Zap, description: "発生時にすぐ通知" },
  { value: "daily", label: "1日1回", icon: Clock, description: "毎日まとめて通知" },
  { value: "weekly", label: "週1回", icon: CalendarDays, description: "週次ダイジェスト" },
] as const;

interface NotificationPref {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  frequency: string;
}

const TYPE_ICONS: Record<string, string> = {
  matching_complete: "🎯",
  matching_invite: "📨",
  matching_request: "🤝",
  matching_accepted: "✅",
  matching_summary: "📊",
  friend_request: "👋",
  friend_accepted: "🎉",
  quality_alert: "⚠️",
  weekly_review: "📋",
  twin_forked: "🔀",
  fork_feedback: "💬",
};

export default function NotificationPreferences() {
  usePageMeta({ title: "通知プリファレンス", description: "通知タイプ別の詳細設定", path: "/notification-preferences" });

  const { data: prefs, isLoading, refetch } = trpc.notification.getPreferences.useQuery();
  const updateMut = trpc.notification.updatePreference.useMutation({
    onSuccess: () => refetch(),
  });

  const handleToggle = (type: string, enabled: boolean) => {
    updateMut.mutate({ notificationType: type, enabled });
    toast.success(enabled ? "通知を有効にしました" : "通知をオフにしました");
  };

  const handleFrequency = (type: string, frequency: "immediate" | "daily" | "weekly") => {
    updateMut.mutate({ notificationType: type, frequency });
    toast.success("頻度を更新しました");
  };

  const enabledCount = prefs?.filter((p: NotificationPref) => p.enabled).length ?? 0;
  const totalCount = prefs?.length ?? 0;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BellRing className="h-6 w-6 text-primary" />
              通知プリファレンス
            </h1>
            <p className="text-muted-foreground mt-1">通知タイプ別にON/OFFと頻度を設定</p>
          </div>
          <Badge variant="outline" className="text-sm">
            {enabledCount}/{totalCount} 有効
          </Badge>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          {FREQUENCY_OPTIONS.map(f => {
            const count = prefs?.filter((p: NotificationPref) => p.enabled && p.frequency === f.value).length ?? 0;
            const Icon = f.icon;
            return (
              <Card key={f.value} className="text-center">
                <CardContent className="pt-4 pb-3">
                  <Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Preferences List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5" />
              通知タイプ別設定
            </CardTitle>
            <CardDescription>各タイプの通知ON/OFFと配信頻度を個別に設定できます</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="divide-y">
                {prefs?.map((pref: NotificationPref) => (
                  <div key={pref.key} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                    <span className="text-2xl shrink-0">{TYPE_ICONS[pref.key] || "🔔"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{pref.label}</p>
                        {!pref.enabled && (
                          <Badge variant="secondary" className="text-xs">
                            <BellOff className="h-3 w-3 mr-1" />
                            オフ
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{pref.description}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Select
                        value={pref.frequency}
                        onValueChange={(v) => handleFrequency(pref.key, v as "immediate" | "daily" | "weekly")}
                        disabled={!pref.enabled}
                      >
                        <SelectTrigger className="w-[110px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FREQUENCY_OPTIONS.map(f => (
                            <SelectItem key={f.value} value={f.value} className="text-xs">
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Switch
                        checked={pref.enabled}
                        onCheckedChange={(v) => handleToggle(pref.key, v)}
                      />
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

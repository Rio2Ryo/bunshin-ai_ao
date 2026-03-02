import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Loader2, Trash2, Bell, Clock } from "lucide-react";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "bg-muted";
  if (score >= 80) return "bg-green-100 dark:bg-green-900/30";
  if (score >= 60) return "bg-yellow-100 dark:bg-yellow-900/30";
  return "bg-red-100 dark:bg-red-900/30";
}

export default function MatchingCalendar() {
  usePageMeta({ title: "マッチングカレンダー", description: "マッチング履歴をカレンダー形式で表示", path: "/calendar" });

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);

  const [eventForm, setEventForm] = useState({ title: "", scheduledAt: "", theme: "", notes: "", friendId: "" });
  const [reminderForm, setReminderForm] = useState({ eventId: "", reminderAt: "", channel: "app" });

  // Week view state
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return d;
  });

  const { data: calendarData, isLoading, refetch } = trpc.matching.getCalendarEvents.useQuery({ year, month });
  const { data: reminders, refetch: refetchReminders } = trpc.matching.listReminders.useQuery();

  const createEventMut = trpc.matching.createCalendarEvent.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("予定を追加しました");
      setEventDialogOpen(false);
      setEventForm({ title: "", scheduledAt: "", theme: "", notes: "", friendId: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteEventMut = trpc.matching.deleteCalendarEvent.useMutation({
    onSuccess: () => { refetch(); toast.success("予定を削除しました"); },
    onError: (e) => toast.error(e.message),
  });

  const setReminderMut = trpc.matching.setReminder.useMutation({
    onSuccess: () => {
      refetchReminders();
      toast.success("リマインダーを設定しました");
      setReminderDialogOpen(false);
      setReminderForm({ eventId: "", reminderAt: "", channel: "app" });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteReminderMut = trpc.matching.deleteReminder.useMutation({
    onSuccess: () => { refetchReminders(); toast.success("リマインダーを削除しました"); },
    onError: (e) => toast.error(e.message),
  });

  const matchings = (calendarData?.matchings ?? []) as any[];
  const scheduled = (calendarData?.scheduled ?? []) as any[];

  // Group data by day
  const dayData = useMemo(() => {
    const map: Record<number, { matchings: any[]; scheduled: any[]; maxScore: number | null }> = {};
    for (const m of matchings) {
      const day = new Date(m.createdAt).getDate();
      if (!map[day]) map[day] = { matchings: [], scheduled: [], maxScore: null };
      map[day].matchings.push(m);
      if (m.compatibilityScore != null) {
        map[day].maxScore = Math.max(map[day].maxScore ?? 0, m.compatibilityScore);
      }
    }
    for (const s of scheduled) {
      const day = new Date(s.scheduledAt).getDate();
      if (!map[day]) map[day] = { matchings: [], scheduled: [], maxScore: null };
      map[day].scheduled.push(s);
    }
    return map;
  }, [matchings, scheduled]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
    setSelectedDay(null);
  };

  // Week navigation
  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const selectedDayData = selectedDay ? dayData[selectedDay] : null;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarDays className="h-6 w-6" /> マッチングカレンダー
            </h1>
            <p className="text-muted-foreground text-sm mt-1">マッチング履歴をカレンダー形式で表示</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={viewMode === "month" ? "default" : "outline"} size="sm" onClick={() => setViewMode("month")}>
              月
            </Button>
            <Button variant={viewMode === "week" ? "default" : "outline"} size="sm" onClick={() => setViewMode("week")}>
              週
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* ===== Month View ===== */}
        {!isLoading && viewMode === "month" && (
          <div className="space-y-4">
            {/* Month Navigation */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={prevMonth}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h2 className="text-lg font-semibold">{year}年{month}月</h2>
              <Button variant="ghost" size="icon" onClick={nextMonth}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {/* Weekday headers */}
              {WEEKDAYS.map((wd, i) => (
                <div key={wd} className={`text-center text-xs font-medium py-2 bg-muted ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : ""}`}>
                  {wd}
                </div>
              ))}
              {/* Empty cells before first day */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-background min-h-[80px]" />
              ))}
              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dd = dayData[day];
                const isToday = year === now.getFullYear() && month === now.getMonth() + 1 && day === now.getDate();
                const isSelected = selectedDay === day;
                const dayOfWeek = (firstDay + i) % 7;
                return (
                  <div
                    key={day}
                    className={`min-h-[80px] p-1 cursor-pointer transition-colors border ${
                      isSelected ? "ring-2 ring-primary" : ""
                    } ${dd ? scoreColor(dd.maxScore) : "bg-background"}`}
                    onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${
                        isToday ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center" : 
                        dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : ""
                      }`}>
                        {day}
                      </span>
                      <div className="flex gap-0.5">
                        {dd && dd.matchings.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{dd.matchings.length}</Badge>
                        )}
                        {dd && dd.scheduled.length > 0 && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Color Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted inline-block" /> データなし</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 inline-block" /> 低スコア</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 inline-block" /> 中スコア</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 inline-block" /> 高スコア</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> 予定あり</span>
            </div>
          </div>
        )}

        {/* ===== Week View ===== */}
        {!isLoading && viewMode === "week" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={prevWeek}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h2 className="text-lg font-semibold">
                {weekDays[0].toLocaleDateString("ja-JP", { month: "short", day: "numeric" })} - {weekDays[6].toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
              </h2>
              <Button variant="ghost" size="icon" onClick={nextWeek}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((wd, i) => {
                const day = wd.getDate();
                const isCurrentMonth = wd.getMonth() + 1 === month && wd.getFullYear() === year;
                const dd = isCurrentMonth ? dayData[day] : null;
                const isToday = wd.toDateString() === now.toDateString();
                return (
                  <Card
                    key={i}
                    className={`min-h-[200px] ${isToday ? "ring-2 ring-primary" : ""} ${dd ? scoreColor(dd.maxScore) : ""}`}
                    onClick={() => {
                      if (isCurrentMonth) {
                        setSelectedDay(day);
                      }
                    }}
                  >
                    <CardContent className="p-2 space-y-1">
                      <div className={`text-center text-xs font-medium ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : ""}`}>
                        {WEEKDAYS[i]}
                      </div>
                      <div className={`text-center text-lg font-bold ${isToday ? "text-primary" : ""}`}>
                        {day}
                      </div>
                      {dd && dd.matchings.map((m: any, j: number) => (
                        <div key={j} className="text-[10px] bg-background/80 rounded px-1 py-0.5 truncate">
                          {m.theme || `#${m.id}`}{" "}
                          {m.compatibilityScore != null && <span className="text-muted-foreground">({m.compatibilityScore})</span>}
                        </div>
                      ))}
                      {dd && dd.scheduled.map((s: any, j: number) => (
                        <div key={`s-${j}`} className="text-[10px] bg-blue-50 dark:bg-blue-900/30 rounded px-1 py-0.5 truncate flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                          {s.title}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== Day Detail Panel ===== */}
        {selectedDay != null && (
          <Card>
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">{year}年{month}月{selectedDay}日の詳細</CardTitle>
              <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="h-4 w-4 mr-1" /> 予定追加</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>予定を追加</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>タイトル</Label>
                      <Input value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} placeholder="予定のタイトル" />
                    </div>
                    <div>
                      <Label>日時</Label>
                      <Input
                        type="datetime-local"
                        value={eventForm.scheduledAt}
                        onChange={(e) => setEventForm({ ...eventForm, scheduledAt: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>テーマ（任意）</Label>
                      <Input value={eventForm.theme} onChange={(e) => setEventForm({ ...eventForm, theme: e.target.value })} placeholder="マッチングテーマ" />
                    </div>
                    <div>
                      <Label>メモ（任意）</Label>
                      <Textarea value={eventForm.notes} onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })} placeholder="メモ" />
                    </div>
                    <div>
                      <Label>友達ID（任意）</Label>
                      <Input
                        type="number"
                        value={eventForm.friendId}
                        onChange={(e) => setEventForm({ ...eventForm, friendId: e.target.value })}
                        placeholder="友達のユーザーID"
                      />
                    </div>
                    <Button
                      className="w-full"
                      disabled={!eventForm.title || !eventForm.scheduledAt || createEventMut.isPending}
                      onClick={() => createEventMut.mutate({
                        title: eventForm.title,
                        scheduledAt: eventForm.scheduledAt,
                        theme: eventForm.theme || undefined,
                        notes: eventForm.notes || undefined,
                        friendId: eventForm.friendId ? Number(eventForm.friendId) : undefined,
                      })}
                    >
                      {createEventMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                      追加
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedDayData && (
                <p className="text-sm text-muted-foreground text-center py-4">この日のデータはありません。</p>
              )}
              {selectedDayData?.matchings.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{m.theme || `マッチング #${m.id}`}</p>
                    <p className="text-xs text-muted-foreground">
                      スコア: {m.compatibilityScore ?? "---"} / ステータス: {m.status}
                    </p>
                  </div>
                </div>
              ))}
              {selectedDayData?.scheduled.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-900/20">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                      {s.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.scheduledAt ? new Date(s.scheduledAt).toLocaleString("ja-JP") : ""}
                      {s.notes && ` - ${s.notes}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteEventMut.mutate({ eventId: s.id })}
                    disabled={deleteEventMut.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ===== Reminders Section ===== */}
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-5 w-5" /> リマインダー
            </CardTitle>
            <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> リマインダー追加</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>リマインダーを設定</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>予定イベントID</Label>
                    <Input
                      type="number"
                      value={reminderForm.eventId}
                      onChange={(e) => setReminderForm({ ...reminderForm, eventId: e.target.value })}
                      placeholder="イベントID"
                    />
                  </div>
                  <div>
                    <Label>リマインド日時</Label>
                    <Input
                      type="datetime-local"
                      value={reminderForm.reminderAt}
                      onChange={(e) => setReminderForm({ ...reminderForm, reminderAt: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>チャネル</Label>
                    <Select value={reminderForm.channel} onValueChange={(v) => setReminderForm({ ...reminderForm, channel: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="app">アプリ内</SelectItem>
                        <SelectItem value="email">メール</SelectItem>
                        <SelectItem value="line">LINE</SelectItem>
                        <SelectItem value="slack">Slack</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!reminderForm.eventId || !reminderForm.reminderAt || setReminderMut.isPending}
                    onClick={() => setReminderMut.mutate({
                      eventId: Number(reminderForm.eventId),
                      reminderAt: reminderForm.reminderAt,
                      channel: reminderForm.channel as "app" | "email" | "line" | "slack",
                    })}
                  >
                    {setReminderMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bell className="h-4 w-4 mr-2" />}
                    設定
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {(!reminders || (reminders as any[]).length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">アクティブなリマインダーはありません。</p>
            ) : (
              <div className="space-y-2">
                {(reminders as any[]).map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        {r.eventTitle || `イベント #${r.eventId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.reminderAt ? new Date(r.reminderAt).toLocaleString("ja-JP") : "---"} / {r.channel}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteReminderMut.mutate({ reminderId: r.id })}
                      disabled={deleteReminderMut.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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

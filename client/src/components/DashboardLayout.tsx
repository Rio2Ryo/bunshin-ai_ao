import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { useWebPush } from "@/hooks/useWebPush";
import { toast } from "sonner";
import { LayoutDashboard, LogOut, PanelLeft, Users, Bot, MessageSquare, Settings2, Zap, User, UserPlus, Crown, Globe, Link2, Cpu, Brain, MessageCircle, Sparkles, CreditCard, Shield, Heart, MoreHorizontal, BarChart3, BookOpen, Languages, Loader2, Lightbulb, ShieldAlert, Store, Bell, BellRing, Activity, X, CalendarClock, LayoutGrid, FlaskConical, Target, Swords, Rss, TreePine, GitBranch, Trophy, Map, ClipboardList, Award, Network, FileText, Database, GitCompare, FileCheck, History, Mic, TrendingUp, MessageCircleHeart, CalendarDays, FlaskRound, Star, Gauge, Scale, BookHeart, Calendar, Captions, Goal, Grid3x3, BookText, HelpCircle, MessageSquarePlus, TestTubes, Tags, CalendarRange, Wand2, PenLine, Library, Gamepad2, FileBarChart, ScrollText, Repeat2, ArrowLeftRight, GraduationCap, Waves, Plug, Binoculars, BookMarked, Drama, MapPin, Handshake, SlidersHorizontal, GitFork, Eye, Sun, Bookmark, ListTodo, LayoutTemplate, Flame, FolderArchive, Code2, HeartPulse, Search, AlertTriangle, ChevronRight, Crosshair, Smile, Flag, Hash, Diff, Landmark, ShieldCheck, Compass, Waypoints } from "lucide-react";
import { CSSProperties, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { CommandPalette } from "@/components/CommandPalette";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type MenuItem = { icon: React.ElementType; label: string; path: string };
type SubGroup = { label: string; items: MenuItem[] };
type MenuGroup = { label: string; items?: MenuItem[]; subGroups?: SubGroup[] };

// 管理者専用メニュー (includes items hidden from regular users)
const adminMenuItems: MenuItem[] = [
  { icon: ShieldAlert, label: "審査", path: "/admin/review" },
  { icon: BarChart3, label: "分析", path: "/admin/analytics" },
  { icon: Activity, label: "ヘルスチェック", path: "/health-dashboard" },
  { icon: Cpu, label: "AIプロバイダー", path: "/admin/ai-provider" },
  { icon: Settings2, label: "AI API設定", path: "/ai-config" },
  { icon: Zap, label: "オーケストレーション", path: "/orchestration" },
  { icon: Link2, label: "Clawdbot連携", path: "/clawdbot" },
  { icon: Brain, label: "学習した人格", path: "/learned-personality" },
  { icon: BookOpen, label: "API Docs", path: "/api-docs" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return <DashboardLayoutSkeleton />
  }

  // Check TOS acceptance - show TOS gate if not accepted
  const TosGate = () => {
    const [tosAccepted, setTosAccepted] = useState(() => !!(user as any)?.tosAcceptedAt);
    const acceptTosMutation = trpc.auth.acceptTos.useMutation({
      onSuccess: () => setTosAccepted(true),
    });

    if (tosAccepted) return null;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-lg">利用規約の同意が必要です</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              サービスを利用するには、利用規約に同意していただく必要があります。
            </p>
            <div className="flex gap-2">
              <Link href="/terms">
                <Button variant="outline" size="sm">利用規約を読む</Button>
              </Link>
            </div>
            <Button
              className="w-full"
              onClick={() => acceptTosMutation.mutate()}
              disabled={acceptTosMutation.isPending}
            >
              {acceptTosMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              利用規約に同意する
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  if (!(user as any)?.tosAcceptedAt) {
    return <TosGate />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { data: trustData } = trpc.trust.getScore.useQuery(undefined, { staleTime: 60_000 });
  const { data: receivedRequests } = trpc.matching.receivedRequests.useQuery(undefined, { staleTime: 15_000 });
  const pendingRequestCount = receivedRequests?.length ?? 0;
  const { t, language, setLanguage } = useTranslation();
  const utils = trpc.useUtils();
  const { data: notifData } = trpc.notification.list.useQuery({ unreadOnly: true, limit: 10 }, { refetchInterval: 60_000, staleTime: 60_000 });
  const markAllReadMut = trpc.notification.markAllRead.useMutation({ onSuccess: () => utils.notification.list.invalidate() });
  const markReadMut = trpc.notification.markRead.useMutation({ onSuccess: () => utils.notification.list.invalidate() });
  const deleteNotifMut = trpc.notification.delete.useMutation({ onSuccess: () => utils.notification.list.invalidate() });
  const { data: dunningStatus } = trpc.plan.getDunningStatus.useQuery(undefined, { staleTime: 120_000 });
  const unreadCount = notifData?.unreadCount ?? 0;

  // Command palette (Cmd+K / Ctrl+K)
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const [openSubGroups, setOpenSubGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("sidebar-open-subgroups");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    localStorage.setItem("sidebar-open-subgroups", JSON.stringify(openSubGroups));
  }, [openSubGroups]);
  const toggleSubGroup = useCallback((key: string) => {
    setOpenSubGroups(prev => ({ ...prev, [key]: prev[key] === false }));
  }, []);

  // Real-time notifications via SSE
  const webPush = useWebPush();

  useRealtimeNotifications({
    enabled: !!user,
    onNotification: (notif) => {
      // Refresh the notification list so bell dropdown updates
      utils.notification.list.invalidate();
      // Show toast
      toast(notif.title, { description: notif.message });
      // Browser notification if permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notif.title, { body: notif.message || undefined });
      }
    },
  });

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const translatedMenuGroups: MenuGroup[] = useMemo(() => [
    {
      label: language === "en" ? "Main" : "メイン",
      items: [
        { icon: LayoutDashboard, label: t("nav.dashboard"), path: "/dashboard" },
        { icon: User, label: t("nav.profile"), path: "/profile" },
        { icon: Shield, label: t("nav.trust"), path: "/trust" },
        { icon: Bot, label: t("nav.twins"), path: "/twins" },
        { icon: MessageSquare, label: t("nav.chat"), path: "/chat" },
        { icon: BarChart3, label: t("nav.analytics"), path: "/analytics" },
        { icon: Rss, label: language === "en" ? "Feed" : "フィード", path: "/feed" },
        { icon: BellRing, label: "通知管理", path: "/notifications" },
        { icon: SlidersHorizontal, label: "通知プリファレンス", path: "/notification-preferences" },
      ],
    },
    {
      label: language === "en" ? "Connect" : "つながる",
      subGroups: [
        {
          label: language === "en" ? "Matching" : "マッチング系",
          items: [
            { icon: Users, label: t("nav.matching"), path: "/matching" },
            { icon: Crosshair, label: "インサイト", path: "/matching/insights" },
            { icon: Swords, label: language === "en" ? "Negotiation" : "ネゴ練習", path: "/negotiation" },
            { icon: Scale, label: language === "en" ? "Debate" : "ディベート", path: "/debate" },
            { icon: MessageSquarePlus, label: language === "en" ? "Facilitator" : "AIファシリ", path: "/facilitator" },
            { icon: Flag, label: language === "en" ? "Team Battle" : "チーム対抗戦", path: "/team-battle" },
            { icon: Gamepad2, label: language === "en" ? "Scenario" : "交渉シナリオ", path: "/interactive-scenario" },
            { icon: Wand2, label: language === "en" ? "Theme Suggest" : "テーマ推薦", path: "/theme-recommender" },
            { icon: ScrollText, label: language === "en" ? "Summary" : "AI要約", path: "/matching-summary" },
            { icon: Flame, label: language === "en" ? "Streaks" : "ストリーク", path: "/streaks" },
          ],
        },
        {
          label: language === "en" ? "Analysis" : "分析系",
          items: [
            { icon: Map, label: language === "en" ? "Strategy" : "戦略プランナー", path: "/strategy" },
            { icon: ClipboardList, label: language === "en" ? "Outcomes" : "成果トラッカー", path: "/outcomes" },
            { icon: Award, label: language === "en" ? "Quality" : "品質評価", path: "/quality" },
            { icon: TrendingUp, label: language === "en" ? "ROI" : "ROI分析", path: "/roi" },
            { icon: Grid3x3, label: language === "en" ? "Heatmap" : "ヒートマップ", path: "/heatmap" },
            { icon: Gauge, label: language === "en" ? "Quality Meter" : "品質メーター", path: "/quality-meter" },
            { icon: ShieldAlert, label: language === "en" ? "Risk" : "リスク診断", path: "/risk-assessment" },
            { icon: Smile, label: language === "en" ? "Emotions" : "感情分析", path: "/emotions" },
            { icon: Waves, label: language === "en" ? "Emotion Flow" : "感情フロー", path: "/emotion-flow" },
            { icon: ArrowLeftRight, label: language === "en" ? "Compare" : "比較タイムライン", path: "/comparison-timeline" },
            { icon: Diff, label: language === "en" ? "Compare" : "セッション比較", path: "/compare-report" },
            { icon: BookText, label: language === "en" ? "Storyboard" : "ストーリーボード", path: "/storyboard" },
            { icon: Tags, label: language === "en" ? "Tags" : "セッションタグ", path: "/session-tags" },
            { icon: Hash, label: language === "en" ? "Strategy Tags" : "戦略タグ", path: "/strategy-annotation" },
            { icon: Library, label: language === "en" ? "Patterns" : "成功パターン", path: "/success-patterns" },
            { icon: Binoculars, label: language === "en" ? "Multi-View" : "マルチ視点", path: "/multi-perspective" },
            { icon: Network, label: language === "en" ? "Network" : "ネットワーク", path: "/network" },
            { icon: MessageCircle, label: language === "en" ? "Conv. Style" : "会話スタイル", path: "/conversation-style" },
            { icon: MapPin, label: language === "en" ? "Impact Map" : "インパクトマップ", path: "/impact-map" },
          ],
        },
        {
          label: language === "en" ? "Collaboration" : "コラボ系",
          items: [
            { icon: Globe, label: t("nav.discover"), path: "/discover" },
            { icon: UserPlus, label: t("nav.friends"), path: "/friends" },
            { icon: Heart, label: t("nav.intimacy"), path: "/intimacy" },
            { icon: CalendarClock, label: language === "en" ? "Scheduler" : "スケジューラー", path: "/scheduler" },
            { icon: LayoutGrid, label: language === "en" ? "Workspace" : "ワークスペース", path: "/workspaces" },
            { icon: Lightbulb, label: t("nav.recommendations"), path: "/recommendations" },
            { icon: FileText, label: language === "en" ? "Digest" : "ダイジェスト", path: "/digest" },
            { icon: BookOpen, label: language === "en" ? "Playbooks" : "プレイブック", path: "/playbooks" },
            { icon: CalendarDays, label: language === "en" ? "Calendar" : "カレンダー", path: "/calendar" },
            { icon: Calendar, label: language === "en" ? "Events" : "イベント", path: "/events" },
            { icon: Handshake, label: language === "en" ? "Consensus" : "合意形成", path: "/consensus" },
            { icon: Landmark, label: language === "en" ? "Cross-Culture" : "異文化分析", path: "/cross-culture" },
            { icon: Eye, label: language === "en" ? "Second Opinion" : "セカンドオピニオン", path: "/second-opinion" },
            { icon: ShieldCheck, label: language === "en" ? "Trust Progress" : "信頼構築", path: "/trust-progress" },
            { icon: Zap, label: language === "en" ? "Brainstorm" : "ブレスト", path: "/brainstorm" },
            { icon: Mic, label: language === "en" ? "Voice Notes" : "音声ノート", path: "/voice-notes" },
            { icon: Sun, label: language === "en" ? "Briefing" : "ブリーフィング", path: "/daily-briefing" },
            { icon: Bookmark, label: language === "en" ? "Bookmarks" : "ブックマーク", path: "/bookmarks" },
            { icon: ListTodo, label: language === "en" ? "Action Plans" : "アクションプラン", path: "/action-plans" },
            { icon: FolderArchive, label: language === "en" ? "Archive" : "アーカイブ", path: "/session-archive" },
            { icon: Activity, label: language === "en" ? "Friend Activity" : "友達タイムライン", path: "/friend-activity" },
            { icon: Languages, label: language === "en" ? "Translate Chat" : "翻訳チャット", path: "/translation-chat" },
          ],
        },
      ],
    },
    {
      label: language === "en" ? "More" : "もっと",
      subGroups: [
        {
          label: language === "en" ? "Twin" : "ツイン系",
          items: [
            { icon: Brain, label: language === "en" ? "Personality" : "人格診断", path: "/personality" },
            { icon: Compass, label: language === "en" ? "AI Mentor" : "AIメンター", path: "/mentor" },
            { icon: TreePine, label: language === "en" ? "Skill Tree" : "スキルツリー", path: "/skill-tree" },
            { icon: GitBranch, label: language === "en" ? "Evolution" : "進化マップ", path: "/evolution" },
            { icon: Trophy, label: language === "en" ? "Challenges" : "チャレンジ", path: "/challenges" },
            { icon: Users, label: language === "en" ? "Collab" : "ツイン共同", path: "/collaboration" },
            { icon: GitFork, label: language === "en" ? "Clone/Fork" : "クローン", path: "/twin-clone" },
            { icon: MessageSquare, label: language === "en" ? "Rehearsal" : "リハーサル", path: "/rehearsal" },
            { icon: HelpCircle, label: language === "en" ? "Twin FAQ" : "ツインFAQ", path: "/twin-faq" },
            { icon: LayoutTemplate, label: language === "en" ? "Gallery" : "テンプレート", path: "/twin-gallery" },
            { icon: Code2, label: language === "en" ? "Embed Card" : "埋め込みカード", path: "/twin-embed" },
            { icon: HeartPulse, label: language === "en" ? "Twin Health" : "ヘルスチェック", path: "/twin-health" },
            { icon: ArrowLeftRight, label: language === "en" ? "Twin Compare" : "ツイン比較", path: "/twin-compare" },
            { icon: Goal, label: language === "en" ? "Goals" : "ツイン目標", path: "/goals" },
          ],
        },
        {
          label: language === "en" ? "Learning" : "学習系",
          items: [
            { icon: MessageCircleHeart, label: language === "en" ? "Coaching" : "コーチング", path: "/coaching" },
            { icon: GraduationCap, label: language === "en" ? "Curriculum" : "学習カリキュラム", path: "/learning-curriculum" },
            { icon: BookMarked, label: language === "en" ? "Journal" : "学習ジャーナル", path: "/learning-journal" },
            { icon: Drama, label: language === "en" ? "Roleplay" : "ロールプレイ", path: "/roleplay-training" },
            { icon: Network, label: language === "en" ? "Knowledge Graph" : "ナレッジグラフ", path: "/knowledge-graph" },
            { icon: Waypoints, label: language === "en" ? "Knowledge Builder" : "知識グラフ", path: "/knowledge-graph-builder" },
            { icon: Database, label: language === "en" ? "Memory Bank" : "メモリーバンク", path: "/memory-bank" },
            { icon: HelpCircle, label: language === "en" ? "Quiz" : "ナレッジクイズ", path: "/quiz" },
            { icon: PenLine, label: language === "en" ? "Style Learning" : "対話スタイル", path: "/dialogue-style" },
            { icon: FileBarChart, label: language === "en" ? "Report" : "人格レポート", path: "/personality-report" },
            { icon: TestTubes, label: language === "en" ? "Persona Test" : "ペルソナテスト", path: "/persona-ab-test" },
            { icon: FlaskRound, label: language === "en" ? "Sandbox" : "サンドボックス", path: "/sandbox" },
            { icon: BookHeart, label: language === "en" ? "Emotion Journal" : "感情ジャーナル", path: "/emotion-journal" },
            { icon: Captions, label: language === "en" ? "Commentary" : "リプレイ解説", path: "/replay-commentary" },
            { icon: CalendarRange, label: language === "en" ? "Weekly Review" : "週次レビュー", path: "/weekly-review" },
            { icon: SlidersHorizontal, label: language === "en" ? "Calibration" : "感情調整", path: "/emotion-calibration" },
          ],
        },
        {
          label: language === "en" ? "Settings" : "設定系",
          items: [
            { icon: Store, label: t("nav.marketplace"), path: "/marketplace" },
            { icon: Sparkles, label: t("nav.growth"), path: "/growth" },
            { icon: MessageCircle, label: t("nav.line"), path: "/line-link" },
            { icon: CreditCard, label: t("nav.cards"), path: "/cards" },
            { icon: Crown, label: t("nav.plan"), path: "/plan" },
            { icon: FlaskConical, label: language === "en" ? "A/B Test" : "A/Bテスト", path: "/ab-test" },
            { icon: Target, label: language === "en" ? "Predictions" : "AI予測", path: "/predictions" },
            { icon: BookOpen, label: language === "en" ? "Scenarios" : "シナリオ", path: "/scenarios" },
            { icon: Swords, label: language === "en" ? "Tournament" : "トーナメント", path: "/tournament" },
            { icon: GitCompare, label: language === "en" ? "Scenarios" : "シナリオ比較", path: "/scenario-compare" },
            { icon: LayoutGrid, label: language === "en" ? "Widgets" : "ウィジェット", path: "/widgets" },
            { icon: FileCheck, label: language === "en" ? "Minutes" : "議事録", path: "/minutes" },
            { icon: History, label: language === "en" ? "Versions" : "バージョン", path: "/versions" },
            { icon: Mic, label: language === "en" ? "Voice Replay" : "音声リプレイ", path: "/voice-replay" },
            { icon: Star, label: language === "en" ? "Peer Review" : "相互評価", path: "/peer-review" },
            { icon: Gauge, label: language === "en" ? "Benchmark" : "ベンチマーク", path: "/benchmark" },
            { icon: Repeat2, label: language === "en" ? "Context Rules" : "コンテキスト切替", path: "/context-switcher" },
            { icon: Plug, label: language === "en" ? "Connectors" : "外部コネクター", path: "/external-connectors" },
            { icon: Mic, label: language === "en" ? "Multimodal" : "マルチモーダル", path: "/multimodal-input" },
          ],
        },
      ],
    },
  ], [t, language]);

  const translatedMenuItems = useMemo(() =>
    translatedMenuGroups.flatMap(g => g.items ?? g.subGroups?.flatMap(sg => sg.items) ?? []),
    [translatedMenuGroups]
  );

  const translatedBottomNavItems: MenuItem[] = useMemo(() => [
    { icon: LayoutDashboard, label: t("nav.home"), path: "/dashboard" },
    { icon: MessageSquare, label: t("nav.chat"), path: "/chat" },
    { icon: Users, label: t("nav.match"), path: "/matching" },
    { icon: UserPlus, label: t("nav.friends"), path: "/friends" },
  ], [t]);

  const activeMenuItem = translatedMenuItems.find(item => item.path === location);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      {/* Skip to main content link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium"
      >
        メインコンテンツへスキップ
      </a>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-semibold tracking-tight truncate text-gradient">
                      分身AI
                    </span>
                  </div>
                  <button
                    onClick={() => setCmdOpen(true)}
                    className="h-7 flex items-center gap-1.5 px-2 text-xs text-muted-foreground hover:bg-accent rounded-md border border-border/50 transition-colors shrink-0"
                    aria-label="ページ検索 (Ctrl+K)"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">検索</span>
                    <kbd className="hidden lg:inline text-[10px] bg-muted px-1 rounded">⌘K</kbd>
                  </button>
                </>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0" role="navigation" aria-label="メインナビゲーション">
            <SidebarMenu className="px-2 py-1">
              {translatedMenuGroups.map((group, gi) => (
                <div key={group.label}>
                  {gi > 0 && (
                    <div className="my-2 px-2">
                      <div className="h-px bg-border" />
                    </div>
                  )}
                  {!isCollapsed && (
                    <div className="px-3 py-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{group.label}</span>
                    </div>
                  )}
                  {group.items?.map(item => {
                    const isActive = location === item.path || (item.path === "/chat" && location.startsWith("/chat/"));
                    const isTrustItem = item.path === "/trust";
                    const isMatchingItem = item.path === "/matching";
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={isTrustItem && trustData ? `${item.label}: ${trustData.score}pt` : isMatchingItem && pendingRequestCount > 0 ? `${item.label} (${pendingRequestCount}件)` : item.label}
                          className="h-10 transition-all font-normal"
                        >
                          <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                          <span className="flex-1">{item.label}</span>
                          {isTrustItem && trustData && !isCollapsed && (
                            <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-5">{trustData.score}</Badge>
                          )}
                          {isMatchingItem && pendingRequestCount > 0 && !isCollapsed && (
                            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5">{pendingRequestCount}</Badge>
                          )}
                          {isMatchingItem && pendingRequestCount > 0 && isCollapsed && (
                            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                  {group.subGroups?.map(sub => {
                    const subKey = `${group.label}-${sub.label}`;
                    const isSubOpen = openSubGroups[subKey] !== false;
                    return (
                      <Collapsible key={subKey} open={isSubOpen} onOpenChange={() => toggleSubGroup(subKey)}>
                        {!isCollapsed && (
                          <CollapsibleTrigger asChild>
                            <button className="flex items-center gap-1 w-full px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                              <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${isSubOpen ? 'rotate-90' : ''}`} />
                              <span>{sub.label}</span>
                              <span className="ml-auto text-[10px] opacity-50">{sub.items.length}</span>
                            </button>
                          </CollapsibleTrigger>
                        )}
                        <CollapsibleContent>
                          {sub.items.map(item => {
                            const isActive = location === item.path;
                            const isMatchingItem = item.path === "/matching";
                            return (
                              <SidebarMenuItem key={item.path}>
                                <SidebarMenuButton
                                  isActive={isActive}
                                  onClick={() => setLocation(item.path)}
                                  tooltip={isMatchingItem && pendingRequestCount > 0 ? `${item.label} (${pendingRequestCount}件)` : item.label}
                                  className="h-10 transition-all font-normal"
                                >
                                  <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                                  <span className="flex-1">{item.label}</span>
                                  {isMatchingItem && pendingRequestCount > 0 && !isCollapsed && (
                                    <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5">{pendingRequestCount}</Badge>
                                  )}
                                  {isMatchingItem && pendingRequestCount > 0 && isCollapsed && (
                                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
                                  )}
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              ))}

              {/* 管理者専用メニュー */}
              {user?.role === 'admin' && (
                <>
                  <div className="my-2 px-2">
                    <div className="h-px bg-border" />
                  </div>
                  {!isCollapsed && (
                    <div className="px-3 py-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t("nav.admin")}</span>
                    </div>
                  )}
                  {adminMenuItems.map(item => {
                    const isActive = location === item.path;
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className={`h-10 transition-all font-normal`}
                        >
                          <item.icon
                            className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                          />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </>
              )}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            {/* Notification bell */}
            <div className="px-1 mb-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors w-full group-data-[collapsible=icon]:justify-center relative" aria-label={`通知${unreadCount > 0 ? `（${unreadCount}件未読）` : ''}`}>
                    <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {!isCollapsed && <span>通知</span>}
                    {unreadCount > 0 && (
                      <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[9px]">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </Badge>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <div className="px-3 py-2 flex items-center justify-between border-b">
                    <span className="text-sm font-medium">通知</span>
                    {unreadCount > 0 && (
                      <button onClick={() => markAllReadMut.mutate()} className="text-xs text-primary hover:underline">すべて既読</button>
                    )}
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {(notifData?.notifications ?? []).length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">通知はありません</div>
                    ) : (
                      (notifData?.notifications ?? []).map((n: any) => (
                        <DropdownMenuItem key={n.id} className="group relative py-2 cursor-pointer" onClick={() => {
                          if (!n.isRead) markReadMut.mutate({ id: n.id });
                          if (n.data) { try { const d = JSON.parse(n.data); if (d.link) setLocation(d.link); } catch {} }
                        }}>
                          <div className="flex items-start gap-2 w-full">
                            {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium">{n.title}</span>
                              {n.message && <span className="text-[11px] text-muted-foreground line-clamp-2 block">{n.message}</span>}
                              <span className="text-[10px] text-muted-foreground block">{new Date(n.createdAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteNotifMut.mutate({ id: n.id }); }}
                            className="absolute top-1 right-1 h-4 w-4 flex items-center justify-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="通知を削除"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                  {(notifData?.notifications ?? []).length > 0 && (
                    <div className="px-3 py-2 border-t">
                      <button
                        onClick={() => markAllReadMut.mutate()}
                        className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                        disabled={unreadCount === 0}
                      >
                        {markAllReadMut.isPending ? "処理中..." : `すべて既読にする (${unreadCount}件)`}
                      </button>
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Push notification toggle */}
            {webPush.isSupported && (
              <div className="px-1 mb-2">
                <button
                  onClick={() => webPush.isSubscribed ? webPush.unsubscribe() : webPush.subscribe()}
                  disabled={webPush.isLoading}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors w-full group-data-[collapsible=icon]:justify-center"
                  aria-label={webPush.isSubscribed ? "プッシュ通知をオフ" : "プッシュ通知をオン"}
                >
                  <Bell className={`h-4 w-4 shrink-0 ${webPush.isSubscribed ? "text-primary" : ""}`} aria-hidden="true" />
                  {!isCollapsed && <span>{webPush.isSubscribed ? "Push ON" : "Push OFF"}</span>}
                </button>
              </div>
            )}
            {/* Language toggle */}
            <div className="px-1 mb-2">
              <button
                onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors w-full group-data-[collapsible=icon]:justify-center"
                aria-label="言語を切り替え"
              >
                <Languages className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span>{language === "ja" ? "English" : "日本語"}</span>}
              </button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="ユーザーメニュー">
                  <Avatar className="h-9 w-9 border shrink-0">
                    {(user as any)?.avatarUrl && <AvatarImage src={`${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}${(user as any).avatarUrl}`} />}
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => setLocation("/profile")}
                  className="cursor-pointer"
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  <span>{language === "en" ? "Account Settings" : "アカウント設定"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("common.logout")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors focus-visible:bg-primary/30 focus-visible:w-1.5 focus-visible:outline-none ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバー幅を調整"
          aria-valuenow={undefined}
          tabIndex={isCollapsed ? -1 : 0}
          onKeyDown={(e) => {
            if (isCollapsed) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const delta = e.key === "ArrowRight" ? 20 : -20;
              const sidebar = sidebarRef.current;
              if (sidebar) {
                const rect = sidebar.getBoundingClientRect();
                const newWidth = rect.width + delta;
                if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
                  setSidebarWidth(newWidth);
                }
              }
            }
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-12 items-center justify-between bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <span className="text-sm font-medium tracking-tight text-foreground">
              {activeMenuItem?.label ?? "分身AI"}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setCmdOpen(true)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent" aria-label="ページ検索">
                <Search className="h-5 w-5 text-muted-foreground" />
              </button>
              {unreadCount > 0 && (
                <button onClick={() => setLocation('/dashboard')} className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent" aria-label={`通知（${unreadCount}件未読）`}>
                  <Bell className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive text-[9px] text-white flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent" aria-label="ユーザーメニュー">
                    <Avatar className="h-7 w-7 border">
                      {(user as any)?.avatarUrl && <AvatarImage src={`${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}${(user as any).avatarUrl}`} />}
                      <AvatarFallback className="text-[10px] font-medium">
                        {user?.name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setLocation("/profile")} className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>{t("nav.profile")}</span>
                  </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/plan")} className="cursor-pointer">
                  <Crown className="mr-2 h-4 w-4" />
                  <span>{t("nav.plan")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage(language === "ja" ? "en" : "ja")} className="cursor-pointer">
                  <Languages className="mr-2 h-4 w-4" />
                  <span>{language === "ja" ? "English" : "日本語"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("common.logout")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>
        )}
        <main id="main-content" className={`flex-1 p-4 ${isMobile ? "pb-20" : ""}`}>
          {dunningStatus && (
            <div className="mb-4 rounded-lg border border-red-500/50 bg-red-950/30 p-4 flex items-center gap-3" role="alert">
              <div className="p-2 rounded-full bg-red-500/10 shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-400">お支払いの更新が必要です</p>
                <p className="text-xs text-red-400/70">
                  {dunningStatus.daysRemaining > 0
                    ? `決済に問題が発生しています。${dunningStatus.daysRemaining}日以内に支払い方法を更新してください。`
                    : "猶予期間が終了しました。お支払い方法を今すぐ更新してください。"}
                </p>
              </div>
              <Link href="/plan">
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-1.5 shrink-0">
                  <CreditCard className="h-3.5 w-3.5" />
                  支払いを更新
                </Button>
              </Link>
            </div>
          )}
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
            {children}
          </Suspense>
        </main>
        {/* Mobile Bottom Navigation */}
        {isMobile && (
          <MobileBottomNav
            location={location}
            setLocation={setLocation}
            pendingRequestCount={pendingRequestCount}
            user={user}
            bottomNavItems={translatedBottomNavItems}
            menuGroups={translatedMenuGroups}
          />
        )}
      </SidebarInset>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}

function MobileBottomNav({
  location,
  setLocation,
  pendingRequestCount,
  user,
  bottomNavItems,
  menuGroups,
}: {
  location: string;
  setLocation: (path: string) => void;
  pendingRequestCount: number;
  user: any;
  bottomNavItems: MenuItem[];
  menuGroups: MenuGroup[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSearch, setMoreSearch] = useState("");
  const { t } = useTranslation();

  const isActive = (path: string) =>
    location === path || (path === "/chat" && location.startsWith("/chat/"));

  const bottomPaths = useMemo(() => new Set(bottomNavItems.map(b => b.path)), [bottomNavItems]);

  const moreCategories = useMemo(() =>
    menuGroups.flatMap(g => {
      if (g.subGroups) {
        return g.subGroups.map(sg => ({
          label: sg.label,
          items: sg.items.filter(item => !bottomPaths.has(item.path)),
        }));
      }
      return [{ label: g.label, items: (g.items ?? []).filter(item => !bottomPaths.has(item.path)) }];
    }).filter(cat => cat.items.length > 0),
    [menuGroups, bottomPaths]
  );

  const filteredCategories = useMemo(() => {
    if (!moreSearch.trim()) return moreCategories;
    const q = moreSearch.toLowerCase();
    return moreCategories
      .map(cat => ({ ...cat, items: cat.items.filter(item => item.label.toLowerCase().includes(q)) }))
      .filter(cat => cat.items.length > 0);
  }, [moreCategories, moreSearch]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t safe-area-bottom" role="navigation" aria-label="モバイルナビゲーション">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {bottomNavItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative active:scale-95 transition-transform ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-5 w-5" aria-hidden="true" />
              <span className="text-[10px] leading-tight">{item.label}</span>
              {item.path === "/matching" && pendingRequestCount > 0 && (
                <span className="absolute top-1.5 right-1/4 h-2 w-2 rounded-full bg-destructive" />
              )}
            </button>
          );
        })}
        <Sheet open={moreOpen} onOpenChange={(open) => { setMoreOpen(open); if (!open) setMoreSearch(""); }}>
          <SheetTrigger asChild>
            <button className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-muted-foreground active:scale-95 transition-transform" aria-label="その他のメニュー">
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              <span className="text-[10px] leading-tight">{t("nav.more")}</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[70vh]">
            <SheetHeader>
              <SheetTitle>{t("nav.menu")}</SheetTitle>
            </SheetHeader>
            <div className="px-1 py-2">
              <input
                type="text"
                placeholder="検索..."
                value={moreSearch}
                onChange={(e) => setMoreSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="overflow-y-auto max-h-[50vh] pb-4">
              {filteredCategories.map((cat, ci) => (
                <div key={cat.label}>
                  {ci > 0 && <div className="my-2 mx-2 h-px bg-border" />}
                  <div className="px-3 py-1">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{cat.label}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 px-1">
                    {cat.items.map((item) => {
                      const active = isActive(item.path);
                      return (
                        <button
                          key={item.path}
                          onClick={() => { setLocation(item.path); setMoreOpen(false); }}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors active:scale-95 ${
                            active ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
                          }`}
                          aria-label={item.label}
                          aria-current={active ? "page" : undefined}
                        >
                          <item.icon className="h-5 w-5" aria-hidden="true" />
                          <span className="text-[11px] leading-tight text-center">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {filteredCategories.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">該当するページがありません</div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

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
import { toast } from "sonner";
import { LayoutDashboard, LogOut, PanelLeft, Users, Bot, MessageSquare, Settings2, Zap, User, UserPlus, Crown, Globe, Link2, Cpu, Brain, MessageCircle, Sparkles, CreditCard, Shield, Heart, MoreHorizontal, BarChart3, BookOpen, Languages, Loader2, Lightbulb, ShieldAlert, Store, Bell, Activity, X } from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type MenuItem = { icon: React.ElementType; label: string; path: string };
type MenuGroup = { label: string; items: MenuItem[] };

// 管理者専用メニュー (includes items hidden from regular users)
const adminMenuItems: MenuItem[] = [
  { icon: ShieldAlert, label: "審査", path: "/admin/review" },
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
  const unreadCount = notifData?.unreadCount ?? 0;

  // Real-time notifications via SSE
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
      ],
    },
    {
      label: language === "en" ? "Connect" : "つながる",
      items: [
        { icon: Globe, label: t("nav.discover"), path: "/discover" },
        { icon: UserPlus, label: t("nav.friends"), path: "/friends" },
        { icon: Users, label: t("nav.matching"), path: "/matching" },
        { icon: Lightbulb, label: t("nav.recommendations"), path: "/recommendations" },
        { icon: Heart, label: t("nav.intimacy"), path: "/intimacy" },
      ],
    },
    {
      label: language === "en" ? "More" : "もっと",
      items: [
        { icon: Store, label: t("nav.marketplace"), path: "/marketplace" },
        { icon: Sparkles, label: t("nav.growth"), path: "/growth" },
        { icon: MessageCircle, label: t("nav.line"), path: "/line-link" },
        { icon: CreditCard, label: t("nav.cards"), path: "/cards" },
        { icon: Crown, label: t("nav.plan"), path: "/plan" },
      ],
    },
  ], [t, language]);

  const translatedMenuItems = useMemo(() => translatedMenuGroups.flatMap(g => g.items), [translatedMenuGroups]);

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
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-gradient">
                    分身AI
                  </span>
                </div>
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
                  {group.items.map(item => {
                    const isActive = location === item.path || (item.path === "/chat" && location.startsWith("/chat/"));
                    const isTrustItem = item.path === "/trust";
                    const isMatchingItem = item.path === "/matching";
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={isTrustItem && trustData ? `${item.label}: ${trustData.score}pt` : isMatchingItem && pendingRequestCount > 0 ? `${item.label} (${pendingRequestCount}件)` : item.label}
                          className={`h-10 transition-all font-normal`}
                        >
                          <item.icon
                            className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                          />
                          <span className="flex-1">{item.label}</span>
                          {isTrustItem && trustData && !isCollapsed && (
                            <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-5">
                              {trustData.score}
                            </Badge>
                          )}
                          {isMatchingItem && pendingRequestCount > 0 && !isCollapsed && (
                            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5">
                              {pendingRequestCount}
                            </Badge>
                          )}
                          {isMatchingItem && pendingRequestCount > 0 && isCollapsed && (
                            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
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
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
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
        <main id="main-content" className={`flex-1 p-4 ${isMobile ? "pb-20" : ""}`}>{children}</main>
        {/* Mobile Bottom Navigation */}
        {isMobile && (
          <MobileBottomNav
            location={location}
            setLocation={setLocation}
            pendingRequestCount={pendingRequestCount}
            user={user}
            bottomNavItems={translatedBottomNavItems}
            menuItems={translatedMenuItems}
          />
        )}
      </SidebarInset>
    </>
  );
}

/** Mobile bottom navigation bar */
function MobileBottomNav({
  location,
  setLocation,
  pendingRequestCount,
  user,
  bottomNavItems,
  menuItems,
}: {
  location: string;
  setLocation: (path: string) => void;
  pendingRequestCount: number;
  user: any;
  bottomNavItems: MenuItem[];
  menuItems: MenuItem[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useTranslation();

  const isActive = (path: string) =>
    location === path || (path === "/chat" && location.startsWith("/chat/"));

  // Items NOT in bottom nav (shown in the "more" sheet)
  const moreItems = menuItems.filter(
    (item) => !bottomNavItems.some((b) => b.path === item.path)
  );

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
        {/* More button */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
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
            <div className="grid grid-cols-4 gap-3 py-4 overflow-y-auto">
              {moreItems.map((item) => {
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      setLocation(item.path);
                      setMoreOpen(false);
                    }}
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
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

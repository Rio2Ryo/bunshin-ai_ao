import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { LayoutDashboard, LogOut, PanelLeft, Users, Bot, MessageSquare, Settings2, Zap, User, UserPlus, Crown, Globe, Link2, Cpu, Brain, MessageCircle, Sparkles, CreditCard, Shield, Heart, MoreHorizontal } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type MenuItem = { icon: React.ElementType; label: string; path: string };
type MenuGroup = { label: string; items: MenuItem[] };

const menuGroups: MenuGroup[] = [
  {
    label: "メイン",
    items: [
      { icon: LayoutDashboard, label: "ダッシュボード", path: "/dashboard" },
      { icon: User, label: "プロフィール", path: "/profile" },
      { icon: Shield, label: "信頼度", path: "/trust" },
      { icon: Bot, label: "分身AI", path: "/twins" },
      { icon: MessageSquare, label: "チャット", path: "/chat" },
    ],
  },
  {
    label: "つながる",
    items: [
      { icon: Globe, label: "発見", path: "/discover" },
      { icon: UserPlus, label: "友達", path: "/friends" },
      { icon: Users, label: "マッチング", path: "/matching" },
      { icon: Heart, label: "親密度", path: "/intimacy" },
    ],
  },
  {
    label: "もっと",
    items: [
      { icon: Sparkles, label: "育成", path: "/growth" },
      { icon: MessageCircle, label: "LINE連携", path: "/line-link" },
      { icon: CreditCard, label: "カード管理", path: "/cards" },
      { icon: Crown, label: "プラン", path: "/plan" },
    ],
  },
];

// Flat list for activeMenuItem lookup
const menuItems = menuGroups.flatMap(g => g.items);

// Bottom nav items (5 most-used items for mobile)
const bottomNavItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "ホーム", path: "/dashboard" },
  { icon: MessageSquare, label: "チャット", path: "/chat" },
  { icon: Users, label: "マッチ", path: "/matching" },
  { icon: UserPlus, label: "友達", path: "/friends" },
];

// 管理者専用メニュー (includes items hidden from regular users)
const adminMenuItems: MenuItem[] = [
  { icon: Cpu, label: "AIプロバイダー", path: "/admin/ai-provider" },
  { icon: Settings2, label: "AI API設定", path: "/ai-config" },
  { icon: Zap, label: "オーケストレーション", path: "/orchestration" },
  { icon: Link2, label: "Clawdbot連携", path: "/clawdbot" },
  { icon: Brain, label: "学習した人格", path: "/learned-personality" },
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
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();
  const { data: trustData } = trpc.trust.getScore.useQuery();
  const { data: receivedRequests } = trpc.matching.receivedRequests.useQuery();
  const pendingRequestCount = receivedRequests?.length ?? 0;

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

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuGroups.map((group, gi) => (
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
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">管理者</span>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
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
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>ログアウト</span>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent">
                  <Avatar className="h-7 w-7 border">
                    <AvatarFallback className="text-[10px] font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setLocation("/profile")} className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>プロフィール</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/plan")} className="cursor-pointer">
                  <Crown className="mr-2 h-4 w-4" />
                  <span>プラン</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>ログアウト</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
}: {
  location: string;
  setLocation: (path: string) => void;
  pendingRequestCount: number;
  user: any;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path: string) =>
    location === path || (path === "/chat" && location.startsWith("/chat/"));

  // Items NOT in bottom nav (shown in the "more" sheet)
  const moreItems = menuItems.filter(
    (item) => !bottomNavItems.some((b) => b.path === item.path)
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t safe-area-bottom">
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
            >
              <item.icon className="h-5 w-5" />
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
            <button className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-muted-foreground active:scale-95 transition-transform">
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[10px] leading-tight">その他</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[70vh]">
            <SheetHeader>
              <SheetTitle>メニュー</SheetTitle>
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
                  >
                    <item.icon className="h-5 w-5" />
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

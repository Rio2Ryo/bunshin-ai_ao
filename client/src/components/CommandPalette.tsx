import { useCallback } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard, User, Shield, Bot, MessageSquare, BarChart3, Rss, BellRing,
  SlidersHorizontal, Globe, UserPlus, Users, CalendarClock, LayoutGrid, Lightbulb,
  Heart, Swords, Map, ClipboardList, Award, FileText, BookOpen, MessageCircle,
  Network, TrendingUp, CalendarDays, Scale, Calendar, Grid3x3, BookText,
  MessageSquarePlus, Tags, Wand2, Library, Gamepad2, Languages, ScrollText,
  ArrowLeftRight, Waves, Binoculars, ShieldAlert, MapPin, Gauge, Handshake,
  Eye, Zap, Mic, Sun, Bookmark, ListTodo, FolderArchive, Flame, Activity,
  Store, Sparkles, CreditCard, Crown, Brain, FlaskConical, Target, TreePine,
  GitBranch, Trophy, Database, GitCompare, FileCheck, History, Star,
  BookHeart, Captions, Goal, HelpCircle, TestTubes, CalendarRange, PenLine,
  FileBarChart, Repeat2, GraduationCap, Plug, BookMarked, Drama, GitFork,
  Code2, HeartPulse, LayoutTemplate, FlaskRound, MessageCircleHeart,
  Crosshair, Smile, Flag, Hash, Diff, Landmark, ShieldCheck, Compass, Waypoints,
} from "lucide-react";

type NavItem = { icon: React.ElementType; label: string; path: string; keywords?: string };

const MAIN_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: "ダッシュボード", path: "/dashboard", keywords: "home top" },
  { icon: User, label: "プロフィール", path: "/profile", keywords: "account settings" },
  { icon: Shield, label: "信頼スコア", path: "/trust", keywords: "trust score" },
  { icon: Bot, label: "ツイン", path: "/twins", keywords: "twin ai" },
  { icon: MessageSquare, label: "チャット", path: "/chat", keywords: "message talk" },
  { icon: BarChart3, label: "分析", path: "/analytics", keywords: "analytics stats" },
  { icon: Rss, label: "フィード", path: "/feed", keywords: "feed timeline" },
  { icon: BellRing, label: "通知管理", path: "/notifications", keywords: "notification bell" },
  { icon: SlidersHorizontal, label: "通知プリファレンス", path: "/notification-preferences", keywords: "preferences settings" },
];

const MATCHING_ITEMS: NavItem[] = [
  { icon: Users, label: "マッチング", path: "/matching", keywords: "matching" },
  { icon: Crosshair, label: "インサイト", path: "/matching/insights", keywords: "insight analysis" },
  { icon: Swords, label: "ネゴ練習", path: "/negotiation", keywords: "negotiation practice" },
  { icon: Scale, label: "ディベート", path: "/debate", keywords: "debate discuss" },
  { icon: MessageSquarePlus, label: "AIファシリ", path: "/facilitator", keywords: "facilitator ai" },
  { icon: Flag, label: "チーム対抗戦", path: "/team-battle", keywords: "team battle" },
  { icon: Gamepad2, label: "交渉シナリオ", path: "/interactive-scenario", keywords: "scenario game" },
  { icon: Wand2, label: "テーマ推薦", path: "/theme-recommender", keywords: "theme recommend" },
  { icon: ScrollText, label: "AI要約", path: "/matching-summary", keywords: "summary ai" },
  { icon: Flame, label: "ストリーク", path: "/streaks", keywords: "streak gamification" },
];

const ANALYSIS_ITEMS: NavItem[] = [
  { icon: Map, label: "戦略プランナー", path: "/strategy", keywords: "strategy plan" },
  { icon: ClipboardList, label: "成果トラッカー", path: "/outcomes", keywords: "outcome result" },
  { icon: Award, label: "品質評価", path: "/quality", keywords: "quality score" },
  { icon: TrendingUp, label: "ROI分析", path: "/roi", keywords: "roi return" },
  { icon: Grid3x3, label: "ヒートマップ", path: "/heatmap", keywords: "heatmap visual" },
  { icon: Gauge, label: "品質メーター", path: "/quality-meter", keywords: "quality meter" },
  { icon: ShieldAlert, label: "リスク診断", path: "/risk-assessment", keywords: "risk assessment" },
  { icon: Smile, label: "感情分析", path: "/emotions", keywords: "emotion sentiment" },
  { icon: Waves, label: "感情フロー", path: "/emotion-flow", keywords: "emotion flow wave" },
  { icon: ArrowLeftRight, label: "比較タイムライン", path: "/comparison-timeline", keywords: "compare timeline" },
  { icon: Diff, label: "セッション比較", path: "/compare-report", keywords: "session compare" },
  { icon: BookText, label: "ストーリーボード", path: "/storyboard", keywords: "storyboard narrative" },
  { icon: Tags, label: "セッションタグ", path: "/session-tags", keywords: "session tag label" },
  { icon: Hash, label: "戦略タグ", path: "/strategy-annotation", keywords: "strategy annotation" },
  { icon: Library, label: "成功パターン", path: "/success-patterns", keywords: "success pattern" },
  { icon: Binoculars, label: "マルチ視点", path: "/multi-perspective", keywords: "perspective multi" },
  { icon: Network, label: "ネットワーク", path: "/network", keywords: "network graph" },
  { icon: MessageCircle, label: "会話スタイル", path: "/conversation-style", keywords: "conversation style" },
  { icon: MapPin, label: "インパクトマップ", path: "/impact-map", keywords: "impact map" },
];

const COLLAB_ITEMS: NavItem[] = [
  { icon: Globe, label: "ディスカバー", path: "/discover", keywords: "discover explore search" },
  { icon: UserPlus, label: "友達", path: "/friends", keywords: "friend add" },
  { icon: Heart, label: "親密度", path: "/intimacy", keywords: "intimacy closeness" },
  { icon: CalendarClock, label: "スケジューラー", path: "/scheduler", keywords: "schedule auto" },
  { icon: LayoutGrid, label: "ワークスペース", path: "/workspaces", keywords: "workspace room" },
  { icon: Lightbulb, label: "レコメンド", path: "/recommendations", keywords: "recommend suggest" },
  { icon: FileText, label: "ダイジェスト", path: "/digest", keywords: "digest summary" },
  { icon: BookOpen, label: "プレイブック", path: "/playbooks", keywords: "playbook guide" },
  { icon: CalendarDays, label: "カレンダー", path: "/calendar", keywords: "calendar date" },
  { icon: Calendar, label: "イベント", path: "/events", keywords: "event meeting" },
  { icon: Handshake, label: "合意形成", path: "/consensus", keywords: "consensus agreement" },
  { icon: Landmark, label: "異文化分析", path: "/cross-culture", keywords: "cross culture" },
  { icon: Eye, label: "セカンドオピニオン", path: "/second-opinion", keywords: "second opinion" },
  { icon: ShieldCheck, label: "信頼構築", path: "/trust-progress", keywords: "trust progress" },
  { icon: Zap, label: "ブレスト", path: "/brainstorm", keywords: "brainstorm idea" },
  { icon: Mic, label: "音声ノート", path: "/voice-notes", keywords: "voice note audio" },
  { icon: Sun, label: "ブリーフィング", path: "/daily-briefing", keywords: "briefing daily" },
  { icon: Bookmark, label: "ブックマーク", path: "/bookmarks", keywords: "bookmark save" },
  { icon: ListTodo, label: "アクションプラン", path: "/action-plans", keywords: "action plan todo" },
  { icon: FolderArchive, label: "アーカイブ", path: "/session-archive", keywords: "archive storage" },
  { icon: Activity, label: "友達タイムライン", path: "/friend-activity", keywords: "activity timeline" },
  { icon: Languages, label: "翻訳チャット", path: "/translation-chat", keywords: "translate language" },
];

const TWIN_ITEMS: NavItem[] = [
  { icon: Brain, label: "人格診断", path: "/personality", keywords: "personality bigfive mbti" },
  { icon: Compass, label: "AIメンター", path: "/mentor", keywords: "mentor ai coach" },
  { icon: TreePine, label: "スキルツリー", path: "/skill-tree", keywords: "skill tree level" },
  { icon: GitBranch, label: "進化マップ", path: "/evolution", keywords: "evolution map" },
  { icon: Trophy, label: "チャレンジ", path: "/challenges", keywords: "challenge quest" },
  { icon: Users, label: "ツイン共同", path: "/collaboration", keywords: "collaboration team" },
  { icon: GitFork, label: "クローン", path: "/twin-clone", keywords: "clone fork" },
  { icon: MessageSquare, label: "リハーサル", path: "/rehearsal", keywords: "rehearsal practice" },
  { icon: HelpCircle, label: "ツインFAQ", path: "/twin-faq", keywords: "faq question answer" },
  { icon: LayoutTemplate, label: "テンプレート", path: "/twin-gallery", keywords: "template gallery" },
  { icon: Code2, label: "埋め込みカード", path: "/twin-embed", keywords: "embed card" },
  { icon: HeartPulse, label: "ヘルスチェック", path: "/twin-health", keywords: "health check diagnosis" },
  { icon: ArrowLeftRight, label: "ツイン比較", path: "/twin-compare", keywords: "twin compare radar" },
  { icon: Goal, label: "ツイン目標", path: "/goals", keywords: "goal target" },
];

const LEARNING_ITEMS: NavItem[] = [
  { icon: MessageCircleHeart, label: "コーチング", path: "/coaching", keywords: "coaching train" },
  { icon: GraduationCap, label: "学習カリキュラム", path: "/learning-curriculum", keywords: "learning curriculum" },
  { icon: BookMarked, label: "学習ジャーナル", path: "/learning-journal", keywords: "learning journal" },
  { icon: Drama, label: "ロールプレイ", path: "/roleplay-training", keywords: "roleplay training" },
  { icon: Network, label: "ナレッジグラフ", path: "/knowledge-graph", keywords: "knowledge graph" },
  { icon: Waypoints, label: "知識グラフ", path: "/knowledge-graph-builder", keywords: "knowledge graph build" },
  { icon: Database, label: "メモリーバンク", path: "/memory-bank", keywords: "memory bank storage" },
  { icon: HelpCircle, label: "ナレッジクイズ", path: "/quiz", keywords: "quiz knowledge test" },
  { icon: PenLine, label: "対話スタイル", path: "/dialogue-style", keywords: "dialogue style" },
  { icon: FileBarChart, label: "人格レポート", path: "/personality-report", keywords: "personality report" },
  { icon: TestTubes, label: "ペルソナテスト", path: "/persona-ab-test", keywords: "persona test" },
  { icon: FlaskRound, label: "サンドボックス", path: "/sandbox", keywords: "sandbox test" },
  { icon: BookHeart, label: "感情ジャーナル", path: "/emotion-journal", keywords: "emotion journal diary" },
  { icon: Captions, label: "リプレイ解説", path: "/replay-commentary", keywords: "replay commentary" },
  { icon: CalendarRange, label: "週次レビュー", path: "/weekly-review", keywords: "weekly review" },
  { icon: SlidersHorizontal, label: "感情調整", path: "/emotion-calibration", keywords: "emotion calibration" },
];

const SETTINGS_ITEMS: NavItem[] = [
  { icon: Store, label: "マーケットプレイス", path: "/marketplace", keywords: "market shop" },
  { icon: Sparkles, label: "成長", path: "/growth", keywords: "growth level" },
  { icon: MessageCircle, label: "LINE連携", path: "/line-link", keywords: "line integration" },
  { icon: CreditCard, label: "カード", path: "/cards", keywords: "card business" },
  { icon: Crown, label: "プラン", path: "/plan", keywords: "plan subscription billing" },
  { icon: FlaskConical, label: "A/Bテスト", path: "/ab-test", keywords: "ab test experiment" },
  { icon: Target, label: "AI予測", path: "/predictions", keywords: "predict forecast" },
  { icon: BookOpen, label: "シナリオ", path: "/scenarios", keywords: "scenario value" },
  { icon: Swords, label: "トーナメント", path: "/tournament", keywords: "tournament competition" },
  { icon: GitCompare, label: "シナリオ比較", path: "/scenario-compare", keywords: "scenario compare" },
  { icon: LayoutGrid, label: "ウィジェット", path: "/widgets", keywords: "widget dashboard" },
  { icon: FileCheck, label: "議事録", path: "/minutes", keywords: "minutes record" },
  { icon: History, label: "バージョン", path: "/versions", keywords: "version history" },
  { icon: Mic, label: "音声リプレイ", path: "/voice-replay", keywords: "voice replay" },
  { icon: Star, label: "相互評価", path: "/peer-review", keywords: "peer review rate" },
  { icon: Gauge, label: "ベンチマーク", path: "/benchmark", keywords: "benchmark compare" },
  { icon: Repeat2, label: "コンテキスト切替", path: "/context-switcher", keywords: "context switch" },
  { icon: Plug, label: "外部コネクター", path: "/external-connectors", keywords: "external connector" },
  { icon: Mic, label: "マルチモーダル", path: "/multimodal-input", keywords: "multimodal input" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandPalette({ open, onOpenChange }: Props) {
  const [, navigate] = useLocation();

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false);
      navigate(path);
    },
    [navigate, onOpenChange],
  );

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <CommandItem
        key={item.path}
        value={`${item.label} ${item.keywords ?? ""}`}
        onSelect={() => handleSelect(item.path)}
      >
        <item.icon className="mr-2 h-4 w-4 shrink-0" />
        <span>{item.label}</span>
        <CommandShortcut className="text-xs opacity-50">{item.path}</CommandShortcut>
      </CommandItem>
    ));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="ページ検索" description="ページ名や機能名で検索">
      <CommandInput placeholder="ページを検索... (例: マッチング、チャット)" />
      <CommandList>
        <CommandEmpty>該当するページが見つかりません</CommandEmpty>
        <CommandGroup heading="メイン">{renderItems(MAIN_ITEMS)}</CommandGroup>
        <CommandGroup heading="マッチング系">{renderItems(MATCHING_ITEMS)}</CommandGroup>
        <CommandGroup heading="分析系">{renderItems(ANALYSIS_ITEMS)}</CommandGroup>
        <CommandGroup heading="コラボ系">{renderItems(COLLAB_ITEMS)}</CommandGroup>
        <CommandGroup heading="ツイン系">{renderItems(TWIN_ITEMS)}</CommandGroup>
        <CommandGroup heading="学習系">{renderItems(LEARNING_ITEMS)}</CommandGroup>
        <CommandGroup heading="設定系">{renderItems(SETTINGS_ITEMS)}</CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

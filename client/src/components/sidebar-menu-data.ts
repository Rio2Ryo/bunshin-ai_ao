/**
 * Sidebar menu item definitions extracted from DashboardLayout.
 *
 * All lucide-react icon imports for menu items live here so that
 * DashboardLayout.tsx only imports the handful of icons it needs
 * for layout chrome (LogOut, PanelLeft, Loader2, etc.).
 */
import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/contexts/LanguageContext";
import {
  Activity,
  Award,
  ArrowLeftRight,
  BarChart3,
  BellRing,
  Binoculars,
  BookHeart,
  BookMarked,
  BookOpen,
  BookText,
  Bot,
  Brain,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Captions,
  ClipboardList,
  Code2,
  Compass,
  CreditCard,
  Crosshair,
  Crown,
  Cpu,
  Database,
  Diff,
  Drama,
  Eye,
  FileBarChart,
  FileCheck,
  FileText,
  Flag,
  Flame,
  FlaskConical,
  FlaskRound,
  FolderArchive,
  Gamepad2,
  Gauge,
  GitBranch,
  GitCompare,
  GitFork,
  Globe,
  Goal,
  GraduationCap,
  Grid3x3,
  Handshake,
  Hash,
  Heart,
  HeartPulse,
  HelpCircle,
  History,
  Languages,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  Library,
  Lightbulb,
  Link2,
  ListTodo,
  Map,
  MapPin,
  MessageCircle,
  MessageCircleHeart,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Network,
  PenLine,
  Plug,
  Repeat2,
  Rss,
  Scale,
  ScrollText,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Star,
  Store,
  Sun,
  Bookmark,
  Swords,
  Tags,
  Target,
  TestTubes,
  TreePine,
  TrendingUp,
  Trophy,
  User,
  UserPlus,
  Users,
  Wand2,
  Waves,
  Waypoints,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MenuItem = {
  icon: LucideIcon;
  label: string;
  path: string;
};

export type SubGroup = {
  label: string;
  items: MenuItem[];
};

export type MenuGroup = {
  label: string;
  items?: MenuItem[];
  subGroups?: SubGroup[];
};

// ---------------------------------------------------------------------------
// Translation helper type
// ---------------------------------------------------------------------------

type T = (key: TranslationKey) => string;
type Language = "ja" | "en";

// ---------------------------------------------------------------------------
// Admin menu (static — no translations needed)
// ---------------------------------------------------------------------------

export const adminMenuItems: MenuItem[] = [
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

// ---------------------------------------------------------------------------
// Main menu groups (translated)
// ---------------------------------------------------------------------------

export function getMenuGroups(t: T, language: Language): MenuGroup[] {
  return [
    {
      label: language === "en" ? "Main" : "メイン",
      items: [
        { icon: LayoutDashboard, label: t("nav.dashboard" as TranslationKey), path: "/dashboard" },
        { icon: User, label: t("nav.profile" as TranslationKey), path: "/profile" },
        { icon: Shield, label: t("nav.trust" as TranslationKey), path: "/trust" },
        { icon: Bot, label: t("nav.twins" as TranslationKey), path: "/twins" },
        { icon: MessageSquare, label: t("nav.chat" as TranslationKey), path: "/chat" },
        { icon: BarChart3, label: t("nav.analytics" as TranslationKey), path: "/analytics" },
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
            { icon: Users, label: t("nav.matching" as TranslationKey), path: "/matching" },
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
            { icon: Globe, label: t("nav.discover" as TranslationKey), path: "/discover" },
            { icon: UserPlus, label: t("nav.friends" as TranslationKey), path: "/friends" },
            { icon: Heart, label: t("nav.intimacy" as TranslationKey), path: "/intimacy" },
            { icon: CalendarClock, label: language === "en" ? "Scheduler" : "スケジューラー", path: "/scheduler" },
            { icon: LayoutGrid, label: language === "en" ? "Workspace" : "ワークスペース", path: "/workspaces" },
            { icon: Lightbulb, label: t("nav.recommendations" as TranslationKey), path: "/recommendations" },
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
            { icon: Store, label: t("nav.marketplace" as TranslationKey), path: "/marketplace" },
            { icon: Sparkles, label: t("nav.growth" as TranslationKey), path: "/growth" },
            { icon: MessageCircle, label: t("nav.line" as TranslationKey), path: "/line-link" },
            { icon: CreditCard, label: t("nav.cards" as TranslationKey), path: "/cards" },
            { icon: Crown, label: t("nav.plan" as TranslationKey), path: "/plan" },
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
  ];
}

// ---------------------------------------------------------------------------
// Bottom nav items (mobile)
// ---------------------------------------------------------------------------

export function getBottomNavItems(t: T): MenuItem[] {
  return [
    { icon: LayoutDashboard, label: t("nav.home" as TranslationKey), path: "/dashboard" },
    { icon: MessageSquare, label: t("nav.chat" as TranslationKey), path: "/chat" },
    { icon: Users, label: t("nav.match" as TranslationKey), path: "/matching" },
    { icon: UserPlus, label: t("nav.friends" as TranslationKey), path: "/friends" },
  ];
}

import React, { createContext, useContext, useState, useCallback } from "react";

type Language = "ja" | "en";

const translations = {
  ja: {
    // Navigation
    "nav.dashboard": "ダッシュボード",
    "nav.profile": "プロフィール",
    "nav.trust": "信頼度",
    "nav.twins": "分身AI",
    "nav.chat": "チャット",
    "nav.analytics": "分析",
    "nav.discover": "発見",
    "nav.friends": "友達",
    "nav.matching": "マッチング",
    "nav.intimacy": "親密度",
    "nav.growth": "育成",
    "nav.line": "LINE連携",
    "nav.cards": "カード管理",
    "nav.plan": "プラン",
    "nav.more": "その他",
    "nav.menu": "メニュー",
    "nav.home": "ホーム",
    "nav.match": "マッチ",
    "nav.admin": "管理者",
    // Dashboard
    "dashboard.welcome": "おかえりなさい、",
    "dashboard.welcomeSuffix": "さん",
    "dashboard.subtitle": "分身AIの管理とビジネスマッチングを始めましょう",
    "dashboard.profileCompletion": "プロフィール完成度",
    "dashboard.editProfile": "プロフィールを編集",
    "dashboard.recentMatchings": "最近のマッチング",
    "dashboard.viewAll": "すべて見る",
    "dashboard.loginStreak": "日連続ログイン中",
    "dashboard.streak": "ストリーク",
    "dashboard.nextSteps": "次のステップ",
    "dashboard.pendingRequests": "件届いています",
    "dashboard.checkRequests": "確認する",
    // Twin
    "twin.manage": "管理",
    "twin.public": "公開中",
    "twin.private": "非公開",
    "twin.profileNotSet": "プロフィール未設定",
    "twin.notCreated": "未作成",
    "twin.created": "作成済み",
    // Actions
    "action.publishTwin": "分身AIを公開しよう",
    "action.publishDesc": "他のユーザーに発見してもらえるようになります",
    "action.addFriends": "友達を追加しよう",
    "action.addFriendsDesc": "フレンドコードで友達を見つけましょう",
    "action.tryMatching": "マッチングを試そう",
    "action.tryMatchingDesc": "友達の分身AIとビジネスマッチング",
    "action.chatTwin": "チャットで会話してみよう",
    "action.chatTwinDesc": "分身AIと会話して育てましょう",
    "action.chat": "チャット",
    "action.chatDesc": "分身AIと会話する",
    "action.matching": "マッチング",
    "action.matchingDesc": "新しいマッチングを作成",
    // Stats
    "stats.trust": "信頼度",
    "stats.twin": "分身AI",
    "stats.friends": "友達",
    "stats.chat": "チャット",
    "stats.matching": "マッチング",
    "stats.completed": "件完了",
    "stats.people": "人",
    "stats.items": "件",
    // Common
    "common.logout": "ログアウト",
    "common.loading": "読み込み中",
    "common.free": "フリー",
    "common.premium": "プレミアム",
    "common.enterprise": "エンタープライズ",
    "common.language": "言語",
    "common.japanese": "日本語",
    "common.english": "English",
    // Analytics
    "analytics.title": "分析ダッシュボード",
    "analytics.subtitle": "マッチング成功率とエンゲージメントの推移",
    "analytics.matchingCount": "マッチング数",
    "analytics.successRate": "成功率",
    "analytics.avgScore": "平均スコア",
    "analytics.messages": "メッセージ",
    "analytics.monthlyTrend": "月別マッチング数",
    "analytics.last6months": "過去6ヶ月の推移",
    "analytics.scoreDist": "スコア分布",
    "analytics.scoreDistDesc": "相性スコアの分布",
    "analytics.weeklyMessages": "週別メッセージ数",
    "analytics.weeklyDesc": "過去8週間のチャット活動",
    "analytics.engagement": "エンゲージメント",
    "analytics.friendCount": "友達数",
    "analytics.trustScore": "信頼スコア",
    "analytics.chatCount": "チャット数",
    "analytics.avgCompat": "平均相性",
    "analytics.noData": "データなし",
    "analytics.excellent": "優秀",
    "analytics.good": "良好",
    "analytics.fair": "普通",
    "analytics.low": "低い",
    "analytics.scoreAvgDesc": "相性スコア平均",
  },
  en: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.profile": "Profile",
    "nav.trust": "Trust Score",
    "nav.twins": "Digital Twin",
    "nav.chat": "Chat",
    "nav.analytics": "Analytics",
    "nav.discover": "Discover",
    "nav.friends": "Friends",
    "nav.matching": "Matching",
    "nav.intimacy": "Intimacy",
    "nav.growth": "Growth",
    "nav.line": "LINE Link",
    "nav.cards": "Cards",
    "nav.plan": "Plan",
    "nav.more": "More",
    "nav.menu": "Menu",
    "nav.home": "Home",
    "nav.match": "Match",
    "nav.admin": "Admin",
    // Dashboard
    "dashboard.welcome": "Welcome back, ",
    "dashboard.welcomeSuffix": "",
    "dashboard.subtitle": "Manage your Digital Twin AI and start business matching",
    "dashboard.profileCompletion": "Profile Completion",
    "dashboard.editProfile": "Edit Profile",
    "dashboard.recentMatchings": "Recent Matchings",
    "dashboard.viewAll": "View All",
    "dashboard.loginStreak": " day login streak",
    "dashboard.streak": "Streak",
    "dashboard.nextSteps": "Next Steps",
    "dashboard.pendingRequests": " pending",
    "dashboard.checkRequests": "Review",
    // Twin
    "twin.manage": "Manage",
    "twin.public": "Public",
    "twin.private": "Private",
    "twin.profileNotSet": "Profile not set",
    "twin.notCreated": "Not created",
    "twin.created": "Created",
    // Actions
    "action.publishTwin": "Publish Your Twin",
    "action.publishDesc": "Let other users discover you",
    "action.addFriends": "Add Friends",
    "action.addFriendsDesc": "Find friends with friend codes",
    "action.tryMatching": "Try Matching",
    "action.tryMatchingDesc": "Business match with friends' twins",
    "action.chatTwin": "Chat with Your Twin",
    "action.chatTwinDesc": "Talk with your twin to grow it",
    "action.chat": "Chat",
    "action.chatDesc": "Talk with your Digital Twin",
    "action.matching": "Matching",
    "action.matchingDesc": "Create a new matching",
    // Stats
    "stats.trust": "Trust",
    "stats.twin": "Digital Twin",
    "stats.friends": "Friends",
    "stats.chat": "Chat",
    "stats.matching": "Matching",
    "stats.completed": " completed",
    "stats.people": "",
    "stats.items": "",
    // Common
    "common.logout": "Logout",
    "common.loading": "Loading",
    "common.free": "Free",
    "common.premium": "Premium",
    "common.enterprise": "Enterprise",
    "common.language": "Language",
    "common.japanese": "日本語",
    "common.english": "English",
    // Analytics
    "analytics.title": "Analytics Dashboard",
    "analytics.subtitle": "Matching success rates and engagement trends",
    "analytics.matchingCount": "Matchings",
    "analytics.successRate": "Success Rate",
    "analytics.avgScore": "Avg Score",
    "analytics.messages": "Messages",
    "analytics.monthlyTrend": "Monthly Matchings",
    "analytics.last6months": "Last 6 months",
    "analytics.scoreDist": "Score Distribution",
    "analytics.scoreDistDesc": "Compatibility score distribution",
    "analytics.weeklyMessages": "Weekly Messages",
    "analytics.weeklyDesc": "Chat activity for the past 8 weeks",
    "analytics.engagement": "Engagement",
    "analytics.friendCount": "Friends",
    "analytics.trustScore": "Trust Score",
    "analytics.chatCount": "Chats",
    "analytics.avgCompat": "Avg Compat.",
    "analytics.noData": "No data",
    "analytics.excellent": "Excellent",
    "analytics.good": "Good",
    "analytics.fair": "Fair",
    "analytics.low": "Low",
    "analytics.scoreAvgDesc": "Average compatibility score",
  },
} as const;

type TranslationKey = keyof typeof translations.ja;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem("app-language");
    return (stored === "en" ? "en" : "ja") as Language;
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("app-language", lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[language][key] ?? key;
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useTranslation must be used within LanguageProvider");
  }
  return context;
}

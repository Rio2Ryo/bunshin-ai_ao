import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { PWAInstallPrompt } from "./components/PWAInstallPrompt";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

// Eagerly loaded (critical path)
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "@/pages/NotFound";

// Lazy loaded (dashboard & feature pages)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const Twins = lazy(() => import("./pages/Twins"));
const TwinDetail = lazy(() => import("./pages/TwinDetail"));
const Chat = lazy(() => import("./pages/Chat"));
const Matching = lazy(() => import("./pages/Matching"));
const MatchingSession = lazy(() => import("./pages/MatchingSession"));
const AIConfig = lazy(() => import("./pages/AIConfig"));
const Orchestration = lazy(() => import("./pages/Orchestration"));
const Friends = lazy(() => import("./pages/Friends"));
const Plan = lazy(() => import("./pages/Plan"));
const Discover = lazy(() => import("./pages/Discover"));
const Points = lazy(() => import("./pages/Points"));
const Quests = lazy(() => import("./pages/Quests"));
const Clawdbot = lazy(() => import("./pages/Clawdbot"));
const LearnedPersonality = lazy(() => import("./pages/LearnedPersonality"));
const AdminAIProvider = lazy(() => import("./pages/AdminAIProvider"));
const LineLink = lazy(() => import("./pages/LineLink"));
const Growth = lazy(() => import("./pages/Growth"));
const Cards = lazy(() => import("./pages/Cards"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const TrustScore = lazy(() => import("./pages/TrustScore"));
const Intimacy = lazy(() => import("./pages/Intimacy"));
const Analytics = lazy(() => import("./pages/Analytics"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));
const Terms = lazy(() => import("./pages/Terms"));
const Recommendations = lazy(() => import("./pages/Recommendations"));
const AdminReview = lazy(() => import("./pages/AdminReview"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Blog = lazy(() => import("./pages/Blog"));
const HealthDashboard = lazy(() => import("./pages/HealthDashboard"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const ComponentShowcase = lazy(() => import("./pages/ComponentShowcase"));
const Presentation = lazy(() => import("./pages/Presentation"));
const NanoBananaSlides = lazy(() => import("./pages/NanoBananaSlides"));
const PersonalityProfiler = lazy(() => import("./pages/PersonalityProfiler"));
const MatchingAnalytics = lazy(() => import("./pages/MatchingAnalytics"));
const GroupMatchingSession = lazy(() => import("./pages/GroupMatchingSession"));
const Scheduler = lazy(() => import("./pages/Scheduler"));
const MatchingReplay = lazy(() => import("./pages/MatchingReplay"));
const Mentor = lazy(() => import("./pages/Mentor"));
const Workspaces = lazy(() => import("./pages/Workspaces"));
const WorkspaceDetail = lazy(() => import("./pages/WorkspaceDetail"));
const ABTest = lazy(() => import("./pages/ABTest"));
const PredictionDashboard = lazy(() => import("./pages/PredictionDashboard"));
const ScenarioBuilder = lazy(() => import("./pages/ScenarioBuilder"));
const Tournament = lazy(() => import("./pages/Tournament"));
const Feed = lazy(() => import("./pages/Feed"));
const SkillTree = lazy(() => import("./pages/SkillTree"));
const NotificationDashboard = lazy(() => import("./pages/NotificationDashboard"));
const MatchingInsights = lazy(() => import("./pages/MatchingInsights"));
const NegotiationSimulator = lazy(() => import("./pages/NegotiationSimulator"));
const EmotionDashboard = lazy(() => import("./pages/EmotionDashboard"));
const TwinEvolution = lazy(() => import("./pages/TwinEvolution"));
const Challenges = lazy(() => import("./pages/Challenges"));
const StrategyPlanner = lazy(() => import("./pages/StrategyPlanner"));
const TwinCollaboration = lazy(() => import("./pages/TwinCollaboration"));
const OutcomeTracker = lazy(() => import("./pages/OutcomeTracker"));
const QualityScorecard = lazy(() => import("./pages/QualityScorecard"));
const KnowledgeGraph = lazy(() => import("./pages/KnowledgeGraph"));
const MatchingDigest = lazy(() => import("./pages/MatchingDigest"));
const PlaybookLibrary = lazy(() => import("./pages/PlaybookLibrary"));
const ConversationStyleAnalysis = lazy(() => import("./pages/ConversationStyleAnalysis"));
const MatchingNetwork = lazy(() => import("./pages/MatchingNetwork"));
const TwinMemoryBank = lazy(() => import("./pages/TwinMemoryBank"));
const ScenarioComparison = lazy(() => import("./pages/ScenarioComparison"));
const CustomWidgets = lazy(() => import("./pages/CustomWidgets"));
const MatchingMinutes = lazy(() => import("./pages/MatchingMinutes"));
const TwinVersionManager = lazy(() => import("./pages/TwinVersionManager"));
const VoiceReplay = lazy(() => import("./pages/VoiceReplay"));
const ROIDashboard = lazy(() => import("./pages/ROIDashboard"));
const TwinCoaching = lazy(() => import("./pages/TwinCoaching"));
const MatchingCalendar = lazy(() => import("./pages/MatchingCalendar"));
const SandboxSimulation = lazy(() => import("./pages/SandboxSimulation"));
const PeerReview = lazy(() => import("./pages/PeerReview"));
const TwinBenchmark = lazy(() => import("./pages/TwinBenchmark"));
const DebateMode = lazy(() => import("./pages/DebateMode"));
const EmotionJournal = lazy(() => import("./pages/EmotionJournal"));
const CommunityEvents = lazy(() => import("./pages/CommunityEvents"));
const ReplayCommentary = lazy(() => import("./pages/ReplayCommentary"));
const TwinGoals = lazy(() => import("./pages/TwinGoals"));
const MatchingHeatmap = lazy(() => import("./pages/MatchingHeatmap"));
const MatchingStoryboard = lazy(() => import("./pages/MatchingStoryboard"));
const KnowledgeQuiz = lazy(() => import("./pages/KnowledgeQuiz"));
const AIFacilitator = lazy(() => import("./pages/AIFacilitator"));
const PersonaABTest = lazy(() => import("./pages/PersonaABTest"));
const SessionTags = lazy(() => import("./pages/SessionTags"));
const WeeklyReview = lazy(() => import("./pages/WeeklyReview"));
const ThemeRecommender = lazy(() => import("./pages/ThemeRecommender"));
const DialogueStyleLearning = lazy(() => import("./pages/DialogueStyleLearning"));
const SuccessPatterns = lazy(() => import("./pages/SuccessPatterns"));
const InteractiveScenario = lazy(() => import("./pages/InteractiveScenario"));
const PersonalityReport = lazy(() => import("./pages/PersonalityReport"));
const TranslationChat = lazy(() => import("./pages/TranslationChat"));
const MatchingSummary = lazy(() => import("./pages/MatchingSummary"));
const ContextSwitcher = lazy(() => import("./pages/ContextSwitcher"));
const ComparisonTimeline = lazy(() => import("./pages/ComparisonTimeline"));
const LearningCurriculum = lazy(() => import("./pages/LearningCurriculum"));
const EmotionFlow = lazy(() => import("./pages/EmotionFlow"));
const ExternalConnectors = lazy(() => import("./pages/ExternalConnectors"));
const MultiPerspective = lazy(() => import("./pages/MultiPerspective"));
const LearningJournal = lazy(() => import("./pages/LearningJournal"));
const TeamBattle = lazy(() => import("./pages/TeamBattle"));
const RiskAssessment = lazy(() => import("./pages/RiskAssessment"));
const RoleplayTraining = lazy(() => import("./pages/RoleplayTraining"));
const ImpactMap = lazy(() => import("./pages/ImpactMap"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen" role="status" aria-label="読み込み中">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/lp" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/verify-email" component={VerifyEmail} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/profile" component={Profile} />
        <Route path="/twins" component={Twins} />
        <Route path="/twins/:id" component={TwinDetail} />
        <Route path="/chat" component={Chat} />
        <Route path="/chat/:sessionId" component={Chat} />
        <Route path="/matching" component={Matching} />
        <Route path="/matching/analytics" component={MatchingAnalytics} />
        <Route path="/matching/group/:id" component={GroupMatchingSession} />
        <Route path="/matching/replay/:id" component={MatchingReplay} />
        <Route path="/matching/insights" component={MatchingInsights} />
        <Route path="/matching/:id" component={MatchingSession} />
        <Route path="/ai-config" component={AIConfig} />
        <Route path="/orchestration" component={Orchestration} />
        <Route path="/friends" component={Friends} />
        <Route path="/plan" component={Plan} />
        <Route path="/discover" component={Discover} />
        <Route path="/points" component={Points} />
        <Route path="/quests" component={Quests} />
        <Route path="/clawdbot" component={Clawdbot} />
        <Route path="/learned-personality" component={LearnedPersonality} />
        <Route path="/line-link" component={LineLink} />
        <Route path="/growth" component={Growth} />
        <Route path="/cards" component={Cards} />
        <Route path="/trust" component={TrustScore} />
        <Route path="/intimacy" component={Intimacy} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/admin/ai-provider" component={AdminAIProvider} />
        <Route path="/admin/review" component={AdminReview} />
        <Route path="/admin/analytics" component={AdminAnalytics} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/terms" component={Terms} />
        <Route path="/recommendations" component={Recommendations} />
        <Route path="/marketplace" component={Marketplace} />
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/blog" component={Blog} />
        <Route path="/health-dashboard" component={HealthDashboard} />
        <Route path="/users/:id" component={UserProfile} />
        <Route path="/presentation/:id" component={Presentation} />
        <Route path="/slides/:id" component={NanoBananaSlides} />
        <Route path="/personality" component={PersonalityProfiler} />
        <Route path="/dev/showcase" component={ComponentShowcase} />

        <Route path="/scheduler" component={Scheduler} />
        <Route path="/mentor" component={Mentor} />
        <Route path="/workspaces" component={Workspaces} />
        <Route path="/workspaces/:id" component={WorkspaceDetail} />
        <Route path="/ab-test" component={ABTest} />
        <Route path="/predictions" component={PredictionDashboard} />
        <Route path="/scenarios" component={ScenarioBuilder} />
        <Route path="/tournament" component={Tournament} />
        <Route path="/tournament/:id" component={Tournament} />
        <Route path="/feed" component={Feed} />
        <Route path="/skill-tree" component={SkillTree} />
        <Route path="/notifications" component={NotificationDashboard} />
        <Route path="/negotiation" component={NegotiationSimulator} />
        <Route path="/emotions" component={EmotionDashboard} />
        <Route path="/evolution" component={TwinEvolution} />
        <Route path="/challenges" component={Challenges} />
        <Route path="/strategy" component={StrategyPlanner} />
        <Route path="/collaboration" component={TwinCollaboration} />
        <Route path="/outcomes" component={OutcomeTracker} />
        <Route path="/quality" component={QualityScorecard} />
        <Route path="/knowledge-graph" component={KnowledgeGraph} />
        <Route path="/digest" component={MatchingDigest} />
        <Route path="/playbooks" component={PlaybookLibrary} />
        <Route path="/conversation-style" component={ConversationStyleAnalysis} />
        <Route path="/network" component={MatchingNetwork} />
        <Route path="/memory-bank" component={TwinMemoryBank} />
        <Route path="/scenario-compare" component={ScenarioComparison} />
        <Route path="/widgets" component={CustomWidgets} />
        <Route path="/minutes" component={MatchingMinutes} />
        <Route path="/versions" component={TwinVersionManager} />
        <Route path="/voice-replay" component={VoiceReplay} />
        <Route path="/roi" component={ROIDashboard} />
        <Route path="/coaching" component={TwinCoaching} />
        <Route path="/calendar" component={MatchingCalendar} />
        <Route path="/sandbox" component={SandboxSimulation} />
        <Route path="/peer-review" component={PeerReview} />
        <Route path="/benchmark" component={TwinBenchmark} />
        <Route path="/debate" component={DebateMode} />
        <Route path="/emotion-journal" component={EmotionJournal} />
        <Route path="/events" component={CommunityEvents} />
        <Route path="/replay-commentary" component={ReplayCommentary} />
        <Route path="/goals" component={TwinGoals} />
        <Route path="/heatmap" component={MatchingHeatmap} />
        <Route path="/storyboard" component={MatchingStoryboard} />
        <Route path="/quiz" component={KnowledgeQuiz} />
        <Route path="/facilitator" component={AIFacilitator} />
        <Route path="/persona-ab-test" component={PersonaABTest} />
        <Route path="/session-tags" component={SessionTags} />
        <Route path="/weekly-review" component={WeeklyReview} />
        <Route path="/theme-recommender" component={ThemeRecommender} />
        <Route path="/dialogue-style" component={DialogueStyleLearning} />
        <Route path="/success-patterns" component={SuccessPatterns} />
        <Route path="/interactive-scenario" component={InteractiveScenario} />
        <Route path="/personality-report" component={PersonalityReport} />
        <Route path="/translation-chat" component={TranslationChat} />
        <Route path="/matching-summary" component={MatchingSummary} />
        <Route path="/context-switcher" component={ContextSwitcher} />
        <Route path="/comparison-timeline" component={ComparisonTimeline} />
        <Route path="/learning-curriculum" component={LearningCurriculum} />
        <Route path="/emotion-flow" component={EmotionFlow} />
        <Route path="/external-connectors" component={ExternalConnectors} />
        <Route path="/multi-perspective" component={MultiPerspective} />
        <Route path="/learning-journal" component={LearningJournal} />
        <Route path="/team-battle" component={TeamBattle} />
        <Route path="/risk-assessment" component={RiskAssessment} />
        <Route path="/roleplay-training" component={RoleplayTraining} />
        <Route path="/impact-map" component={ImpactMap} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg">メインコンテンツへスキップ</a>
      <OfflineIndicator />
      <ThemeProvider defaultTheme="dark">
        <LanguageProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
            <PWAInstallPrompt />
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

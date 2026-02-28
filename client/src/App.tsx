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
        <Route path="/dev/showcase" component={ComponentShowcase} />

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

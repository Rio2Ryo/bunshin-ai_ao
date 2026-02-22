import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PWAInstallPrompt } from "./components/PWAInstallPrompt";
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
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
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
        <Route path="/admin/ai-provider" component={AdminAIProvider} />

        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
          <PWAInstallPrompt />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

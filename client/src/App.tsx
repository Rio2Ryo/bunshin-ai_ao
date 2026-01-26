import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Twins from "./pages/Twins";
import TwinDetail from "./pages/TwinDetail";
import Chat from "./pages/Chat";
import Matching from "./pages/Matching";
import MatchingSession from "./pages/MatchingSession";
import AIConfig from "./pages/AIConfig";
import Orchestration from "./pages/Orchestration";
import Friends from "./pages/Friends";
import Plan from "./pages/Plan";
import Discover from "./pages/Discover";
import Points from "./pages/Points";
import Quests from "./pages/Quests";
import Clawdbot from "./pages/Clawdbot";
import LearnedPersonality from "./pages/LearnedPersonality";
import AdminAIProvider from "./pages/AdminAIProvider";
import LineLink from "./pages/LineLink";
import Cards from "./pages/Cards";
import CardDetail from "./pages/CardDetail";
import CardCreate from "./pages/CardCreate";
import MyCards from "./pages/MyCards";
import CardGet from "./pages/CardGet";
import { PWAInstallPrompt } from "./components/PWAInstallPrompt";


function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
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
      <Route path="/cards" component={Cards} />
      <Route path="/cards/:id" component={CardDetail} />
      <Route path="/cards/create" component={CardCreate} />
      <Route path="/cards/my" component={MyCards} />
      <Route path="/card/get/:code" component={CardGet} />
      <Route path="/admin/ai-provider" component={AdminAIProvider} />

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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

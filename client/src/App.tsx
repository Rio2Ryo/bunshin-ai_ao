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
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

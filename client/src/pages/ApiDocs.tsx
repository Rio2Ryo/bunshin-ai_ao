import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useState, useMemo } from "react";
import { Search, BookOpen, ChevronDown, ChevronRight } from "lucide-react";

type Endpoint = {
  name: string;
  type: "query" | "mutation";
  description: string;
  input?: string;
  output?: string;
};

type EndpointGroup = {
  name: string;
  description: string;
  endpoints: Endpoint[];
};

const apiGroups: EndpointGroup[] = [
  {
    name: "auth",
    description: "Authentication & session management",
    endpoints: [
      { name: "register", type: "mutation", description: "Register a new user account", input: "{ email: string, password: string, name: string }", output: "{ id: number, email: string, name: string }" },
      { name: "login", type: "mutation", description: "Login with email and password", input: "{ email: string, password: string }", output: "{ id: number, email: string, name: string }" },
      { name: "me", type: "query", description: "Get current authenticated user", output: "{ id: number, name: string, email: string, role: string, ... }" },
      { name: "logout", type: "mutation", description: "Logout and clear session cookie" },
    ],
  },
  {
    name: "profile",
    description: "User profile management",
    endpoints: [
      { name: "get", type: "query", description: "Get current user's profile", output: "{ displayName, bio, company, industry, position, skills, expertise, experience, ... }" },
      { name: "update", type: "mutation", description: "Update profile fields", input: "{ displayName?, bio?, company?, industry?, position?, skills?, expertise?, experience? }" },
    ],
  },
  {
    name: "myTwin",
    description: "Digital Twin AI management",
    endpoints: [
      { name: "get", type: "query", description: "Get user's digital twin", output: "{ id, name, description, personality, isPublic, tags, bigFiveTraits, ... }" },
      { name: "update", type: "mutation", description: "Update twin properties", input: "{ name?, description?, personality?, isPublic?, tags?, ... }" },
    ],
  },
  {
    name: "friends",
    description: "Friendship management",
    endpoints: [
      { name: "list", type: "query", description: "List all accepted friends with their twins" },
      { name: "pendingRequests", type: "query", description: "Get incoming friend requests" },
      { name: "sentRequests", type: "query", description: "Get outgoing friend requests" },
      { name: "searchUsers", type: "query", description: "Search users by name or friend code", input: "{ query: string }" },
      { name: "sendRequest", type: "mutation", description: "Send a friend request", input: "{ friendCode: string }" },
      { name: "acceptRequest", type: "mutation", description: "Accept a friend request", input: "{ friendshipId: number }" },
      { name: "rejectRequest", type: "mutation", description: "Reject a friend request", input: "{ friendshipId: number }" },
      { name: "removeFriend", type: "mutation", description: "Remove a friend", input: "{ friendId: number }" },
    ],
  },
  {
    name: "chat",
    description: "AI chat sessions & messages",
    endpoints: [
      { name: "sessions", type: "query", description: "List all chat sessions" },
      { name: "getSession", type: "query", description: "Get a chat session with messages", input: "{ id: number, limit?, offset? }" },
      { name: "createSession", type: "mutation", description: "Create a new chat session", input: "{ title?: string }" },
      { name: "sendMessage", type: "mutation", description: "Send a message and get AI response", input: "{ sessionId: number, content: string }" },
      { name: "deleteSession", type: "mutation", description: "Delete a chat session", input: "{ id: number }" },
      { name: "renameSession", type: "mutation", description: "Rename a chat session", input: "{ id: number, title: string }" },
    ],
  },
  {
    name: "matching",
    description: "Business matching between digital twins",
    endpoints: [
      { name: "sessions", type: "query", description: "List all matching sessions with results" },
      { name: "getSession", type: "query", description: "Get matching session details, dialogues, and results", input: "{ id: number }" },
      { name: "create", type: "mutation", description: "Create a new matching session (triggers AI dialogue)", input: "{ friendId: number, theme: string, turns?: number }" },
      { name: "availableFriends", type: "query", description: "Get friends available for matching (with twins)" },
      { name: "suggestedCandidates", type: "query", description: "Get ranked matching candidates with scores" },
      { name: "webSearch", type: "mutation", description: "Run a Tavily web search", input: "{ query: string, sessionId?: number }" },
      { name: "receivedRequests", type: "query", description: "Get received matching requests" },
      { name: "sentRequests", type: "query", description: "Get sent matching requests" },
      { name: "sendRequest", type: "mutation", description: "Send a matching request", input: "{ friendId: number, theme?: string }" },
      { name: "acceptRequest", type: "mutation", description: "Accept a matching request", input: "{ id: number }" },
      { name: "rejectRequest", type: "mutation", description: "Reject a matching request", input: "{ id: number }" },
      { name: "runDialogue", type: "mutation", description: "Run AI dialogue between matched twins", input: "{ sessionId: number }" },
      { name: "analyze", type: "mutation", description: "Analyze matching session results", input: "{ sessionId: number }" },
    ],
  },
  {
    name: "onboarding",
    description: "New user onboarding flow",
    endpoints: [
      { name: "getStatus", type: "query", description: "Check onboarding completion status" },
      { name: "getSession", type: "query", description: "Get onboarding chat session" },
      { name: "complete", type: "mutation", description: "Complete onboarding and finalize twin profile", input: "{ description?, personality?, rawInput? }" },
    ],
  },
  {
    name: "trust",
    description: "Trust score system",
    endpoints: [
      { name: "getScore", type: "query", description: "Get current trust score and rank" },
      { name: "getHistory", type: "query", description: "Get trust score action history" },
    ],
  },
  {
    name: "plan",
    description: "Subscription plans",
    endpoints: [
      { name: "getInfo", type: "query", description: "Get current plan information and limits" },
    ],
  },
  {
    name: "discover",
    description: "Public twin discovery",
    endpoints: [
      { name: "publicTwins", type: "query", description: "List publicly visible digital twins" },
    ],
  },
  {
    name: "analytics",
    description: "Analytics & reporting",
    endpoints: [
      { name: "dashboard", type: "query", description: "Get analytics dashboard data (matching stats, trends, engagement)" },
    ],
  },
  {
    name: "scheduler",
    description: "Auto-matching scheduler",
    endpoints: [
      { name: "list", type: "query", description: "List all matching schedules" },
      { name: "create", type: "mutation", description: "Create an auto-matching schedule", input: "{ friendId: number, frequency: 'daily'|'weekly', theme?: string, turns?: number }" },
      { name: "update", type: "mutation", description: "Update a schedule", input: "{ id: number, isActive?: boolean, frequency?, theme?, turns? }" },
      { name: "delete", type: "mutation", description: "Delete a schedule", input: "{ id: number }" },
    ],
  },
  {
    name: "notifications",
    description: "Notification settings",
    endpoints: [
      { name: "getSettings", type: "query", description: "Get notification preferences" },
      { name: "updateSettings", type: "mutation", description: "Update notification preferences", input: "{ slackWebhookUrl?, lineNotify?, matchingComplete?, scheduledMatching? }" },
    ],
  },
  {
    name: "points",
    description: "Points & rewards system",
    endpoints: [
      { name: "balance", type: "query", description: "Get current point balance" },
      { name: "transactions", type: "query", description: "Get point transaction history" },
      { name: "settings", type: "query", description: "Get point system settings" },
      { name: "earn", type: "mutation", description: "Earn points for an action", input: "{ action: string }" },
    ],
  },
  {
    name: "quests",
    description: "Quest system",
    endpoints: [
      { name: "list", type: "query", description: "Get available quests and completion status" },
      { name: "complete", type: "mutation", description: "Mark a quest as completed", input: "{ questId: string }" },
    ],
  },
];

export default function ApiDocs() {
  usePageMeta({ title: "API ドキュメント", description: "tRPC APIエンドポイント一覧", path: "/api-docs" });
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(apiGroups.map(g => g.name)));

  const filtered = useMemo(() => {
    if (!search.trim()) return apiGroups;
    const q = search.toLowerCase();
    return apiGroups
      .map(group => ({
        ...group,
        endpoints: group.endpoints.filter(
          ep => ep.name.toLowerCase().includes(q) || ep.description.toLowerCase().includes(q) || group.name.toLowerCase().includes(q)
        ),
      }))
      .filter(group => group.endpoints.length > 0);
  }, [search]);

  const toggleGroup = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalEndpoints = apiGroups.reduce((sum, g) => sum + g.endpoints.length, 0);
  const queryCount = apiGroups.reduce((sum, g) => sum + g.endpoints.filter(e => e.type === "query").length, 0);
  const mutationCount = totalEndpoints - queryCount;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            API ドキュメント
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            tRPC エンドポイント一覧 &middot; {totalEndpoints} endpoints ({queryCount} queries, {mutationCount} mutations)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search endpoints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="secondary">{filtered.reduce((s, g) => s + g.endpoints.length, 0)} results</Badge>
        </div>

        <div className="space-y-4">
          {filtered.map(group => (
            <Card key={group.name}>
              <CardHeader
                className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
                onClick={() => toggleGroup(group.name)}
              >
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expanded.has(group.name) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <code className="text-primary">{group.name}</code>
                    <span className="text-muted-foreground font-normal text-sm">— {group.description}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">{group.endpoints.length}</Badge>
                </CardTitle>
              </CardHeader>
              {expanded.has(group.name) && (
                <CardContent className="pt-0">
                  <div className="divide-y">
                    {group.endpoints.map(ep => (
                      <div key={ep.name} className="py-3 first:pt-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={ep.type === "query" ? "secondary" : "default"} className="text-[10px] font-mono px-1.5 py-0">
                            {ep.type}
                          </Badge>
                          <code className="text-sm font-semibold">{group.name}.{ep.name}</code>
                        </div>
                        <p className="text-sm text-muted-foreground">{ep.description}</p>
                        {ep.input && (
                          <div className="mt-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Input: </span>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{ep.input}</code>
                          </div>
                        )}
                        {ep.output && (
                          <div className="mt-1">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Output: </span>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{ep.output}</code>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

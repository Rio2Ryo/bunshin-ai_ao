# Bunshin AI (分身AI) - Project Memory

## Project Overview
Digital twin AI system where users create AI replicas of themselves for business matching.
Deployed on Cloudflare Workers + D1 (SQLite) + R2, with React frontend on Cloudflare Pages.

## Architecture
- **Frontend**: React 19 + wouter + Radix UI + TanStack React Query + tRPC client
  - Hosted on Cloudflare Pages: https://bunshin-ai.pages.dev
  - Build: `npx vite build` from project root → `dist/public/`
- **API (Active)**: Cloudflare Worker with Hono + tRPC v11
  - URL: https://bunshin-ai-api.common-gifted-tokyo.workers.dev
  - DB: Cloudflare D1 (SQLite) - database_id: 2d1ebbfb-5c34-48be-a48e-bb0fac6c676d
  - Storage: Cloudflare R2 bucket "bunshin-ai-assets"
- **API (Legacy)**: Express + MySQL (server/ directory) - NOT actively deployed
  - Has rich LINE integration, Clawdbot gateway, AI services
  - Uses Drizzle ORM with MySQL2
- **Auth**: Email/password + JWT cookie sessions (jose library, PBKDF2 password hashing)
  - JWT_SECRET stored as CF Worker secret
  - Login/Register pages at /login and /register
  - Cookie: app_session_id (HttpOnly, SameSite=None; Secure)
- **LLM (Server-side)**: Azure AI Foundry → Kimi-K2.5
  - Fallback when users have no personal API keys configured
  - Env: AZURE_FOUNDRY_API_KEY, AZURE_FOUNDRY_RESOURCE (wrangler secrets + .dev.vars)
  - Resource: goto-m5s4tqgq-eastus2

## Key Files
- `worker/src/index.ts` - Full tRPC router for CF Worker (all API endpoints)
- `worker/src/db-helpers.ts` - D1 schema, migrations, helpers
- `worker/src/llm.ts` - Multi-provider LLM invocation (OpenAI, Gemini, Anthropic, Grok, Azure Foundry)
- `client/src/pages/Onboarding.tsx` - Fullscreen onboarding chat UI
- `worker/vitest.config.ts` - Test config (use `--config worker/vitest.config.ts`)
- `client/src/App.tsx` - React router with all page routes
- `client/src/lib/trpc.ts` - tRPC client setup (imports AppRouter from worker)
- `client/src/_core/hooks/useAuth.ts` - Auth hook with JWT session
- `client/src/components/DashboardLayout.tsx` - Main layout with sidebar + auth guard
- `client/src/pages/Login.tsx` - Login page
- `client/src/pages/Register.tsx` - Registration page
- `wrangler.toml` - Worker deployment config
- `server/` - Legacy Express server (LINE webhook, Clawdbot, AI services)

## Database Tables (D1)
users (with passwordHash, onboardingCompleted), user_profiles, digital_twins, friendships, knowledge_base,
uploaded_files, ai_api_configs, orchestration_roles, chat_sessions, chat_messages,
matching_sessions, matching_dialogues, matching_results, usage_tracking, cards (chat_sessions has mode column),
line_connections, clawdbot_connections, conversation_learning, twin_growth_status,
value_scenario_responses, cumulative_waveforms, other_perspective_waveforms,
intimacy_scores, user_points, point_transactions, redeemable_products,
point_redemptions, point_settings, twin_skill_levels, twin_milestones,
ai_provider_settings

## Deployment Commands
- Worker: `CLOUDFLARE_API_TOKEN=wgB-VVtf_DgceGCy61enSNIlzXXdbX7yiYoysX68 npx wrangler deploy --config wrangler.toml`
- Client: `npx vite build && CLOUDFLARE_API_TOKEN=wgB-VVtf_DgceGCy61enSNIlzXXdbX7yiYoysX68 npx wrangler pages deploy dist/public --project-name bunshin-ai`
- Tests: `npx vitest run --config worker/vitest.config.ts` (requires `wrangler dev` running on :8787)
- Secrets: `echo "value" | CLOUDFLARE_API_TOKEN=... npx wrangler secret put KEY --config wrangler.toml`

## Cloudflare API Token
wgB-VVtf_DgceGCy61enSNIlzXXdbX7yiYoysX68

## Test Status (as of 2026-02-22)
- Worker integration: 94/94 passed (includes auth tests)
- Production E2E auth: register, login, auth.me, wrong-password, duplicate-register all verified

## Critical Fix (2026-02-22)
- **SameSite cookie**: Changed from `SameSite=Lax` to `SameSite=None; Secure` for cross-domain auth
  - Frontend (bunshin-ai.pages.dev) and API (workers.dev) are different domains
  - `SameSite=Lax` cookies are NOT sent with cross-origin AJAX requests
  - Both set-session and logout endpoints updated

## Implemented Features (Session 2026-02-22)
1. **Authentication**: Email/password registration + login with JWT sessions
   - auth.register, auth.login, auth.me, auth.logout
   - /api/auth/set-session (cookie setter), /api/auth/logout (cookie clearer)
   - protectedProcedure middleware (not yet applied to all routes)
2. **LLM Chat**: chat.sendMessage now calls real LLM APIs
   - Uses user's stored API key from ai_api_configs table
   - Falls back to Azure AI Foundry (Kimi-K2.5) server-side key if no user key
   - Builds system prompt from twin personality/description + user profile
   - Sends conversation history (last 20 messages)
   - Onboarding sessions use twin's systemPrompt (onboarding guide)
3. **Matching AI**: matching.create generates real dialogue + analysis
   - Twin-to-twin dialogue (configurable turns, default 5)
   - After dialogue: LLM analysis → matching_results with scores, breakdown, recommendations
   - Full scoreBreakdown (5 dimensions × 20 points each)
4. **AI Onboarding (Session 2026-02-22)**
   - Registration auto-creates: Twin + onboarding chat session + welcome message
   - Fullscreen onboarding chat UI at /onboarding (no sidebar)
   - AI guide (Kimi-K2.5) collects user info in 5 steps via natural conversation
   - Detects ---PROFILE_DATA--- in AI response → auto-updates Twin profile
   - onboarding.complete sets onboardingCompleted=1, clears onboarding systemPrompt
   - Login redirects: onboardingCompleted=0 → /onboarding, =1 → /dashboard
   - Scripted fallback responses if no LLM key available
   - tRPC routes: onboarding.getStatus, onboarding.getSession, onboarding.complete
5. **Dashboard Reorganization (Session 2026-02-22)**
   - Sidebar: 17 flat items → 3 groups (メイン, つながる, もっと) + admin section
   - Hidden from regular users: AI API設定, オーケストレーション, Clawdbot連携, プロフィール, 学習した人格
   - Dashboard: state-based action cards (twin public?, friends?, matchings?)
   - Compact twin status card, mini stats row

## Remaining Stubs
- clawdbot.sendMessage/testConnection: Stubs
- stripe/plan: No payment integration
- cards.uploadImage/analyzeImage: Stubs
- files.upload: DB record only, no R2 write
- LINE: Worker has no LINE integration (only server/ has it)

## User Language
Primary language: Japanese (日本語). All UI text is in Japanese.

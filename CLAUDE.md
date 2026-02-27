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
- Worker: `CLOUDFLARE_API_TOKEN=$CF_TOKEN npx wrangler deploy --config wrangler.toml`
- Client: `npx vite build && CLOUDFLARE_API_TOKEN=$CF_TOKEN npx wrangler pages deploy dist/public --project-name bunshin-ai`
- Tests: `npx vitest run --config worker/vitest.config.ts` (requires `wrangler dev` running on :8787)
- Secrets: `echo "value" | CLOUDFLARE_API_TOKEN=$CF_TOKEN npx wrangler secret put KEY --config wrangler.toml`
- CF_TOKEN is stored in `.dev.vars` (gitignored) or set as environment variable

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

## Implemented Features (Session 2026-02-22 continued)
6. **Personality Interviews (LLM-powered)**
   - personalityInterview: Big Five diagnosis via conversational AI (7 questions)
   - mbtiInterview: MBTI diagnosis via conversational AI (10 questions)
   - valueScenarioInterview: 18 value scenario evaluations via AI conversation
   - analyzeBigFive: LLM analysis of profile data → Big Five traits
   - analyzeJudgmentThresholds: LLM analysis of decision patterns
   - runFullAnalysis: Comprehensive personality analysis
7. **Waveform & Compatibility**
   - generateSelfWaveform: Compute waveform from scenario responses
   - evaluateWaveform: LLM evaluation of unevaluated responses
   - refreshCumulativeWaveform: Recompute from all evaluated responses
   - evaluateByAllTwins: Friends' twins evaluate user's responses
   - calculateAccuracy: Compare self vs others' perspective waveforms
   - getWaveformCompatibility: Real waveform comparison between friends
   - getAllWaveformCompatibilities: Batch compatibility check with all friends
8. **Intimacy System**
   - getIntimacy: Calculate intimacy score from matching interactions
   - updateIntimacy: Upsert intimacy scores to DB
   - getAllIntimacyScores: List all intimacy scores
   - requestPredictions: LLM-powered friend prediction generation
   - updateOtherPerspectiveWaveform: Calculate self-report gap
9. **Clawdbot Integration (real proxy)**
   - testConnection: Actual HTTP health check to gateway URL
   - sendMessage: Real proxy to Clawdbot gateway API
   - syncConversations: Fetch conversations from gateway → knowledge base
   - analyzePersonality: LLM analysis of synced conversation data
10. **Cards & Files (already implemented)**
    - cards.uploadImage: R2 upload for card images
    - cards.analyzeImage: Vision API OCR (OpenAI gpt-4o / Gemini)
    - files.upload: R2 upload with DB record

## Implemented SaaS Features (2026-02-26)
- **Stripe Billing**: Checkout Sessions (monthly/yearly), Customer Portal, Webhook with HMAC verification
  - plan.createCheckoutSession, plan.createPortalSession, plan.getSubscription, plan.cancelSubscription
  - /api/stripe/webhook with STRIPE_WEBHOOK_SECRET HMAC-SHA256 signature verification
  - Events: checkout.session.completed, customer.subscription.deleted/updated
  - Plans: free / premium (¥1,480/月) / enterprise (¥4,980/月)
  - Plan limits enforced: maxFriends (friends.sendRequest), chatMessagesPerDay (chat.sendMessage), matchingsPerMonth (matching.create), monthly reset (cron)
- **Points System**: Full redeem flow (points.redeemProduct) with balance, stock, transactions
- **CORS**: Whitelist restricted to bunshin-ai.pages.dev + localhost dev
- **CSP Headers**: Content-Security-Policy, X-Frame-Options, HSTS, Referrer-Policy
- **Health Check**: /api/health (DB/R2/LLM checks), /api/health/detailed (admin)
- **Notifications**: In-app (notification.list/markRead/markAllRead) + Slack + LINE push
  - Wired into: matching complete, friend requests, matching requests
- **Landing Page**: Hero, features, pricing, testimonials, CTA, footer
- **LINE Webhook**: Worker has LINE webhook handler with signature verification

## Password Reset (2026-02-26)
- auth.requestPasswordReset: Generates secure token (1-hour expiry), sends email via Resend API if configured
- auth.resetPassword: Verifies token, updates password hash
- UI: /forgot-password (enter email) + /reset-password?token=xxx (set new password)
- Login page has "パスワードを忘れた？" link
- Email enumeration prevention (always returns success)
- Token invalidation on use + cascade cleanup on account deletion
- Env vars: RESEND_API_KEY, RESEND_FROM_EMAIL, FRONTEND_URL (all optional)

## Profile Avatar Upload (2026-02-27)
- profile.uploadAvatar: Base64 image → R2 storage (avatars/ prefix), max 2MB, JPG/PNG/WebP
- avatarUrl column added to user_profiles via migration
- auth.me includes avatarUrl for all authenticated requests
- Profile page: hover-to-upload avatar with Camera icon, inline preview
- DashboardLayout: sidebar + header avatar shows uploaded image (AvatarImage fallback to initials)
- Trust points: +5 for first avatar upload (profile_field_avatar)
- Preview card shows avatar alongside name/company

## Knowledge Base Integration (2026-02-27)
- **Knowledge Base UI**: Twins page now has full knowledge management section
  - Add manual text entries (title + content) via form
  - Upload text files (.txt, .md, .csv, .json, max 500KB) → parsed and stored
  - List all entries with source type badges, summaries, dates
  - Delete individual entries with ownership check
- **Chat integration**: chat.sendMessage system prompt now includes top 8 knowledge entries
  - Title + summary/content (up to 500 chars per entry) appended to system prompt
  - Enables twin to answer questions using user's uploaded knowledge
- **Matching integration**: matching.create dialogue now includes top 5 knowledge entries per twin
  - Knowledge context injected into each twin's dialogue system prompt
  - Enables more informed business discussions based on real expertise
- Backend: knowledge.list, knowledge.add (manual/upload), knowledge.delete already existed

## User Public Profile Page (2026-02-27)
- New page at `/users/:id` showing other users' public profiles
- Displays: avatar, display name, company, position, industry, bio, experience, skills, expertise
- Shows trust score badge with rank (beginner/bronze/silver/gold/platinum/diamond)
- Shows twin info (name, description, tags) if available
- Action buttons: 友達になる / マッチングを開始 / チャットへ
- `profile.getPublic` endpoint enhanced: now returns avatarUrl, experience, trustRank, userName
- Linked from:
  - Discover page: "プロフィールを見る" button in twin detail dialog
  - Friends page: clickable friend names → /users/:friendId (NPC friends excluded)
  - Matching page: clickable candidate names → /users/:userId
- Route: `/users/:id` in App.tsx (lazy-loaded)

## Remaining Limitations
- PPTX export: Not supported on CF Workers (returns informational message)
- LINE: Full bidirectional LINE bot is in server/ (legacy Express), worker only has push + webhook

## User Language
Primary language: Japanese (日本語). All UI text is in Japanese.

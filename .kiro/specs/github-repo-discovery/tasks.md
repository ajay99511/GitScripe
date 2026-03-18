# Implementation Tasks: GitHub Repo Discovery

## Overview

Two phases: backend (connector methods, Zod schemas, Fastify routes, server wiring) then frontend (React 18 + Vite SPA enhanced as a PWA, with an optional Tauri 2.0 desktop shell).

## Tasks

- [x] 1. Extend GitHubConnector with discovery methods
  - Add `AccessibleRepo` and `RepoMetadata` interfaces to `src/connectors/GitHubConnector.ts`
  - Implement `listAccessibleRepos()`: check rate limit (throw if < 10 remaining), paginate via `octokit.paginate.iterator` with `affiliation: 'owner,collaborator,organization_member'`, map to `AccessibleRepo[]`
  - Implement `getRepoMetadata(owner, repo)`: call `octokit.rest.repos.get`, re-throw 404 with message `"Repository ${owner}/${repo} not found or not accessible"`, return `RepoMetadata`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.1, 6.2_

  - [ ]* 1.1 Write property tests for GitHubConnector discovery methods
    - Create `src/__tests__/connectors/GitHubConnector.discovery.test.ts`
    - **Property 3: Response Shape Completeness** — generate random `AccessibleRepo` arrays, verify all 8 fields present on every mapped item
    - **Property 4: Pagination Completeness** — mock `octokit.paginate.iterator` with N pages of M repos, verify `result.length === N*M` and no duplicate `htmlUrl`s
    - **Property 5: Rate Limit Guard** — generate `remaining` counts; for `< 10` verify throw before any list call; for `>= 10` verify no throw

- [x] 2. Add discovery Zod schemas to `src/models/schemas.ts`
  - Add `DiscoveredRepoSchema` with all 8 fields including `isRegistered: z.boolean()`
  - Add `RegisterDiscoveredRepoSchema` with `fullName` regex `/^[\w.-]+\/[\w.-]+$/` and optional `branch`
  - Export `DiscoveredRepo` and `RegisterDiscoveredRepoInput` inferred types
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 3. Create `src/api/routes/github.ts` with discovery routes
  - Define `GithubRouteDeps` interface (`githubConnector`, `repoManager`, `prisma`)
  - Add `normalizeUrl` helper: lowercase, strip trailing slashes, strip `.git` suffix
  - Implement `GET /github/repos`: call `listAccessibleRepos()`, fetch registered `githubUrl`s from DB, build normalized Set, set `isRegistered` on each repo, return `{ repos }` HTTP 200; map rate-limit errors → 429 with `resetAt`, Octokit 401 → 401
  - Implement `POST /github/repos/register`: parse body with `RegisterDiscoveredRepoSchema`, call `getRepoMetadata()`, check pre-existence via `prisma.repository.findFirst`, call `repoManager.register()`, return HTTP 201 for new / HTTP 200 for existing
  - _Requirements: 1.1, 1.2, 1.6, 1.7, 2.1, 2.2, 2.3, 3.1–3.6, 5.1, 5.4, 6.3_

  - [ ]* 3.1 Write property tests for github routes
    - Create `src/__tests__/routes/github.routes.test.ts`
    - **Property 1: isRegistered Consistency** — generate random repo lists + registered URL subsets; verify `isRegistered` matches set membership
    - **Property 2: URL Normalization Invariance** — generate URLs with random case + trailing slashes; verify `normalizeUrl(url) === normalizeUrl(normalizeUrl(url))`
    - **Property 6: Registration Idempotency** — call register twice with same `fullName`; verify DB count === 1 and both responses have same `id`
    - **Property 7: Branch Override Respected** — generate `fullName` + `branch` pairs; verify registered `repo.branch === provided branch`
    - **Property 8: Validation Rejection** — generate strings not matching `/^[\w.-]+\/[\w.-]+$/`; verify HTTP 400, no GitHub API call made

- [x] 4. Wire github routes and SPA static serving into `src/api/server.ts`
  - Import and register `githubRoutes` after existing route registrations
  - Add `@fastify/static` import; resolve `clientDist` to `../../client/dist` (Vite build output)
  - Conditionally register static plugin and SPA fallback `setNotFoundHandler` only when `client/dist` exists (use `fs.existsSync`)
  - SPA fallback must pass through all API prefixes (`/repos`, `/github`, `/summaries`, `/chat`, `/health`, `/admin`, `/socket.io`)
  - _Requirements: 11.1, 11.2_

- [x] 5. Add backend dependencies and scripts to root `package.json`
  - Add `"@fastify/static": "^8.0.0"` to `dependencies`
  - Add `"fast-check": "^3.0.0"` and `"vitest": "^2.0.0"` to `devDependencies`
  - Add `"test": "vitest --run"` script
  - Add `"client:dev": "cd client && npm run dev"` script
  - Add `"client:build": "cd client && npm run build"` script
  - Add `"client:install": "cd client && npm install"` script
  - _Requirements: 11.1, 11.3, 11.4_

- [x] 6. Checkpoint — backend complete
  - Verify all backend routes respond correctly and all tests pass before proceeding to frontend

- [x] 7. Scaffold React + Vite PWA project in `client/`
  - Run `npm create vite@latest client -- --template react-ts` from project root
  - Install dependencies: `react-router-dom`, `@tanstack/react-query`, `zustand`, `socket.io-client`, `vite-plugin-pwa`
  - Install UI dependencies: `tailwindcss`, `postcss`, `autoprefixer`, `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-tabs`, `class-variance-authority`, `clsx`, `tailwind-merge`
  - Run `npx tailwindcss init -p` inside `client/`
  - Create `client/tailwind.config.ts` with content paths and design token colors (`#0f1117`, `#161b22`, `#30363d`, `#e6edf3`, `#8b949e`, `#58a6ff`, `#3fb950`, `#d29922`, `#f85149`)
  - Create `client/tsconfig.json` with path alias `"@/*": ["./src/*"]`
  - _Requirements: 11.3, 11.4_

- [x] 8. Configure Vite with PWA plugin and dev proxy
  - Create `client/vite.config.ts` with `@vitejs/plugin-react` and `VitePWA` plugin
  - Configure `VitePWA`: `registerType: 'autoUpdate'`, Workbox `runtimeCaching` (NetworkFirst for API paths, CacheFirst for assets), `manifest` with name, icons, `display: 'standalone'`, `theme_color: '#0f1117'`
  - Configure `server.proxy` to forward `/repos`, `/github`, `/summaries`, `/chat`, `/socket.io` to `http://localhost:3000`
  - Add `resolve.alias` for `@` → `./src`
  - Create `client/public/manifest.json` and `client/public/icons/` with 192×192, 512×512, and maskable 512×512 PNG icons
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 9. Create shared frontend infrastructure (`lib/`, `store/`)
  - Create `client/src/lib/api.ts`: typed `apiFetch` wrapper, all endpoint functions with mirrored TypeScript types (`DiscoveredRepo`, `RepositoryInfo`, `SyncProgress`, `SummaryInfo`, `ChatResponse`, `CitedCommit`)
  - Create `client/src/lib/socket.ts`: Socket.io singleton, `getSocket()` and `subscribeToRepo(repoId)` exports
  - Create `client/src/store/appStore.ts`: Zustand store with `activeRepoId`, `setActiveRepoId`, `chatHistory` (keyed by repoId), `appendMessage`, `clearHistory`
  - _Requirements: 7.4, 8.2, 10.2_

- [x] 10. Create TanStack Query hooks
  - Create `client/src/hooks/useGithubRepos.ts`: `useGithubRepos()` with `staleTime: 30_000`; `useRegisterRepo()` mutation invalidating `['github-repos']` and `['repos']`
  - Create `client/src/hooks/useRepos.ts`: `useRepos()` list query
  - Create `client/src/hooks/useSyncProgress.ts`: `useSyncProgress(repoId)` with `refetchInterval` returning `3000` when `status === 'syncing'`, `false` otherwise
  - Create `client/src/hooks/useSummaries.ts`: `useSummaries(repoId, params)` with pagination params
  - Create `client/src/hooks/useChat.ts`: `useChat()` mutation calling `api.chat.query`, appending messages to Zustand store
  - _Requirements: 7.1, 7.4, 8.2, 9.1, 10.2_

- [x] 11. Create layout and navigation components
  - Create `client/src/components/layout/AppShell.tsx`: fixed 240px sidebar + main content area; on narrow viewports (< 768px) sidebar collapses to hamburger using shadcn/ui `Sheet`
  - Create `client/src/components/layout/Sidebar.tsx`: GitScripe wordmark, "Discover" nav link, registered repos list from `useRepos()`, each item with `StatusBadge` (min 44px touch target), active item with accent left border
  - Create `client/src/components/repos/StatusBadge.tsx`: Tailwind-styled chip — idle (gray), syncing (blue + `animate-pulse`), error (red)
  - _Requirements: 7.1, 8.4_

- [x] 12. Create repository components
  - Create `client/src/components/repos/RepoRow.tsx`: `<li>` with min 44px height; displays `owner/name`, monospace branch, description (1 line truncated), visibility badge, `isRegistered` badge, context-aware action `<button>` (Register / Sync Now + View / Syncing… / Retry Sync); inline `<p>` error below on failure
  - Create `client/src/components/repos/SyncProgressModal.tsx`: shadcn/ui `Dialog` (centered modal); shows `<div>` progress bar (width % via inline style), `processed / total` counter, elapsed time (`useEffect` timer), auto-dismisses 2s after completion, error state with Retry `<button>`; subscribes to Socket.io `repo:${repoId}`, falls back to `useSyncProgress` polling
  - _Requirements: 7.2, 7.4, 7.5, 7.6, 8.1–8.5_

  - [ ]* 12.1 Write property test for client-side filter
    - Create `client/src/__tests__/components/RepoRow.filter.test.ts`
    - **Property 9: Client-Side Filter Correctness** — generate repo arrays + search strings; verify filtered result equals `repos.filter(r => r.fullName.toLowerCase().includes(q.toLowerCase()))`

- [x] 13. Create summary components
  - Create `client/src/components/summaries/RiskBadge.tsx`: Tailwind-styled `<span>` badge — low (green), medium (yellow), high (red)
  - Create `client/src/components/summaries/SummaryCard.tsx`: `<article>` card showing short summary, author, date, `RiskBadge`, tags, quality score; click toggles expanded state (CSS `max-height` transition) showing detailed summary, inferred intent, per-file summaries, concepts; SHA in `<code>`, `<a target="_blank">` to GitHub commit URL
  - Create `client/src/components/summaries/SummaryFilters.tsx`: shadcn/ui `Select` for risk level + tag filter
  - _Requirements: 9.2, 9.3, 9.4, 9.5_

  - [ ]* 13.1 Write property test for SummaryCard shape
    - Create `client/src/__tests__/components/SummaryCard.shape.test.ts`
    - **Property 10: Summary Card Shape** — generate `SummaryInfo` objects; render `SummaryCard`; verify short summary, author, date, risk badge, tags, quality score all present in rendered output

- [x] 14. Create chat components
  - Create `client/src/components/chat/CitedCommitChip.tsx`: `<button>` chip showing 8-char SHA + short summary; click toggles expanded inline view
  - Create `client/src/components/chat/ChatMessage.tsx`: user messages right-aligned (`ml-auto`), assistant messages left-aligned; renders `CitedCommitChip` list below assistant messages
  - Create `client/src/components/chat/ChatPanel.tsx`: `<div>` with `overflow-y: auto; display: flex; flex-direction: column-reverse` for message history; CSS `animate-bounce` typing indicator (three dots, staggered delay) while loading; `<textarea>` disabled during loading; "Send" `<button>` + `Ctrl+Enter` submit; "Clear" `<button>` in header calls `clearHistory` from Zustand
  - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6_

- [x] 15. Create pages and wire React Router routes
  - Create `client/src/App.tsx`: `QueryClientProvider` + `BrowserRouter` wrapping `AppShell`; define routes `<Route path="/" element={<DiscoverPage />} />` and `<Route path="/repos/:id" element={<RepoDetailPage />} />`
  - Create `client/src/main.tsx`: React root mount with `StrictMode`
  - Create `client/src/pages/DiscoverPage.tsx`: calls `useGithubRepos()`, renders `<input type="search">` (client-side filter), "Refresh" `<button>`, `<ul>` of `RepoRow`; opens `SyncProgressModal` when sync triggered; loading skeleton (`animate-pulse` divs) and error state
  - Create `client/src/pages/RepoDetailPage.tsx`: reads `id` from `useParams()`; renders 60/40 split — left: `SummaryFilters` + paginated `<ul>` of `SummaryCard`; right: sticky `ChatPanel`; on narrow viewports stacks vertically
  - _Requirements: 7.1–7.6, 9.1–9.5, 10.1–10.6_

- [ ] 16. Optional — Tauri desktop shell setup
  - Run `npx @tauri-apps/cli init` inside `client/` to scaffold `src-tauri/`
  - Update `src-tauri/tauri.conf.json`: set `windows[0].url` to `http://localhost:3000`, `windows[0].title` to `"GitScripe"`, `windows[0].width` to `1280`, `windows[0].height` to `800`
  - Configure `systemTray` with icon path and context menu items: "Open GitScripe", "Quit"
  - Set `bundle.identifier` to `dev.gitscripe.app`
  - Verify `tauri build` produces `.dmg` / `.msi` / `.AppImage` artifacts
  - _Requirements: 13.1–13.6_

- [x] 17. Final checkpoint — full stack verification
  - Verify backend API routes respond correctly (`GET /github/repos`, `POST /github/repos/register`)
  - Verify `npm run client:dev` serves the Vite app on port 5173 and proxies to Fastify
  - Verify `npm run client:build` produces `client/dist/` and Fastify serves it correctly
  - Verify PWA install prompt appears in Chrome/Edge and app launches in standalone mode
  - Ensure all tests pass (`npm test`)

## Notes

- Tasks marked `*` are optional property-based tests — skip for faster MVP
- All interactive elements must have min 44×44px touch targets (iOS HIG / Material guidelines)
- Use standard HTML elements (`<button>`, `<input>`, `<a>`) styled with Tailwind — no React Native primitives
- Tauri (task 16) is optional — the PWA covers mobile install; Tauri adds native desktop binary
- `client/dist` is the single build output consumed by Fastify static serving, PWA install, and Tauri webview

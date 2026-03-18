# Requirements Document

## Introduction

The GitHub Repo Discovery feature extends GitScripe with the ability to list all GitHub repositories accessible via the configured token, resolve their default branches automatically, and allow users to selectively register and sync any discovered repository on demand. This eliminates the need for users to manually supply GitHub URLs and branch names, and makes GitScripe's commit summarization pipeline discoverable across an entire GitHub account or organization.

This feature also introduces the first client application for GitScripe — a React + Vite SPA that is enhanced as a Progressive Web App (PWA) for cross-device install and offline support, and optionally wrapped in a Tauri 2.0 shell for a native desktop experience on macOS, Windows, and Linux. The same frontend codebase serves all three surfaces. The app provides a developer-focused dashboard covering four core workflows: discovering and registering GitHub repositories, monitoring sync progress in real time, browsing AI-generated commit summaries, and chatting with the AI assistant over commit history.

## Glossary

- **Discovery_Service**: The server-side component responsible for querying the GitHub API for accessible repositories.
- **GitHubConnector**: The existing Octokit-based connector that communicates with the GitHub REST API.
- **RepoManager**: The existing service that manages repository registration and sync lifecycle in the database.
- **Discovered_Repo**: A GitHub repository returned by the Discovery_Service that has not yet been registered in GitScripe.
- **Registered_Repo**: A repository that has been persisted to the database via RepoManager and is eligible for sync.
- **Default_Branch**: The primary branch of a GitHub repository as reported by the GitHub API (e.g., `main`, `master`).
- **Sync**: The process of fetching commits from GitHub, running them through the LLM pipeline, and storing summaries.
- **Token**: The GitHub personal access token or OAuth token configured in the GitScripe environment.
- **UI**: The React + Vite SPA that provides the developer-facing dashboard for all GitScripe workflows, enhanced as a PWA for cross-device install and optionally wrapped in Tauri for native desktop.
- **SPA**: Single-page application served as static assets from the Fastify server.
- **PWA**: Progressive Web App — the SPA enhanced with a `manifest.json` and service worker, making it installable on any device (desktop, iOS, Android) directly from the browser without an App Store.
- **Tauri Shell**: An optional Tauri 2.0 wrapper that packages the same web frontend as a native desktop binary (macOS, Windows, Linux) with system tray, native file access, and offline capability.
- **Chat_Interface**: The conversational UI panel where users ask natural language questions about commit history and receive AI-generated cited answers.

---

## Requirements

### Requirement 1: List Accessible Repositories

**User Story:** As a developer, I want to list all GitHub repositories accessible via my configured token, so that I can discover which repositories are available to register in GitScripe without manually looking up URLs.

#### Acceptance Criteria

1. WHEN a request is made to `GET /github/repos`, THE Discovery_Service SHALL return a list of all repositories accessible to the authenticated Token.
2. THE Discovery_Service SHALL include the following fields for each repository in the response: `owner`, `name`, `fullName`, `defaultBranch`, `private`, `description`, `htmlUrl`, and `isRegistered`.
3. WHEN the Token has access to both personal and organization repositories, THE Discovery_Service SHALL return repositories from all accessible sources.
4. THE Discovery_Service SHALL resolve the `defaultBranch` for each repository from the GitHub API response without requiring a separate API call per repository.
5. WHEN the GitHub API returns more than 100 repositories, THE Discovery_Service SHALL paginate through all results and return the complete list.
6. IF the Token is invalid or expired, THEN THE Discovery_Service SHALL return an HTTP 401 response with a descriptive error message.
7. IF the GitHub API rate limit is insufficient to complete the listing, THEN THE Discovery_Service SHALL return an HTTP 429 response with the rate limit reset time included in the error message.

---

### Requirement 2: Indicate Registration Status

**User Story:** As a developer, I want to see which discovered repositories are already registered in GitScripe, so that I can avoid duplicate registrations and quickly identify new repositories to add.

#### Acceptance Criteria

1. THE Discovery_Service SHALL set the `isRegistered` field to `true` for any discovered repository whose `htmlUrl` matches a URL already present in the `repositories` table.
2. THE Discovery_Service SHALL set the `isRegistered` field to `false` for any discovered repository not present in the `repositories` table.
3. WHEN the registration status check is performed, THE Discovery_Service SHALL compare repository URLs in a case-insensitive and trailing-slash-normalized manner.

---

### Requirement 3: Register a Discovered Repository

**User Story:** As a developer, I want to register a repository from the discovered list using its auto-resolved default branch, so that I can add it to GitScripe without manually entering a URL or branch name.

#### Acceptance Criteria

1. WHEN a request is made to `POST /github/repos/register` with a valid `fullName` (e.g., `owner/repo`), THE Discovery_Service SHALL resolve the repository's `defaultBranch` from the GitHub API and register it via RepoManager.
2. WHEN a `branch` field is provided in the request body alongside `fullName`, THE Discovery_Service SHALL use the provided `branch` value instead of the resolved `defaultBranch`.
3. WHEN a repository is successfully registered, THE Discovery_Service SHALL return the registered repository object with HTTP 201.
4. IF the `fullName` does not correspond to a repository accessible by the Token, THEN THE Discovery_Service SHALL return an HTTP 404 response.
5. IF the repository is already registered, THEN THE Discovery_Service SHALL return the existing repository object with HTTP 200 rather than creating a duplicate.
6. IF the `fullName` field is missing or malformed, THEN THE Discovery_Service SHALL return an HTTP 400 response with a descriptive validation error.

---

### Requirement 4: Extend GitHubConnector with Discovery Methods

**User Story:** As a developer, I want the GitHubConnector to expose repository listing and metadata resolution methods, so that the Discovery_Service has a clean interface to the GitHub API without duplicating Octokit usage.

#### Acceptance Criteria

1. THE GitHubConnector SHALL expose a `listAccessibleRepos()` method that returns all repositories accessible to the Token, including `owner`, `name`, `defaultBranch`, `private`, `description`, and `htmlUrl` for each.
2. THE GitHubConnector SHALL expose a `getRepoMetadata(owner, repo)` method that returns the `defaultBranch`, `description`, `private`, and `htmlUrl` for a single repository.
3. WHEN `listAccessibleRepos()` is called, THE GitHubConnector SHALL paginate through all pages of results from the GitHub API.
4. IF a repository is inaccessible or does not exist when `getRepoMetadata()` is called, THEN THE GitHubConnector SHALL throw an error with a descriptive message including the repository name.

---

### Requirement 5: API Input Validation

**User Story:** As a developer, I want all discovery API inputs to be validated before processing, so that malformed requests fail fast with clear error messages.

#### Acceptance Criteria

1. THE Discovery_Service SHALL validate the `POST /github/repos/register` request body using a Zod schema before invoking any GitHub API calls.
2. WHEN the `fullName` field is provided, THE Discovery_Service SHALL validate that it matches the pattern `owner/repo` (alphanumeric, hyphens, underscores, and dots allowed in each segment).
3. WHEN the optional `branch` field is provided, THE Discovery_Service SHALL validate that it is a non-empty string.
4. IF validation fails, THEN THE Discovery_Service SHALL return an HTTP 400 response with field-level error details.

---

### Requirement 6: Rate Limit Awareness

**User Story:** As a developer, I want the discovery endpoints to respect GitHub API rate limits, so that discovery operations do not exhaust the token's quota and break other GitScripe operations.

#### Acceptance Criteria

1. WHEN `listAccessibleRepos()` is called, THE GitHubConnector SHALL check the remaining rate limit before beginning pagination.
2. IF the remaining rate limit is fewer than 10 requests, THEN THE GitHubConnector SHALL throw an error containing the reset time before making any listing API calls.
3. WHEN a rate limit error is thrown during discovery, THE Discovery_Service SHALL propagate it as an HTTP 429 response with the reset time in the response body.

---

### Requirement 7: Web UI — Repository Discovery & Registration

**User Story:** As a developer, I want a web interface to browse my GitHub repositories and register them into GitScripe with a single click, so that I don't need to use curl or Postman to interact with the API.

#### Acceptance Criteria

1. WHEN the UI loads, it SHALL display a "Discover Repositories" view that calls `GET /github/repos` and renders the full list of accessible repositories.
2. THE UI SHALL display for each repository: its full name (`owner/repo`), default branch, visibility (public/private), description, and a registration status badge (Registered / Not Registered).
3. THE UI SHALL provide a search/filter input that filters the displayed repository list client-side by name or owner without additional API calls.
4. WHEN a user clicks "Register" on an unregistered repository, THE UI SHALL call `POST /github/repos/register` with the repository's `fullName` and update the row's status badge to "Registered" on success.
5. WHEN a repository is already registered, THE UI SHALL replace the "Register" button with a "Sync Now" button that triggers `POST /repos/:id/sync`.
6. THE UI SHALL display inline error messages when registration or sync fails, without navigating away from the list.

---

### Requirement 8: Web UI — Sync Progress Monitoring

**User Story:** As a developer, I want to see real-time sync progress for a repository, so that I know how many commits have been processed by the AI pipeline without polling manually.

#### Acceptance Criteria

1. WHEN a sync is triggered from the UI, THE UI SHALL display a progress indicator showing `processed / total` commits and a percentage bar.
2. THE UI SHALL poll `GET /repos/:id/progress` every 3 seconds while a sync is in progress and update the display without a full page reload.
3. WHEN sync completes (all commits reach `done` or `failed` status), THE UI SHALL stop polling and display a completion summary showing processed count, failed count, and elapsed time.
4. THE UI SHALL display per-repository sync status (idle / syncing / error) as a colored status chip on all repository list views.
5. IF a sync enters an error state, THE UI SHALL display the error status prominently and offer a "Retry Sync" action.

---

### Requirement 9: Web UI — Commit Summaries Browser

**User Story:** As a developer, I want to browse AI-generated commit summaries for a registered repository, so that I can understand what changed and why without reading raw diffs.

#### Acceptance Criteria

1. WHEN a user selects a registered repository, THE UI SHALL display a paginated list of commit summaries fetched from `GET /summaries`.
2. EACH summary card SHALL display: short summary, author, commit date, risk level badge (low/medium/high with color coding), tags, and quality score.
3. WHEN a user clicks a summary card, THE UI SHALL expand it to show the detailed summary, inferred intent, per-file summaries, and extracted concepts.
4. THE UI SHALL support filtering summaries by risk level and by tag.
5. THE UI SHALL display a commit SHA that links to the corresponding GitHub commit URL.

---

### Requirement 10: Web UI — AI Chat Interface

**User Story:** As a developer, I want to ask natural language questions about a repository's commit history and receive AI-generated answers with cited commits, so that I can understand codebase changes and decisions conversationally.

#### Acceptance Criteria

1. THE UI SHALL provide a persistent chat panel accessible from any repository view.
2. WHEN a user submits a question, THE UI SHALL call `POST /chat` with the question and the active `repoId`, then display the AI-generated answer.
3. THE chat response SHALL render cited commits as clickable chips showing the short SHA and summary, which expand inline to show the full short summary.
4. THE UI SHALL maintain the full conversation history within the session (not persisted across page reloads).
5. WHILE a chat response is loading, THE UI SHALL display a typing indicator and disable the input to prevent duplicate submissions.
6. THE UI SHALL allow the user to clear the conversation history with a single action.

---

### Requirement 11: Web UI — Static Asset Serving

**User Story:** As a developer, I want the GitScripe UI to be served directly from the existing Fastify server, so that I don't need to run a separate frontend dev server in production.

#### Acceptance Criteria

1. THE Fastify server SHALL serve the compiled UI static assets (HTML, JS, CSS) from a `client/dist` directory under the `/` route.
2. THE Fastify server SHALL serve `index.html` for all non-API routes to support client-side routing (SPA fallback).
3. THE UI build output SHALL be excluded from the TypeScript compilation and treated as a separate build artifact.
4. IN development mode, THE UI SHALL support hot module replacement via Vite's dev server proxying API calls to the Fastify backend.

---

### Requirement 12: PWA — Cross-Device Install and Offline Support

**User Story:** As a developer, I want to install GitScripe on my phone or desktop directly from the browser, so that I can access it like a native app without going through an App Store.

#### Acceptance Criteria

1. THE UI SHALL include a valid `manifest.json` with app name, icons (192×192 and 512×512), `display: "standalone"`, `theme_color`, and `background_color` so browsers present an install prompt.
2. THE UI SHALL register a service worker that caches the app shell (HTML, JS, CSS) so the UI loads when the device is offline or the Fastify server is unreachable.
3. THE service worker SHALL use a network-first strategy for all API calls (`/repos`, `/github`, `/summaries`, `/chat`) and a cache-first strategy for static assets.
4. WHEN installed as a PWA on iOS (Safari, iOS 16.4+) or Android (Chrome), THE app SHALL launch in standalone mode without browser chrome.
5. THE PWA install experience SHALL work on macOS, Windows, Linux, iOS, and Android without any App Store submission.

---

### Requirement 13: Tauri Desktop Shell — Native Desktop App

**User Story:** As a developer, I want a native desktop app for GitScripe on macOS, Windows, and Linux, so that I get system tray integration, native window management, and a proper app icon in my dock without running a browser.

#### Acceptance Criteria

1. THE Tauri shell SHALL wrap the same `client/dist` web frontend without any frontend code changes.
2. THE Tauri app SHALL display a system tray icon with a context menu containing at minimum: "Open GitScripe", "Quit".
3. THE Tauri app SHALL connect to the Fastify backend via `http://localhost:3000` by default, with the base URL configurable via a Tauri build-time environment variable.
4. THE Tauri app SHALL produce distributable binaries for macOS (`.dmg`), Windows (`.msi` / `.exe`), and Linux (`.AppImage` / `.deb`) via `tauri build`.
5. THE Tauri shell SHALL NOT require a Rust backend to proxy API calls — all API communication goes directly from the webview to the Fastify server via HTTP and WebSocket.
6. Socket.io connections from the webview SHALL work without modification inside the Tauri shell, using the browser WebSocket API.

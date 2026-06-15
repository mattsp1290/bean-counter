# Add multi-repo support to bean-counter

Plan owner: dependency / app workstream • Status: **draft 1 — grounded against
beans `28a05fc` and bean-counter `main` @ 7f52743**

## Goal

Teach bean-counter (the local-network web UI + JSON API over `beans` issues) to
work across **multiple repositories** registered in one beans database, instead
of being hard-scoped to a single project prefix. Concretely:

1. **Read across repos** — list / ready / graph / deps can show either a single
   repo's issues or every registered repo's issues.
2. **Surface the repo registry** — expose the repos beans now tracks
   (`bn_repos`) as an API + UI so you can see which repos exist and create
   issues into a chosen one. **Caveat (found in review):** beans has no
   prefix-free repo/project enumeration, so Phase 1 derives the repo list from
   issues (misses zero-issue repos); a beans `ListAllRepos` follow-up is the
   clean fix. See `01` / `03` D5 / `06` Q0.
3. **Create issues into the right repo** — issue creation routes to a target
   repo (by slug or remote URL) so the issue lands under that repo's prefix.

This builds directly on the multi-repo work beans shipped in the 70 commits
between our old pin (`e52dce5`) and current `main` (`28a05fc`).

## Two-part deliverable

- **Part A — dependency update (DONE in this branch).** Bump beans to
  `28a05fc` and fix the call sites the API rename broke. See `02`. This is the
  prerequisite and is already implemented + green (`go build`/`go test` pass).
  **Deploy gate:** A1 raises bean-counter's embedded migration max above prod, so
  the prod preflight will abort until the local-symphony orchestrator migrates
  the shared DB first — merge is fine, deploy is sequenced (`02`, `06` Q6).
- **Part B — multi-repo feature (this plan).** The app-level work in `04`,
  sequenced in `05`.

## The core architectural shift

bean-counter today bakes **one** `BN_PROJECT_PREFIX` into config and threads it
into every `ListFilter{Prefix: ...}` (see `internal/handlers/*`,
`internal/store/adapter.go`). Under beans' topology-a (`prefix == repo slug`),
that means the app shows exactly **one repo's** issues.

Multi-repo support is fundamentally about **replacing that single hard-coded
prefix with a per-request repo scope**:

- `?all_repos=true` → `ListFilter{AllRepos: true}` (beans omits the prefix WHERE
  clause — cross-repo query, free from the library).
- `?repo=<slug>` → `ListFilter{Prefix: <slug>}` (scope to one repo).
- default (no param) → configured default (keep today's single-prefix behavior
  for backward compatibility).

beans already gives us the primitives (`ListFilter.AllRepos`, the repo registry
methods, `IssueRepoInput.RemoteURL`); bean-counter's job is to **plumb a repo
scope through config, handlers, DTOs, and the frontend.**

## What beans hands us for free

See `01` for the full model. Highlights:

- `ListFilter{AllRepos bool}` — every read method (`ReadyIssues`, `ListDeps`,
  `ListBlockingDeps`, `ListMembers`, `ListParents`, `ListIssues`) honors it.
- Repo registry methods on `*store.Store`: `ListRepos`, `GetRepoBySlug`,
  `GetRepoByRemoteURL`, `ResolveRepoAlias`, `CreateRepo`, `UpdateRepo`,
  `DisableRepo`, `AutoRegisterRepo`.
- `IssueRepoInput.RemoteURL` (Create-only) — triggers `AutoRegisterRepo` and
  derives the issue prefix from the registered repo.
- `model.RepoTarget` — already round-trips through bean-counter's DTO.

## Non-goals (initial cut)

- Workspace routing / run execution (clone, worktree, branch creation). beans'
  `RepoTarget` carries `WorkBranch`/`CloneStrategy`/`AuthRef`, but bean-counter
  is an issue UI, not the orchestrator. We surface these fields read-only.
- Per-repo authentication/authorization in the bean-counter UI (it has none —
  see the auth decision in `03`).
- `bn_repo_audit` / `bn_project_admins` administration UI.

## Files in this plan

| File | Contents |
|------|----------|
| `00-overview.md` | this file |
| `01-beans-multi-repo-model.md` | what beans now provides (grounded) |
| `02-dependency-update.md` | the beans bump — what broke, what was changed (done) |
| `03-architecture-and-decisions.md` | scope model, auth, ID-guard, config |
| `04-implementation.md` | API, store adapter, handlers, DTO, config, frontend |
| `05-task-sequence.md` | ordered, beads-ready task breakdown |
| `06-open-questions.md` | decisions needing a human |

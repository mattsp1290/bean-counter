# 05 — Task sequence (beads-ready)

Ordered so each step compiles + tests green before the next. Part A is done;
Part B is the feature. Suggested beads `-l` labels in brackets.

## Part A — dependency update  ✅ DONE

- **A1** [impl] Bump beans to `28a05fc`, `go mod tidy`. Fix the 5-method
  `ListFilter` renames in `adapter.go`, `deps.go`, `graph.go` + the two test
  fakes. `go build/vet/test` green. *(Implemented in this branch — see `02`.)*
- **A2** [prep] **Deploy-ordering gate (blocks prod deploy of A1, NOT the merge).**
  The prod preflight aborts if bean-counter's embedded beans migrations are newer
  than the shared DB (`deploy-production.sh:440-447`). A1 raises `embedded_max`
  above prod, so the local-symphony orchestrator must bump beans to ≥ `28a05fc`
  and migrate the shared Postgres **first**. Verify `db_max ≥ embedded_max` before
  deploying. Depends on: A1 (and on local-symphony's own bump). See `02`/`06` Q6.

## Part B — multi-repo feature

Backend foundation (do in order — each is small and independently shippable):

- **B1** [impl] Config: add `BN_DEFAULT_SCOPE` (`project`|`all`, default
  `project`) to `internal/config/config.go` + validation + `.env.example`.
  Depends on: A1.
- **B2** [impl] New `internal/scope` package: `Resolve(repo, allRepos, defaults)`
  → `ListFilter`, with conflict/shape validation + table tests. Depends on: B1.
- **B3** [impl] Adapter: add `ReadyIssuesScoped(ctx, ListFilter)`; re-export
  `Repo` and `ErrSlugExhausted` in `internal/store/adapter.go`. (Write-type
  re-exports `CreateRepoInput`/`UpdateRepoInput`/`AutoRegisterInput` deferred to
  B12.) Depends on: A1.
- **B4** [impl] Thread scope into read handlers: parse `?repo=`/`?all_repos=`,
  call `scope.Resolve`, apply the D8 `Limit` cap. **`ready` needs the most work**
  (widen its `Source` interface to the scoped signature, add `ProjectPrefix` +
  default-scope to its `Config`, plumb from `main.go`, add query parsing).
  **`graph` rejects `all_repos`** (single-repo only, D8). Update handler
  fakes/tests. Depends on: B2, B3.
- **B5a** [impl] Fix `validate.fieldErrors.repo` (`validate.go:276`): make
  `repo_slug` optional when `remote_url` is present, require at least one, 400 if
  both; add `remote_url` length + `NormalizeRemoteURL` validation. Update
  `validate_test.go`. Depends on: A1.
- **B5b** [impl] Bind the ID guard to scope: add `strict bool` to
  `ProjectIssueIDField` (strict under `BN_DEFAULT_SCOPE=project`, shape-only under
  `all`); thread the flag through all call sites in `issues.go` + `deps.go` (both
  `id` and `blocked_by_id`). Cover both modes in `validate_test.go`. Depends on:
  B1.
- **B6** [impl] Issue-create routing: add `RemoteURL` to DTO `IssueRepoInput`;
  resolve target prefix (RemoteURL → beans auto-register; slug → use slug as
  prefix per topology-a, 400 on unknown; else default); pass resolved prefix to
  `ToStoreInput`; map `ErrSlugExhausted` (→409) in `server/errors.go`. Depends
  on: B3, B5a, B5b.
- **B7** [impl] Repo registry endpoints: `internal/handlers/repos` +
  `dto/repos.go`. `GET /repos` **derives the list from
  `ListIssues(AllRepos:true)`** (beans has no repo enumeration — document the
  zero-issue-repo caveat); `GET /repos/:slug` → `GetRepoBySlug(ctx, slug, slug)`.
  Register in `server/app.go` + `main.go`. Depends on: B3.
- **B7b** [prep] File a beans issue for a prefix-free `ListAllRepos(ctx,
  includeDisabled)`; once it ships, replace B7's derive-from-issues impl. No
  bean-counter dependency — tracked so the caveat isn't permanent.

Frontend:

- **B8** [impl] API client + types: `getRepos`/`getRepo`, `repo`/`all_repos`
  query params on list/ready, repo fields on create form. Tests. Depends on: B4,
  B6, B7.
- **B9** [impl] UI — **larger than a picker** (no shared store exists today):
  add a scope store persisted in the URL query, the repo picker + All-repos
  toggle in `AppShell` (toggle hidden on graph), make issues/ready/graph routes
  re-fetch on scope change, show repo slug on rows, repo selector in the create
  form, empty-state handling. Depends on: B8.

Hardening / docs:

- **B10** [testing] Integration/e2e (`test/e2e`): seed two repos in a beans DB,
  assert per-repo vs all-repos scoping, cross-repo issue fetch by ID, create-into
  -repo routing, and the strict vs shape-only write guard under each
  `BN_DEFAULT_SCOPE`. Depends on: B1, B4, B6, B7.
- **B11** [docs] README + AGENTS.md/CLAUDE.md: scope model, params, `/repos` (+
  its enumeration caveat), `BN_DEFAULT_SCOPE` and its write-scope effect. Depends
  on: B7.

Optional later phase (gated on D6 / Q1):

- **B12** [impl] Repo write endpoints (`POST /repos`, `PATCH`/`DELETE`) passing
  `cfg.Actor`, re-exporting the write-input types, mapping beans
  admin-authorization errors to 403. Depends on: B7 + auth decision.

## Quality gate (every task)

```bash
go build ./... && go vet ./... && go test ./...
cd frontend && npm test   # for B8/B9
```

## Suggested beads creation

One epic + the tasks above with deps, e.g.:

```bash
EPIC=$(bd create "Multi-repo support in bean-counter" \
  -d "Plumb beans multi-repo (ListFilter.AllRepos, repo registry, create-routing) through bean-counter config/handlers/DTO/frontend. Plan: .agents/plans/multi-repo-support/" \
  -t epic -p 1 --silent)
# then A2, B1..B12 as tasks with: bd dep add <child> <parent>
```

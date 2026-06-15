# 04 — Implementation

Grounded in the current tree. Each section names the real files.

## 1. Config (`internal/config/config.go`)

- Add `DefaultScope string` to `Config`, read from `BN_DEFAULT_SCOPE`
  (default `"project"`; allowed `project` | `all`). Validate in the existing
  `validate()` block alongside the other knobs.
- Keep `BN_PROJECT_PREFIX` required (default `bean-counter`). It remains the
  default-repo identity, the `EnsureProject` seed, and the auto-register/create
  fallback prefix.

## 2. Scope helper (new `internal/scope/scope.go`)

```go
// Resolve turns request query params into a beans ListFilter, applying the
// configured default when no scope param is present.
func Resolve(repo string, allRepos bool, cfg Defaults) (appstore.ListFilter, error)
```

- `repo` + `allRepos` both set → 400 (`ErrConflictingScope`).
- `allRepos` → `ListFilter{AllRepos: true}`.
- `repo != ""` → minimal length/charset check (there is **no** reusable
  slug-shape validator in `validate`/`beans.repo` to lean on — keep it light per
  Q2's pass-through default; an unknown slug just yields an empty list, no DB
  round-trip). Return `ListFilter{Prefix: repo}`.
- neither → default: `project` ⇒ `{Prefix: cfg.ProjectPrefix}`, `all` ⇒
  `{AllRepos: true}`.
- Apply the D8 default `Limit` cap (e.g. 200) on the returned filter when the
  caller didn't set one, so `all_repos` can't return unbounded rows.

Unit-test this in isolation (table-driven), mirroring `validate_test.go` style.

## 3. Read handlers — thread the scope

Each handler currently hard-codes `ListFilter{Prefix: cfg.ProjectPrefix}`.
Replace with `scope.Resolve(...)` parsed from `c.Query("repo")` /
`c.Query("all_repos")`.

| Handler | File | Change |
|---------|------|--------|
| ready | `internal/handlers/ready/ready.go` | **Biggest change.** Today `ready` has no query parsing and its `Source` interface is `ReadyIssues(ctx) ([]Issue, error)` with no prefix in its `Config`. Must: (a) add `ReadyIssuesScoped(ctx, ListFilter)` to the adapter; (b) widen the handler's `Source` interface to the scoped signature; (c) add `ProjectPrefix` (+ default-scope) to `ready`'s `Config` and plumb it from `main.go` (currently not passed); (d) parse `?repo=`/`?all_repos=`; (e) update the handler fake/test. |
| graph | `internal/handlers/graph/graph.go` | `ListIssues` + `ListBlockingDeps` take the resolved `ListFilter`. **`graph` rejects `all_repos` (D8)** — single-repo only in Phase 1. |
| deps (list) | `internal/handlers/deps/deps.go` | `ListBlockingDeps` takes the resolved `ListFilter`. |
| issues (list) | `internal/handlers/issues/issues.go:142` | already builds `ListFilter{Prefix: cfg.ProjectPrefix}`; swap for `scope.Resolve`. |

`internal/store/adapter.go`: add

```go
func (a *Adapter) ReadyIssuesScoped(ctx context.Context, f ListFilter) ([]Issue, error) {
    return a.store.ReadyIssues(ctx, f, a.terminalStates, a.activeStates)
}
```

and keep `ReadyIssues(ctx)` as the `{Prefix: a.projectPrefix}` convenience.

## 4. Relax the ID guard (`internal/api/validate/validate.go`)

Per D3 (write-scope bound to `BN_DEFAULT_SCOPE`): add a `strict bool` parameter
to `ProjectIssueIDField`. When `strict` (i.e. `BN_DEFAULT_SCOPE=project`) keep
the `!strings.HasPrefix(id, prefix+"-")` rejection — preserving today's
write-scoping. When not strict (`=all`) keep only `fields.id(field, id)` (shape)
and let cross-repo IDs reach beans, which 404s unknown IDs.

Call sites: `issues.go` (get/update/close/delete, lines 76/88/108/132) **and**
`deps.go` (both `id` and `blocked_by_id`, lines 56/59/74/77) must pass the strict
flag derived from config. Update `validate_test.go` to cover both modes.

## 5. Issue creation routing (`internal/handlers/issues/issues.go` + DTO)

- `internal/api/dto/issues.go`: add `RemoteURL string json:"remote_url,omitempty"`
  to `IssueRepoInput`; map it in `toStoreInput()` to
  `appstore.IssueRepoInput.RemoteURL`.
- In the create handler, compute the **target prefix**:
  - `req.Repo.RemoteURL != ""` → leave prefix derivation to beans (it
    auto-registers and sets the prefix). Pass `cfg.ProjectPrefix` only as a
    harmless fallback `Prefix`.
  - else `req.Repo.RepoSlug != ""` → topology-a means **`prefix == slug`**, so
    set the target prefix = `RepoSlug` directly (beans does NOT resolve slug→
    prefix — verified `store.go:216`). Optionally `GetRepoBySlug(ctx, slug, slug)`
    to pre-validate existence; on miss → **400 unknown repo** (never silently
    fall back to the default prefix).
  - else → `cfg.ProjectPrefix` (today's behavior).
- `CreateIssueRequest.ToStoreInput(prefix, actor)` already takes `prefix`; the
  handler now passes the resolved target prefix instead of always
  `cfg.ProjectPrefix`.
- **Validator fix (blocker):** `validate.go:276` (`fieldErrors.repo`) currently
  requires `repo_slug` **unconditionally** when `req.Repo != nil` — this would
  400 the headline `remote_url`-only create. Change to: require **at least one**
  of `repo_slug` / `remote_url`; 400 if **both** set; when `remote_url` present,
  length-check it and validate via `beansrepo.NormalizeRemoteURL` (`beansrepo` is
  already imported in `validate.go:9`).
- Map `ErrSlugExhausted` (reachable here via `AutoRegisterRepo`) in
  `server/errors.go` — likely 409. Do this with the create work, not B12.

## 6. Repo registry handler (new `internal/handlers/repos/repos.go`)

**beans cannot enumerate repos (see `01` / D5).** So `GET /repos` derives the
list from issues; `GET /repos/:slug` uses the real registry getter (works because
`prefix == slug`):

```go
type Store interface {
    // GET /repos: list distinct hydrated issue.Repo from a cross-repo issue scan.
    ListIssues(context.Context, appstore.ListFilter) ([]appstore.Issue, error)
    // GET /repos/:slug: full bn_repos metadata for a known slug.
    GetRepoBySlug(ctx context.Context, prefix, slug string) (appstore.Repo, error)
}
// GET /repos        -> {"repos": [...]}  // distinct {slug,id,remote_url,default_branch}
//                                        // CAVEAT: omits zero-issue repos; no enabled flag
// GET /repos/:slug  -> {repo}            // ErrNotFound -> 404; call GetRepoBySlug(ctx, slug, slug)
```

- Re-export `Repo` (and `ErrSlugExhausted`, needed by the create path) in
  `internal/store/adapter.go`. **Defer** `CreateRepoInput`/`UpdateRepoInput`/
  `AutoRegisterInput` re-exports to B12 (Phase 1 is read-only — pre-staging write
  types just bloats the diff).
- Add `internal/api/dto/repos.go`: `Repo` DTO + `RepoFromStore`, plus a
  `RepoFromTarget` mapper for the derive-from-issues path.
- Register in `internal/server/app.go` (and wherever `RegisterAPI` is wired in
  `cmd/bean-counter/main.go`) alongside the other handler groups.
- **Follow-up:** file a beans issue for a prefix-free `ListAllRepos(ctx,
  includeDisabled)` so `GET /repos` can return *all* repos with metadata; swap
  the derive-from-issues impl once it lands.

## 7. Frontend (`frontend/src`)

- `lib/api/types.ts`: add `Repo`; extend issue/list param types with
  `repo?: string` and `allRepos?: boolean`; add `RemoteURL`/repo fields to the
  create form type.
- `lib/api/client.ts`: add `listRepos()` / `getRepo(slug)`; extend
  `listIssuesQuery` (and add equivalents for ready/graph) to append
  `repo=`/`all_repos=` query params.
- **Shared scope state (larger than "add a picker").** There is **no
  cross-route store today** — every route loads on mount with component-local
  `$state`, and `AppShell` is purely presentational (props + snippets). This work
  needs: (a) a new Svelte store holding the selected scope; (b) **persist the
  scope in the URL query** (`?repo=`/`?all_repos=`) so it survives reload, is
  shareable, and mirrors the API contract — a picker that resets on navigation
  feels broken; (c) each route subscribing and **re-fetching when scope changes**
  (none react to external state after mount today).
- `lib/components/AppShell.svelte`: add the **repo picker** (options from
  `GET /repos`) + an **All repos** toggle, bound to the scope store/URL. Hide the
  All-repos toggle on the graph view (graph is single-repo in Phase 1, D8).
- `routes/issues/IssuesRoute.svelte`, `ready/ReadyRoute.svelte`,
  `graph/GraphRoute.svelte`: read the scope and pass it to the client.
- Issue rows: show the issue's repo slug (the `repo` field already comes back in
  the DTO via `RepoTargetFromStore`) — most useful in All-repos mode.
- `routes/issues/form.ts`: add an optional repo selector to the create form
  (slug from `GET /repos`, or a remote-URL field). Default the selector to the
  current scope's repo (or `BN_PROJECT_PREFIX` when scope is `all`).
- Empty states (reuse existing `EmptyState`): distinguish "no repos registered"
  from "this repo has no issues"; decide whether the picker lists disabled repos
  (the derive-from-issues list can't tell — another reason for the beans
  `ListAllRepos` follow-up).
- Tests: extend `client.test.ts` and `routes.test.ts`; cover scope query-param
  building and URL round-tripping.

## 8. Docs

- `README.md`: document `BN_DEFAULT_SCOPE`, the `?repo=`/`?all_repos=` params,
  and the `/repos` endpoints.
- `.env.example`: add `BN_DEFAULT_SCOPE`.
- `AGENTS.md` / `CLAUDE.md`: note the multi-repo scope model for future agents.

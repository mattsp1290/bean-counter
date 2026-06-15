# 03 — Architecture & key decisions

## D1 — Repo scope is per-request, with a configured default

Replace the implicit "everything is `BN_PROJECT_PREFIX`" assumption with an
explicit **scope** resolved per request for read endpoints:

| Request | Resolves to |
|---------|-------------|
| `?repo=<slug>` | `ListFilter{Prefix: <slug>}` |
| `?all_repos=true` | `ListFilter{AllRepos: true}` |
| neither | configured default scope (see D2) |

A small helper — `resolveScope(c, cfg) (appstore.ListFilter, error)` in a new
`internal/scope` package (or `internal/api`) — centralizes parsing + validation
(reject `repo` + `all_repos` together; validate slug shape; optionally verify
the slug exists via `GetRepoBySlug`). Every read handler calls it instead of
hard-coding `ListFilter{Prefix: cfg.ProjectPrefix}`.

## D2 — Backward-compatible default scope

New config knob `BN_DEFAULT_SCOPE` (default `project`):

- `project` — default scope = `ListFilter{Prefix: BN_PROJECT_PREFIX}`. Identical
  to today's behavior. **This is the default so existing deployments are
  unchanged.**
- `all` — default scope = `ListFilter{AllRepos: true}`. For deployments that
  want the UI to span every repo out of the box.

`BN_PROJECT_PREFIX` stays required (it is the default-repo identity, the
auto-register target, and the `EnsureProject` seed).

## D3 — Relax the issue-ID prefix guard for ID-addressed ops

`validate.ProjectIssueID(prefix, id)` currently rejects any ID that does not
start with `BN_PROJECT_PREFIX+"-"` (`internal/api/validate/validate.go:61`). It
guards `show`/`update`/`close`/`delete` (`issues.go`) and `dep add`/`remove`
(`deps.go`).

In multi-repo, IDs carry **per-repo** prefixes (`my-frontend-xyz`), so this
guard wrongly rejects valid cross-repo IDs. beans looks issues up by full ID
across repos and returns `ErrNotFound` for unknown IDs.

**But relaxing the guard unconditionally is NOT a no-op on a shared DB.** In prod
bean-counter shares one beans DB with the local-symphony orchestrator; today the
prefix guard is the *only* thing scoping writes (`update`/`close`/`delete`/`dep
add`/`dep remove`, on both `id` and `blocked_by_id`). Dropping it lets any
LAN caller mutate/delete *any* repo's issues by ID — a real blast-radius
increase, and it contradicts the "zero behavior change" promise D2 makes for the
`project` default.

**Decision — bind write-scoping to `BN_DEFAULT_SCOPE`:**

- `BN_DEFAULT_SCOPE=project` (the default) → **keep strict single-prefix write
  guard.** Writes stay within `BN_PROJECT_PREFIX`, exactly as today. Backward
  compatible in behavior, not just in the read path.
- `BN_DEFAULT_SCOPE=all` → relax to a **shape-only** check (keep `fields.id`,
  drop the `HasPrefix` assertion); cross-repo write-by-ID is then allowed, and
  beans' `ErrNotFound`→404 handles unknown IDs.

This resolves the earlier D3-vs-Q4 contradiction: cross-repo writes are opt-in
with the same switch that opts into cross-repo *reads*. Implement as a flag/param
on `ProjectIssueIDField` (e.g. `strict bool`) rather than a second function.

## D4 — Issue creation routes to a target repo

`CreateIssueRequest.Repo` (`IssueRepoInput`) already exists in the DTO. Extend
it to drive repo routing on create:

- **`remote_url` set** → add `RemoteURL` to the DTO `IssueRepoInput`, map to
  `appstore.IssueRepoInput.RemoteURL`. beans `AutoRegisterRepo`s and derives the
  prefix (`effectivePrefix = resolved.Prefix`); pass `cfg.ProjectPrefix` only as
  a harmless fallback `Prefix`. Note: auto-register from issue-create uses
  default `DefaultBranch`/`AuthRef` — a repo first seen this way gets defaults a
  read-only UI can't change (acceptable for an issue tracker).
- **`repo_slug` only (no URL)** → beans does **not** resolve slug→prefix
  (verified `store.go:216`); `effectivePrefix = in.Prefix` verbatim. Under
  topology-a `prefix == slug`, so the target prefix **is** the slug — set
  `Prefix = repo_slug` directly. (Optionally pre-check existence with
  `GetRepoBySlug(ctx, slug, slug)`; on miss return **400 unknown repo** — do NOT
  silently create under the default prefix, which yields a mis-prefixed,
  hard-to-find issue.)
- **neither** → `cfg.ProjectPrefix` (today's behavior).

This means `ToStoreInput(prefix, actor)` must take the **resolved target
prefix**, not always `cfg.ProjectPrefix`. The handler resolves the prefix before
building the store input. `AutoRegisterRepo` (reached via the `remote_url` path)
can return `ErrSlugExhausted` — map it in `server/errors.go` as part of the
create work, not deferred to write endpoints.

## D5 — Repo registry endpoints (read-first) — constrained by beans

**beans has no global repo enumeration** (see `01`). `ListRepos(ctx, prefix,
includeDisabled)` is single-prefix, and there is no `ListProjects`. So
`GET /repos → ListRepos → all repos` **cannot be built directly**. Two options:

- **(chosen for Phase 1) Derive the repo set from issues.** `GET /api/v1/repos`
  loads `ListIssues(ListFilter{AllRepos: true})` and collects the distinct
  hydrated `issue.Repo` (`slug`, `id`, `remote_url`, `default_branch`).
  - Limitation: **misses repos with zero issues**, and carries no
    `enabled`/admin/`worktree_subdir` metadata (those come only from `bn_repos`,
    which we can't list). Document this in the API + README.
- **(clean, follow-up) Add `ListAllRepos(ctx, includeDisabled)` to beans** (a
  prefix-free `SELECT * FROM bn_repos`) and bump the dependency again. This is
  the correct long-term fix; file it as a beans issue. Until then, Phase 1 uses
  the derive-from-issues path.

Per-repo detail works directly because topology-a gives `prefix == slug`:

- `GET /api/v1/repos/:slug` → `GetRepoBySlug(ctx, slug, slug)` → `dto.Repo`
  (`ErrNotFound`→404). This returns full `bn_repos` metadata for a known slug.

These reads are unconditionally safe. Write endpoints (`POST /repos` →
`CreateRepo`, `PATCH`/`DELETE` → `UpdateRepo(ctx, slug, slug, in)` /
`DisableRepo(ctx, slug, slug, actor)`) are gated on the auth decision (D6) and
land in a later phase.

## D6 — Authorization for repo mutations (decision needed)

beans requires `BN_ACTOR` to be a **project admin** (`bn_project_admins`) for
`CreateRepo`/`UpdateRepo`/`DisableRepo`. bean-counter has **no auth** by design
(trusted local network; README says do not expose publicly).

Decision (see `06` Q1):

- **(recommended) Phase 1 = read-only registry.** Ship `GET /repos*` and
  issue-routing-on-create only. Repo registration happens via the `bn` CLI /
  auto-register. No new auth surface.
- Phase 2 = trusted-network write endpoints that pass `cfg.Actor` as the admin
  actor, relying on beans' own `AuthorizeRepoAdmin` to reject if the configured
  actor is not an admin (surface a 403). Only if there's real demand.

## D7 — beans owns migrations; bean-counter does not

The multi-repo tables are created by `beans/store.New`. bean-counter must not
add migrations (already documented in `adapter.go`). No schema work in this repo
— just connect to a beans DB built by the new version.

**Deploy-ordering gate (critical, see `02` + `06` Q6).** The prod deploy
preflight (`scripts/deploy-production.sh:440-447`) **aborts** if bean-counter's
embedded beans migration max is *newer* than the shared DB
(`FAIL: ... embedded migrations are NEWER than prod ... would migrate the shared
schema`). The Part A bump pulls in the new multi-repo migrations, so
`embedded_max > db_max` until the local-symphony orchestrator (which owns the
shared Postgres) has bumped beans to ≥ `28a05fc` and migrated the DB. **Part A
cannot deploy to prod before that.** This is a hard, sequenced precondition, not
a footnote. The gate is one-directional: connecting to an *already-migrated* DB
(db_max ≥ embedded_max) is fine, so bean-counter must never be first to
introduce these tables in prod.

## D8 — Bound `all_repos` reads (response size, not SQL)

`AllRepos` is "free" at the SQL-filter level but not at response/render size.
Today the issues list accepts `limit` but the UI never sends it; `ready` and
`graph` ignore `limit` entirely and load everything for one prefix. Against the
shared DB, `?all_repos=true` turns each of these into an unbounded cross-repo
scan rendered in full in the browser — worst for `/graph` (N×M force layout).

Decision:

- Default-cap `limit` on the issues list (e.g. 200) and plumb it through the
  client so `all_repos` can't return unbounded rows.
- **`/graph` does NOT support `all_repos` in Phase 1** — a cross-repo dependency
  graph is the least useful + most expensive view. It stays single-repo; add it
  later behind an explicit opt-in if there's demand.
- `ready` under `all_repos` is bounded by the ready-queue states but should still
  honor a cap.

## Summary of the seams touched

```
config        BN_DEFAULT_SCOPE + keep BN_PROJECT_PREFIX
scope helper  resolveScope(req) -> ListFilter{Prefix|AllRepos}; default cap on limit
read handlers ready, graph(single-repo only), deps(list), issues(list) -> resolveScope
id guard      strict for project-default; shape-only when BN_DEFAULT_SCOPE=all
create        route to target prefix: remote_url(auto-reg) | slug==prefix | default
repos handler GET /repos (derive from issues), GET /repos/:slug (+ later writes)
DTO           Repo, IssueRepoInput.RemoteURL
frontend      repo picker + all-repos toggle; show repo on issue rows
```

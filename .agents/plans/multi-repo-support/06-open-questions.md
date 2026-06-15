# 06 — Open questions (need a human decision)

## Q0 — `GET /repos` enumeration: derive-from-issues now, or block on a beans change?

**This is the load-bearing one.** beans `28a05fc` has **no** prefix-free repo or
project enumeration (`ListRepos` is single-prefix; no `ListProjects`). So the
"surface the registry" pillar can't be built directly. Options:

- **(recommended, Phase 1) Derive from issues** — `GET /repos` lists distinct
  `issue.Repo` from `ListIssues(AllRepos:true)`. Ships now; **misses zero-issue
  repos** and carries no `enabled`/admin metadata.
- **Block on beans** — add `ListAllRepos(ctx, includeDisabled)` to beans, bump
  the dep again, then build the real registry. Clean but gated on upstream work.

**Default:** ship derive-from-issues, file the beans `ListAllRepos` issue (B7b),
swap impl when it lands. Decide if the missing-zero-issue-repos caveat is
acceptable for the picker UX.

## Q1 — Repo registry: read-only, or writable from bean-counter?

beans gates `CreateRepo`/`UpdateRepo`/`DisableRepo` on `BN_ACTOR` being a
project admin. bean-counter has no auth (trusted-network only).

- **(recommended) Read-only registry in Phase 1.** `GET /repos*` + create-routing
  only; repo registration via `bn` CLI / auto-register. No new auth surface.
- Writable in Phase 2: pass `cfg.Actor` to beans and surface its
  authorization errors as 403. Only if there's demand.

**Default if no answer:** read-only (B7), defer writes (B12).

## Q2 — Should `?repo=<slug>` validate existence (400) or pass through (404)?

- Pass-through: cheaper, no extra query; unknown repo → empty list / beans 404.
- Validate via `GetRepoBySlug`: clearer 400 for typos, one extra round-trip.

**Default:** pass-through for list/scope reads; rely on empty results. Revisit if
users find silent-empty confusing.

## Q3 — Default scope: `project` or `all`?

`BN_DEFAULT_SCOPE` defaults to `project` (zero behavior change for existing
deploys). Do any current deployments want `all` out of the box (e.g. a shared
multi-repo dashboard)?

**Default:** `project`. Operators opt into `all` per deployment.

## Q4 — Write-by-ID scope (DECIDED — see D3)

Resolved during review: relaxing the ID guard unconditionally would let any LAN
caller mutate/delete *any* repo's issues in the shared orchestrator DB — a real
blast-radius increase that breaks D2's "zero behavior change" promise. So
write-scoping is now **bound to `BN_DEFAULT_SCOPE`**: strict single-prefix guard
under `project` (default, today's behavior), shape-only/cross-repo under `all`.
Left here only to record the decision; no open question remains unless someone
wants cross-repo writes under the `project` default.

## Q5 — How much of `RepoTarget` does the UI surface?

`RepoTarget` carries routing/runtime fields (`work_branch`, `clone_strategy`,
`auth_ref`, `base_ref`) that belong to the orchestrator, not an issue tracker.

**Default:** show `slug` (+ `remote_url`, `default_branch` on a repo detail
view); treat the routing fields as read-only/hidden in Phase 1.

## Q6 — Production deploy ordering (GATING, not advisory)

bean-counter and the local-symphony orchestrator share one beans DB. The Part A
bump raises bean-counter's embedded migration max above prod, and the prod
preflight **aborts** when embedded > db (`deploy-production.sh:440-447`). So this
is a hard sequenced gate, not a "confirm version" footnote:

1. local-symphony bumps beans to ≥ `28a05fc` and migrates the shared Postgres.
2. Verify `db_max ≥ embedded_max` in prod.
3. *Then* deploy bean-counter Part A.

bean-counter must never be first to introduce the multi-repo tables in prod.
**Action:** coordinate with the orchestrator owner before deploying A1; tracked
as A2 in `05`. **Who runs the migration** (orchestrator vs a one-off) also needs
confirming.

## Q7 — Does `/graph` ever need `all_repos`? (see D8)

Phase 1 keeps `/graph` single-repo (a cross-repo force-layout is the most
expensive, least useful view). Confirm no one needs a cross-repo dependency graph
soon; if they do, it needs explicit bounding before it ships.

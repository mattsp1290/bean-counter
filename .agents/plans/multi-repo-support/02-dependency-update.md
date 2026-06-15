# 02 — Dependency update (DONE in this branch)

This is Part A — the prerequisite bump. It is **already implemented and green**
in the working tree; this file records exactly what changed so the diff is
reviewable and reproducible.

## The bump

```bash
go get github.com/mattsp1290/beans@28a05fc
# github.com/mattsp1290/beans
#   v0.1.2-0.20260615002029-e52dce57b52c  (old, commit e52dce5)
#   -> v0.1.2-0.20260615191211-28a05fcd5aff  (new, commit 28a05fc)
go mod tidy
```

`go.mod` / `go.sum` updated. 70 beans commits of multi-repo work are now
available to bean-counter.

## What broke and the fix

Only the 5-method `prefix string -> ListFilter` rename (see `01`) reached our
code. The fixes preserve **identical behavior** (single-prefix scoping) — they
just wrap the prefix in `ListFilter{Prefix: ...}`. No behavior change yet; the
multi-repo behavior is Part B.

| File | Change |
|------|--------|
| `internal/store/adapter.go` | `ReadyIssues(ctx, a.projectPrefix, …)` → `ReadyIssues(ctx, ListFilter{Prefix: a.projectPrefix}, …)` |
| `internal/handlers/deps/deps.go` | local `Store` iface + call site: `ListBlockingDeps(ctx, string)` → `ListBlockingDeps(ctx, appstore.ListFilter)`; pass `ListFilter{Prefix: cfg.ProjectPrefix}` |
| `internal/handlers/graph/graph.go` | same `ListBlockingDeps` iface + call-site change |
| `internal/handlers/deps/deps_test.go` | `fakeStore.ListBlockingDeps` signature → `ListFilter`, record `f.Prefix` |
| `internal/handlers/graph/graph_test.go` | same fake update |

`ReadyIssues` on bean-counter's own `Adapter` keeps its zero-arg-scope signature
(it owns the prefix internally), so the `ready` handler + its fake were
untouched.

## Verification (run, passing)

```bash
go build ./...   # clean
go vet ./...     # clean
go test ./...    # all packages ok, incl. test/e2e
```

## ⚠ Deploy-ordering precondition (do not skip)

This bump pulls in the new beans multi-repo migrations, so bean-counter's
**embedded migration max is now higher than prod's shared DB.** The prod deploy
preflight has a hard parity gate (`scripts/deploy-production.sh:440-447`):

```
FAIL: bean-counter embedded migrations ($embedded_max) are NEWER than prod
($db_max); deploying would migrate the shared schema
```

So **merging A1 is fine, but it cannot be deployed to prod until** the
local-symphony orchestrator (owner of the shared Postgres) has itself bumped
beans to ≥ `28a05fc` and migrated the DB. The gate is one-directional — once
`db_max ≥ embedded_max`, bean-counter deploys cleanly. bean-counter must never be
the first to introduce these tables in prod. Tracked as task **A2** in `05` and
as `06` Q6.

## Note on the superseded plan

`.agents/plans/beans-0-1-1/` planned the *previous* bump (to `e52dce5`, schema
8) for prod parity. This bump moves past it to `28a05fc`. The schema-8 dep-type
behavior that plan analyzed is unchanged here; this bump is purely additive on
top of it plus the 5 renames above.

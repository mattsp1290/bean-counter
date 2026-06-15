# 01 — What beans now provides (grounded)

Basis: read of beans `28a05fc` planning docs
(`docs/prompts/multi-repo-support.md`, `docs/specs/repo-resolution-precedence.md`,
`.agents/plans/multi-repo-workspace-routing/*`) plus a direct API diff of the
`store` / `model` / `repo` packages between `e52dce5` and `28a05fc`.

## Conceptual model

- A **repo** is a git repository registered in the new `bn_repos` table. Key
  fields: `id` (app-generated text id), `prefix`, `slug`, `remote_url`
  (normalized), `default_branch`, `worktree_subdir`, `clone_strategy`,
  `auth_ref`, `enabled`.
- **Topology-a: `prefix == slug`.** A repo's project prefix *is* its slug, so an
  issue's existing `bn_issues.prefix` column already encodes its repo. Issue IDs
  are `<slug>-<hex>` (e.g. `my-api-abc123`, `my-frontend-xyz789`), so IDs across
  repos do not collide.
- **One repo per issue** (1:1) via `bn_issue_repos` (PK = `issue_id`), which also
  carries per-issue routing overrides: `requested_ref`, `base_ref`,
  `work_branch`, `worktree_subdir`.
- **Cross-repo dependencies are allowed** — `dep add <id1> <id2>` uses
  fully-qualified IDs, so a `my-frontend-*` issue can depend on a `my-api-*` one.

Because prefix == repo identity, **all existing prefix-scoped queries keep
working unchanged**; repo scoping comes "for free" from prefix filtering, and
"all repos" comes from *omitting* the prefix filter.

## API diff that matters to bean-counter

bean-counter imports only `beans/store`, `beans/model`, `beans/repo`.

### `model` — no changes
`Issue`, `Priority`, `IssueState`, `RepoTarget` are byte-identical. No consumer
impact. (bean-counter already re-exports + maps `RepoTarget` in its DTO.)

### `repo` — additive only
- NEW `func NormalizeRemoteURL(remote string) (string, error)` — canonicalizes
  any transport form to one key (strips `.git`, default ports, userinfo).
- NEW `var ErrNoRemote` — empty input → local-only repo.
- Existing validators (`ValidateDefaultBranch`, `ValidateWorktreeSubdir`, …)
  unchanged. bean-counter's `validate.go` use of them is unaffected.

### `store` — 5 BREAKING renames + additive repo registry

**Breaking (the only call-site breaks):** five read methods changed their scope
argument from `prefix string` to `f ListFilter`:

```
ReadyIssues(ctx, prefix, term, active)        -> ReadyIssues(ctx, ListFilter, term, active)
ListDeps(ctx, prefix)                         -> ListDeps(ctx, ListFilter)
ListBlockingDeps(ctx, prefix)                 -> ListBlockingDeps(ctx, ListFilter)
ListMembers(ctx, prefix, parentID)            -> ListMembers(ctx, ListFilter, parentID)
ListParents(ctx, prefix, childID)             -> ListParents(ctx, ListFilter, childID)
```

They read `f.Prefix` for per-repo scope and honor `f.AllRepos` (omit the prefix
WHERE clause → cross-repo). `ListIssues` already took `ListFilter`.

**Additive (the multi-repo toolbox):**

- `ListFilter` gains `AllRepos bool`.
- `IssueRepoInput` gains `RemoteURL string` (Create-only): triggers
  `AutoRegisterRepo` before the issue tx and derives the issue prefix from the
  registered repo. Ignored by `UpdateIssue`.
- New `*Store` methods (signatures verified against `store/repo_store.go` @
  `28a05fc`):
  - `ListRepos(ctx, prefix string, includeDisabled bool) ([]Repo, error)` —
    **prefix-scoped** (`WHERE prefix = ?`).
  - `GetRepoBySlug(ctx, prefix, slug string) (Repo, error)`
  - `GetRepoByRemoteURL(ctx, remoteURL string) (Repo, error)` — the only
    prefix-free repo accessor.
  - `ResolveRepoAlias(ctx, prefix, alias string) (Repo, error)`
  - `CreateRepo(ctx, CreateRepoInput) (Repo, error)`
  - `UpdateRepo(ctx, prefix, slug string, in UpdateRepoInput) (Repo, error)`
  - `DisableRepo(ctx, prefix, slug, actor string) (Repo, error)`
  - `AutoRegisterRepo(ctx, AutoRegisterInput) (Repo, error)` — idempotent
    lookup-or-create by normalized URL, with slug disambiguation.
  - `AddRepoAdmin` / `RemoveRepoAdmin` / `ListRepoAdmins` / `AuthorizeRepoAdmin`
  - `InsertRepoAudit` / `ListRepoAudit`
  - `EnsureProject` / `ProjectExists` / `DeleteProject(ctx, prefix, actor, force)`
- `Repo` struct fields: `ID, Prefix, Slug, DisplayName, RemoteURL, DefaultBranch,
  WorktreeSubdir, CloneStrategy, AuthRef, Enabled, Metadata, CreatedAt/By,
  UpdatedAt/By`.
- New types: `Repo`, `CreateRepoInput`, `UpdateRepoInput`, `AutoRegisterInput`.
- New sentinel: `ErrSlugExhausted`.

### ⚠ Constraint: beans has NO global repo/project enumeration

Every registry accessor is **prefix-scoped**, and under topology-a a prefix
selects exactly one repo. There is **no `ListAllRepos` / `ListProjects`** method
in beans `28a05fc` (verified: only `EnsureProject` / `ProjectExists` /
`DeleteProject` exist for projects). So bean-counter **cannot** ask beans "what
repos exist in this DB?" directly. This breaks the naïve `GET /repos → ListRepos`
design; the workaround is in `03` D5 / `04` §6.

What *is* available: `ListIssues(ListFilter{AllRepos: true})` calls
`populateIssueRepos`, which hydrates each issue's `Repo *RepoTarget` (carrying
`ID, Slug, RemoteURL, DefaultBranch`). So the set of repos **that have issues**
is derivable from a cross-repo issue list.

### CreateIssue prefix derivation (verified `store/store.go:208-237`)

- `Repo.RemoteURL` set → beans `AutoRegisterRepo`s and sets the issue prefix from
  the repo (`effectivePrefix = resolved.Prefix`); slug defaults to the resolved
  slug. `AutoRegisterRepo` defaults `DefaultBranch`/`AuthRef` — an issue-create
  caller can't set them.
- `RepoSlug` only (no URL) → `effectivePrefix = in.Prefix` **verbatim**; beans
  does **not** look up the slug to find a prefix. The caller must supply the
  right prefix. Under topology-a (`prefix == slug`) that means the target prefix
  *is* the slug.
- neither → `in.Prefix` required, else error.

### Schema / migrations
beans owns its migrations (`beans/store.New` runs them — bean-counter must NOT
add its own). The multi-repo tables (`bn_repos`, `bn_issue_repos`,
`bn_repo_aliases`, `bn_repo_audit`, `bn_project_admins`) are created by beans on
`store.New`. bean-counter gets them automatically on connect.

## Implication for bean-counter

The hard break is tiny (5 method signatures, only a few call sites — handled in
`02`). The *opportunity* is large: the registry methods + `AllRepos` +
`IssueRepoInput.RemoteURL` are exactly the primitives needed to make bean-counter
multi-repo. The work in `04` is plumbing, not new database logic.

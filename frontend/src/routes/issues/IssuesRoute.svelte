<script lang="ts">
  import { onMount } from 'svelte'

  import {
    ApiError,
    api,
    type Issue,
    type IssueState,
  } from '../../lib/api'
  import EmptyState from '../../lib/components/EmptyState.svelte'
  import ErrorState from '../../lib/components/ErrorState.svelte'
  import LoadingState from '../../lib/components/LoadingState.svelte'
  import { statePillClass, stateLabel } from '../../lib/ui/state'
  import {
    emptyIssueForm,
    issueFormToCreateRequest,
    issueFormToUpdateRequest,
    issueToIssueForm,
    validateIssueForm,
  } from './form'

  interface Props {
    pathname: string
    navigate: (path: string) => void
  }

  type Mode = 'list' | 'create' | 'detail' | 'edit'

  let { pathname, navigate }: Props = $props()

  let issues = $state<Issue[]>([])
  let dependencyCandidates = $state<Issue[]>([])
  let selectedIssue = $state<Issue | null>(null)
  let listLoading = $state(false)
  let detailLoading = $state(false)
  let saving = $state(false)
  let error = $state('')
  let stateFilter = $state<'all' | IssueState>('all')
  let search = $state('')
  let formError = $state('')
  let dependencyError = $state('')
  let dependencyInput = $state('')
  let dependencySaving = $state(false)
  let form = $state(emptyIssueForm())

  const route = $derived(parseIssueRoute(pathname))
  const visibleIssues = $derived(filterIssues(issues, search))
  const dependencyOptions = $derived(availableDependencyOptions(dependencyCandidates, selectedIssue))

  onMount(() => {
    void loadIssues()
    void loadDependencyCandidates()
  })

  $effect(() => {
    if (route.mode === 'detail' || route.mode === 'edit') {
      void loadIssue(route.id)
    } else {
      selectedIssue = null
    }
  })

  async function loadIssues() {
    listLoading = true
    error = ''
    try {
      const response = await api.listIssues({
        state: stateFilter === 'all' ? undefined : stateFilter,
      })
      issues = response.issues
      syncSelectedIssueFromList()
    } catch (err) {
      error = errorMessage(err)
    } finally {
      listLoading = false
    }
  }

  async function loadDependencyCandidates() {
    try {
      const response = await api.listIssues()
      dependencyCandidates = response.issues
      syncSelectedIssueFromCandidates()
    } catch (err) {
      if (selectedIssue) {
        dependencyError = errorMessage(err)
      }
    }
  }

  async function loadIssue(id: string) {
    detailLoading = true
    error = ''
    try {
      selectedIssue = await api.getIssue(id)
      dependencyInput = defaultDependencyInput(selectedIssue, dependencyCandidates)
      dependencyError = ''
      if (route.mode === 'edit') {
        form = issueToIssueForm(selectedIssue)
      }
    } catch (err) {
      error = errorMessage(err)
      selectedIssue = null
    } finally {
      detailLoading = false
    }
  }

  function startCreate() {
    form = emptyIssueForm()
    formError = ''
    navigate('/issues/new')
  }

  function startEdit(issue: Issue) {
    form = issueToIssueForm(issue)
    formError = ''
    navigate(`/issues/${issue.id}/edit`)
  }

  async function addDependency(event: SubmitEvent) {
    event.preventDefault()
    if (!selectedIssue || dependencyInput === '') {
      dependencyError = 'Choose an issue to add as a blocker.'
      return
    }
    dependencySaving = true
    dependencyError = ''
    try {
      await api.addDependency(selectedIssue.id, { blocked_by_id: dependencyInput })
      await refreshSelectedIssue(selectedIssue.id)
    } catch (err) {
      dependencyError = errorMessage(err)
    } finally {
      dependencySaving = false
    }
  }

  async function removeDependency(blockedById: string) {
    if (!selectedIssue) {
      return
    }
    dependencySaving = true
    dependencyError = ''
    try {
      await api.removeDependency(selectedIssue.id, blockedById)
      await refreshSelectedIssue(selectedIssue.id)
    } catch (err) {
      dependencyError = errorMessage(err)
    } finally {
      dependencySaving = false
    }
  }

  async function submitIssue(event: SubmitEvent) {
    event.preventDefault()
    formError = validateIssueForm(form)
    if (formError !== '') {
      return
    }
    saving = true
    try {
      const issue =
        route.mode === 'edit' && route.id !== ''
          ? await api.updateIssue(route.id, issueFormToUpdateRequest(form))
          : await api.createIssue(issueFormToCreateRequest(form))
      await loadIssues()
      navigate(`/issues/${issue.id}`)
    } catch (err) {
      formError = errorMessage(err)
    } finally {
      saving = false
    }
  }

  async function closeIssue(issue: Issue) {
    if (!window.confirm(`Close ${issue.id}?`)) {
      return
    }
    try {
      selectedIssue = await api.closeIssue(issue.id, { reason: 'completed from UI' })
      await loadIssues()
    } catch (err) {
      error = errorMessage(err)
    }
  }

  async function deleteIssue(issue: Issue) {
    if (!window.confirm(`Delete ${issue.id}?`)) {
      return
    }
    try {
      await api.deleteIssue(issue.id)
      await loadIssues()
      navigate('/')
    } catch (err) {
      error = errorMessage(err)
    }
  }

  function setStateFilter(value: 'all' | IssueState) {
    stateFilter = value
    void loadIssues()
  }

  async function refreshSelectedIssue(id: string) {
    selectedIssue = await api.getIssue(id)
    dependencyInput = defaultDependencyInput(selectedIssue, dependencyCandidates)
    void refreshIssueLists()
  }

  async function refreshIssueLists() {
    await Promise.allSettled([loadIssues(), loadDependencyCandidates()])
  }

  function parseIssueRoute(path: string): { mode: Mode; id: string } {
    if (path === '/issues/new') {
      return { mode: 'create', id: '' }
    }
    const edit = path.match(/^\/issues\/([^/]+)\/edit$/)
    if (edit) {
      return { mode: 'edit', id: decodeURIComponent(edit[1]) }
    }
    const detail = path.match(/^\/issues\/([^/]+)$/)
    if (detail) {
      return { mode: 'detail', id: decodeURIComponent(detail[1]) }
    }
    return { mode: 'list', id: '' }
  }

  function filterIssues(items: Issue[], query: string): Issue[] {
    const needle = query.trim().toLowerCase()
    if (needle === '') {
      return items
    }
    return items.filter((issue) =>
      [issue.id, issue.title, issue.state, issue.issue_type, ...issue.labels]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }

  function availableDependencyOptions(items: Issue[], issue: Issue | null): Issue[] {
    if (!issue) {
      return []
    }
    const existing = new Set(issue.blocked_by)
    return items
      .filter((candidate) => candidate.id !== issue.id && !existing.has(candidate.id))
      .sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title))
  }

  function defaultDependencyInput(issue: Issue | null, items: Issue[]): string {
    return availableDependencyOptions(items, issue)[0]?.id ?? ''
  }

  function syncSelectedIssueFromList() {
    if (!selectedIssue) {
      return
    }
    const updated = issues.find((issue) => issue.id === selectedIssue?.id)
    if (updated) {
      selectedIssue = updated
      if (
        dependencyInput === '' ||
        !availableDependencyOptions(dependencyCandidates, selectedIssue).some((issue) => issue.id === dependencyInput)
      ) {
        dependencyInput = defaultDependencyInput(selectedIssue, dependencyCandidates)
      }
    }
  }

  function syncSelectedIssueFromCandidates() {
    if (!selectedIssue) {
      return
    }
    const updated = dependencyCandidates.find((issue) => issue.id === selectedIssue?.id)
    if (updated) {
      selectedIssue = updated
    }
    if (
      dependencyInput === '' ||
      !availableDependencyOptions(dependencyCandidates, selectedIssue).some((issue) => issue.id === dependencyInput)
    ) {
      dependencyInput = defaultDependencyInput(selectedIssue, dependencyCandidates)
    }
  }

  function issueLabel(id: string): string {
    const issue = dependencyCandidates.find((item) => item.id === id) ?? issues.find((item) => item.id === id)
    return issue ? `${issue.title} (${issue.id})` : id
  }

  function errorMessage(err: unknown): string {
    if (err instanceof ApiError) {
      return err.fields?.map((field) => `${field.field}: ${field.message}`).join(', ') || err.message
    }
    return err instanceof Error ? err.message : 'Request failed.'
  }
</script>

<section
  class="grid grid-cols-[minmax(320px,0.9fr)_minmax(360px,1.1fr)] gap-4 max-mobile:grid-cols-1"
  aria-label="Issues workspace"
>
  <div class="card min-w-0">
    <div class="flex items-end gap-3 border-b border-border p-3.5 max-mobile:flex-col max-mobile:items-stretch">
      <label class="field-label">
        <span>Filter</span>
        <input class="field" bind:value={search} type="search" placeholder="Title, label, or id" />
      </label>
      <select
        class="field max-w-[160px] max-mobile:max-w-none"
        aria-label="State"
        value={stateFilter}
        onchange={(event) => setStateFilter(event.currentTarget.value as 'all' | IssueState)}
      >
        <option value="all">All states</option>
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="blocked">Blocked</option>
        <option value="closed">Closed</option>
        <option value="done">Done</option>
      </select>
      <button class="btn" type="button" onclick={startCreate}>New issue</button>
    </div>

    {#if listLoading}
      <LoadingState message="Loading issues" />
    {:else if error !== '' && issues.length === 0}
      <ErrorState title="Could not load issues" message={error} />
    {:else if visibleIssues.length === 0}
      <EmptyState title="No issues found" message="Create an issue or adjust the current filters." />
    {:else}
      <div class="grid" role="list" aria-label="Issues">
        {#each visibleIssues as issue}
          {@const active = route.id === issue.id}
          <button
            type="button"
            class={[
              'grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-l-2 border-border px-3.5 py-3 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
              active
                ? 'border-l-primary bg-surface-2'
                : 'border-l-transparent hover:bg-surface-2',
            ]}
            onclick={() => navigate(`/issues/${issue.id}`)}
          >
            <span class="grid min-w-0 gap-1">
              <strong class="truncate text-text">{issue.title}</strong>
              <small class="truncate text-muted">{issue.id}</small>
            </span>
            <span class="pill {statePillClass(issue.state)}">{stateLabel(issue.state)}</span>
            <span class="text-[13px] text-muted">P{issue.priority}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="card min-w-0">
    {#if route.mode === 'create' || route.mode === 'edit'}
      <form class="grid gap-3.5 p-[18px]" onsubmit={submitIssue}>
        <div>
          <h2 class="text-[22px] font-semibold text-text">
            {route.mode === 'edit' ? 'Edit issue' : 'Create issue'}
          </h2>
          <p class="text-muted">{route.mode === 'edit' ? route.id : 'Add work to the current project.'}</p>
        </div>

        {#if formError !== ''}
          <p class="error-panel">{formError}</p>
        {/if}

        <label class="field-label">
          <span>Title</span>
          <input class="field" bind:value={form.title} required maxlength="300" />
        </label>

        <label class="field-label">
          <span>Description</span>
          <textarea class="field min-h-[120px] resize-y py-2.5" bind:value={form.description} maxlength="20000"></textarea>
        </label>

        <div class="grid grid-cols-2 gap-3 max-mobile:grid-cols-1">
          <label class="field-label">
            <span>Priority</span>
            <input class="field" bind:value={form.priority} type="number" min="0" max="4" />
          </label>

          {#if route.mode === 'create'}
            <label class="field-label">
              <span>Type</span>
              <select class="field" bind:value={form.issue_type}>
                <option value="bug">Bug</option>
                <option value="feature">Feature</option>
                <option value="task">Task</option>
                <option value="epic">Epic</option>
                <option value="chore">Chore</option>
              </select>
            </label>
          {:else}
            <label class="field-label">
              <span>Type</span>
              <input class="field" value={form.issue_type} disabled />
            </label>
          {/if}
        </div>

        <label class="field-label">
          <span>Labels</span>
          <input class="field" bind:value={form.labels} placeholder="ui, api" />
        </label>

        <label class="field-label">
          <span>Branch</span>
          <input class="field" bind:value={form.branch_name} maxlength="255" />
        </label>

        <label class="field-label">
          <span>URL</span>
          <input class="field" bind:value={form.url} type="url" maxlength="2048" />
        </label>

        <div class="flex flex-wrap gap-2">
          <button class="btn" disabled={saving} type="submit">{saving ? 'Saving' : 'Save issue'}</button>
          <button type="button" class="btn btn-secondary" onclick={() => navigate(route.id ? `/issues/${route.id}` : '/')}>
            Cancel
          </button>
        </div>
      </form>
    {:else if detailLoading}
      <LoadingState message="Loading issue" />
    {:else if route.mode === 'detail' && selectedIssue}
      <article class="grid gap-3.5 p-[18px]">
        {#if error !== ''}
          <p class="error-panel">{error}</p>
        {/if}
        <div>
          <h2 class="text-[22px] font-semibold text-text">{selectedIssue.title}</h2>
          <p class="text-muted">{selectedIssue.id} · {selectedIssue.issue_type} · P{selectedIssue.priority}</p>
        </div>
        <p class="pill {statePillClass(selectedIssue.state)}">{stateLabel(selectedIssue.state)}</p>
        <p class="text-muted">{selectedIssue.description || 'No description.'}</p>
        <div class="flex flex-wrap gap-1.5">
          {#each selectedIssue.labels as label}
            <span class="pill">{label}</span>
          {/each}
        </div>
        <dl class="grid gap-2">
          <div class="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
            <dt class="text-muted">Created</dt>
            <dd class="m-0">{new Date(selectedIssue.created_at).toLocaleString()}</dd>
          </div>
          <div class="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
            <dt class="text-muted">Updated</dt>
            <dd class="m-0">{new Date(selectedIssue.updated_at).toLocaleString()}</dd>
          </div>
        </dl>
        <section class="grid gap-3 border-t border-border pt-3.5" aria-label="Dependencies">
          <div>
            <h3 class="text-[17px] font-semibold text-text">Blocked by</h3>
            <p class="text-muted">Issues that must close before this work is ready.</p>
          </div>

          {#if dependencyError !== ''}
            <p class="error-panel" role="alert">{dependencyError}</p>
          {/if}

          {#if selectedIssue.blocked_by.length === 0}
            <p class="text-muted">No blockers.</p>
          {:else}
            <ul class="grid gap-2" aria-label="Current blockers">
              {#each selectedIssue.blocked_by as blockedById}
                <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border border-border px-2.5 py-2 max-mobile:grid-cols-1">
                  <span class="truncate">{issueLabel(blockedById)}</span>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    disabled={dependencySaving}
                    aria-label={`Remove blocker ${issueLabel(blockedById)}`}
                    onclick={() => removeDependency(blockedById)}
                  >
                    Remove
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <form class="flex items-end gap-2.5 max-mobile:flex-col max-mobile:items-stretch" onsubmit={addDependency}>
            <label class="field-label">
              <span>Add blocker</span>
              <select class="field" bind:value={dependencyInput} disabled={dependencyOptions.length === 0 || dependencySaving}>
                {#if dependencyOptions.length === 0}
                  <option value="">No available issues</option>
                {:else}
                  {#each dependencyOptions as issue}
                    <option value={issue.id}>{issue.title} ({issue.id})</option>
                  {/each}
                {/if}
              </select>
            </label>
            <button class="btn" type="submit" disabled={dependencyOptions.length === 0 || dependencySaving}>
              {dependencySaving ? 'Updating' : 'Add blocker'}
            </button>
          </form>
        </section>
        <div class="flex flex-wrap gap-2">
          <button class="btn" type="button" onclick={() => startEdit(selectedIssue!)}>Edit</button>
          <button type="button" class="btn btn-secondary" onclick={() => closeIssue(selectedIssue!)}>Close</button>
          <button type="button" class="btn btn-danger" onclick={() => deleteIssue(selectedIssue!)}>Delete</button>
        </div>
      </article>
    {:else if error !== ''}
      <ErrorState title="Could not load issue" message={error} />
    {:else}
      <EmptyState title="Select an issue" message="Choose an issue from the list or create a new one." />
    {/if}
  </div>
</section>

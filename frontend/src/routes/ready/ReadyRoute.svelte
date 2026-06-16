<script lang="ts">
  import { onMount } from 'svelte'

  import { ApiError, api, type Issue } from '../../lib/api'
  import EmptyState from '../../lib/components/EmptyState.svelte'
  import ErrorState from '../../lib/components/ErrorState.svelte'
  import LoadingState from '../../lib/components/LoadingState.svelte'
  import { statePillClass, stateLabel } from '../../lib/ui/state'

  interface Props {
    navigate: (path: string) => void
  }

  let { navigate }: Props = $props()

  let issues = $state<Issue[]>([])
  let loading = $state(false)
  let error = $state('')
  let refreshedAt = $state<Date | null>(null)

  onMount(() => {
    void loadReadyQueue()
  })

  async function loadReadyQueue() {
    loading = true
    error = ''
    try {
      const response = await api.ready()
      issues = response.issues
      refreshedAt = new Date()
    } catch (err) {
      error = errorMessage(err)
    } finally {
      loading = false
    }
  }

  function errorMessage(err: unknown): string {
    if (err instanceof ApiError) {
      return err.fields?.map((field) => `${field.field}: ${field.message}`).join(', ') || err.message
    }
    return err instanceof Error ? err.message : 'Request failed.'
  }

  function ageLabel(issue: Issue): string {
    const updatedAt = new Date(issue.updated_at).getTime()
    const elapsed = Math.max(0, Date.now() - updatedAt)
    const minutes = Math.floor(elapsed / 60000)
    if (minutes < 1) {
      return 'Updated just now'
    }
    if (minutes < 60) {
      return `Updated ${minutes}m ago`
    }
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
      return `Updated ${hours}h ago`
    }
    return `Updated ${Math.floor(hours / 24)}d ago`
  }
</script>

<section class="card" aria-label="Ready queue workspace">
  <div class="flex items-end justify-between gap-3 border-b border-border p-3.5 max-mobile:flex-col max-mobile:items-stretch">
    <div class="flex flex-wrap items-baseline gap-1.5 text-muted">
      <strong class="text-2xl text-text">{issues.length}</strong>
      <span>{issues.length === 1 ? 'ready issue' : 'ready issues'}</span>
      {#if refreshedAt}
        <small class="basis-full text-muted">Refreshed {refreshedAt.toLocaleTimeString()}</small>
      {/if}
    </div>
    <button type="button" class="btn btn-secondary" disabled={loading} onclick={loadReadyQueue}>
      {loading ? 'Refreshing' : 'Refresh'}
    </button>
  </div>

  {#if loading && issues.length === 0}
    <LoadingState message="Loading ready queue" />
  {:else if error !== '' && issues.length === 0}
    <ErrorState title="Could not load ready queue" message={error} />
  {:else if issues.length === 0}
    <EmptyState title="No ready work" message="Blocked and closed issues are excluded from this queue." />
  {:else}
    {#if error !== ''}
      <p class="error-panel m-3.5" role="alert">{error}</p>
    {/if}
    <ul class="grid" aria-label="Ready issues">
      {#each issues as issue, index}
        <li class="min-w-0">
          <button
            type="button"
            class="grid w-full min-h-[72px] grid-cols-[40px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-3.5 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus max-mobile:grid-cols-[32px_minmax(0,1fr)]"
            onclick={() => navigate(`/issues/${issue.id}`)}
          >
            <span class="grid size-8 place-items-center rounded-md bg-accent-subtle font-bold text-accent-fg">{index + 1}</span>
            <span class="grid min-w-0 gap-1">
              <strong class="truncate text-text">{issue.title}</strong>
              <small class="truncate text-muted">{issue.id} · {issue.issue_type} · {ageLabel(issue)}</small>
            </span>
            <span class="pill {statePillClass(issue.state)} max-mobile:justify-self-start">{stateLabel(issue.state)}</span>
            <span class="pill max-mobile:justify-self-start">P{issue.priority}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

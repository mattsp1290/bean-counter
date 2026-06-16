<script lang="ts">
  import { onMount } from 'svelte'

  import { ApiError, api, type GraphResponse } from '../../lib/api'
  import { graphEdgePath, layoutDependencyGraph } from '../../lib/graph'
  import EmptyState from '../../lib/components/EmptyState.svelte'
  import ErrorState from '../../lib/components/ErrorState.svelte'
  import LoadingState from '../../lib/components/LoadingState.svelte'
  import { statePillClass, stateLabel } from '../../lib/ui/state'

  let graph = $state<GraphResponse>({ nodes: [], edges: [] })
  let loading = $state(false)
  let error = $state('')
  let selectedID = $state('')
  let refreshedAt = $state<Date | null>(null)

  const layout = $derived(layoutDependencyGraph(graph.nodes, graph.edges))
  const selectedNode = $derived(layout.nodes.find((node) => node.id === selectedID) ?? layout.nodes[0])
  const selectedEdges = $derived(
    selectedNode ? layout.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id) : [],
  )

  onMount(() => {
    void loadGraph()
  })

  async function loadGraph() {
    loading = true
    error = ''
    try {
      graph = await api.graph()
      refreshedAt = new Date()
      if (selectedID !== '' && !graph.nodes.some((node) => node.id === selectedID)) {
        selectedID = ''
      }
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

  function nodeTitle(value: string): string {
    return value.length > 20 ? `${value.slice(0, 19)}...` : value
  }
</script>

<section class="card" aria-label="Dependency graph workspace">
  <div class="flex items-end justify-between gap-3 border-b border-border p-3.5 max-mobile:flex-col max-mobile:items-stretch">
    <div class="flex flex-wrap items-baseline gap-1.5 text-muted">
      <strong class="text-2xl text-text">{graph.nodes.length}</strong>
      <span>{graph.nodes.length === 1 ? 'issue' : 'issues'}</span>
      <strong class="text-2xl text-text">{graph.edges.length}</strong>
      <span>{graph.edges.length === 1 ? 'dependency' : 'dependencies'}</span>
      {#if refreshedAt}
        <small class="basis-full text-muted">Refreshed {refreshedAt.toLocaleTimeString()}</small>
      {/if}
    </div>
    <button type="button" class="btn btn-secondary" disabled={loading} onclick={loadGraph}>
      {loading ? 'Refreshing' : 'Refresh'}
    </button>
  </div>

  {#if loading && graph.nodes.length === 0}
    <LoadingState message="Loading dependency graph" />
  {:else if error !== '' && graph.nodes.length === 0}
    <ErrorState title="Could not load graph" message={error} />
  {:else if graph.nodes.length === 0}
    <EmptyState title="No graph data" message="Create issues and dependencies to build the graph." />
  {:else}
    <div class="graph-content">
      <div class="graph-canvas" aria-label="Dependency network">
        {#if error !== ''}
          <p class="error-panel" role="alert">{error}</p>
        {/if}
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-label="Dependency graph"
          style={`width: ${layout.width}px; height: ${layout.height}px;`}
        >
          <defs>
            <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z"></path>
            </marker>
          </defs>
          {#each layout.edges as edge}
            <path class="graph-edge" d={graphEdgePath(edge)} marker-end="url(#graph-arrow)">
              <title>{edge.source} blocks {edge.target}</title>
            </path>
          {/each}
          {#each layout.nodes as node}
            <g
              class:selected={selectedNode?.id === node.id}
              class="graph-node"
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabindex="0"
              aria-label={`${node.title}, ${node.state}, priority ${node.priority}`}
              onclick={() => (selectedID = node.id)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  selectedID = node.id
                }
              }}
            >
              <title>{node.title} ({node.id})</title>
              <rect x="-70" y="-30" width="140" height="60" rx="8"></rect>
              <text y="-7" text-anchor="middle">{nodeTitle(node.title)}</text>
              <text y="14" text-anchor="middle">{node.state} · P{node.priority}</text>
            </g>
          {/each}
        </svg>
      </div>

      <aside class="graph-inspector" aria-label="Selected issue">
        {#if selectedNode}
          <div>
            <h2 class="text-xl font-semibold text-text">{selectedNode.title}</h2>
            <p class="text-muted">{selectedNode.id}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span class="pill {statePillClass(selectedNode.state)}">{stateLabel(selectedNode.state)}</span>
            <span class="pill">P{selectedNode.priority}</span>
            <span class="pill">{selectedNode.incoming} blockers</span>
            <span class="pill">{selectedNode.outgoing} blocked</span>
          </div>
          {#if selectedNode.labels.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each selectedNode.labels as label}
                <span class="pill">{label}</span>
              {/each}
            </div>
          {/if}
          <div class="grid gap-2.5">
            <h3 class="text-base font-semibold text-text">Relationships</h3>
            {#if selectedEdges.length === 0}
              <p class="text-muted">No dependencies yet.</p>
            {:else}
              <ul class="grid gap-2">
                {#each selectedEdges as edge}
                  <li class="grid gap-0.5 rounded-md border border-border px-2.5 py-2">
                    <span class="truncate text-text">{edge.sourceNode.title}</span>
                    <small class="text-muted">blocks</small>
                    <span class="truncate text-text">{edge.targetNode.title}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</section>

<style>
  /*
   * Layout + SVG painting that Tailwind utilities can't cleanly express
   * (descendant/:first-of-type/:focus-visible/.selected on generated SVG, and
   * the marker arrowhead which is painted in marker space). All colors are
   * driven by the semantic theme tokens, so this stays theme-correct.
   */
  .graph-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    min-height: 520px;
  }

  .graph-canvas {
    min-width: 0;
    border-right: 1px solid var(--color-border-strong);
    overflow: auto;
    padding: 16px;
  }

  svg {
    display: block;
    min-width: max(720px, 100%);
    min-height: 440px;
  }

  marker path {
    fill: var(--color-muted);
  }

  .graph-edge {
    fill: none;
    stroke: var(--color-muted);
    stroke-width: 2;
  }

  .graph-node {
    cursor: pointer;
    outline: none;
  }

  .graph-node rect {
    fill: var(--color-surface-2);
    stroke: var(--color-border-strong);
    stroke-width: 1.5;
  }

  .graph-node:hover rect,
  .graph-node:focus-visible rect,
  .graph-node.selected rect {
    fill: var(--color-surface);
    stroke: var(--color-primary);
    stroke-width: 2;
  }

  /* Keyboard focus on the only interactive SVG element must be visible. */
  .graph-node:focus-visible rect {
    stroke: var(--color-focus);
    stroke-width: 2.5;
  }

  .graph-node text:first-of-type {
    fill: var(--color-text);
    font-size: 14px;
    font-weight: 700;
  }

  .graph-node text:last-of-type {
    fill: var(--color-muted);
    font-size: 12px;
  }

  .graph-inspector {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 18px;
  }

  @media (max-width: 900px) {
    .graph-content {
      grid-template-columns: 1fr;
    }

    .graph-canvas {
      border-right: 0;
      border-bottom: 1px solid var(--color-border-strong);
    }
  }
</style>

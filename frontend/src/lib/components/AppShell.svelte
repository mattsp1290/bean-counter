<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AppRoute } from '../../routes'
  import ThemeToggle from './ThemeToggle.svelte'

  interface Props {
    routes: AppRoute[]
    activePath: string
    onNavigate: (event: MouseEvent, path: string) => void
    title: Snippet
    children: Snippet
  }

  let { routes, activePath, onNavigate, title, children }: Props = $props()
</script>

<div class="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] max-mobile:grid-cols-1">
  <aside
    class="border-r border-border-strong bg-surface-2 p-5 max-mobile:border-r-0 max-mobile:border-b"
    aria-label="Primary navigation"
  >
    <a
      class="mb-6 flex min-h-11 items-center gap-2.5 text-text no-underline"
      href="/"
      onclick={(event) => onNavigate(event, '/')}
    >
      <span
        class="grid size-9 place-items-center rounded-md bg-primary font-bold text-primary-fg"
        aria-hidden="true">bc</span
      >
      <span class="grid gap-0.5">
        <strong class="font-bold">Bean Counter</strong>
        <small class="text-[13px] text-muted">Local tracker</small>
      </span>
    </a>

    <nav class="grid gap-1">
      {#each routes as route}
        {@const active = route.path === activePath}
        <a
          class={[
            'rounded-md border-l-2 px-3 py-2.5 no-underline transition-colors',
            active
              ? 'border-primary bg-surface-2 font-medium text-text'
              : 'border-transparent text-muted hover:bg-surface hover:text-text',
          ]}
          href={route.path}
          onclick={(event) => onNavigate(event, route.path)}
          aria-current={active ? 'page' : undefined}
        >
          {route.label}
        </a>
      {/each}
    </nav>

    <ThemeToggle />
  </aside>

  <main class="min-w-0 p-6 max-mobile:p-[18px]">
    <header
      class="mb-5 flex items-center justify-between gap-4 max-mobile:flex-col max-mobile:items-stretch"
    >
      <div>
        {@render title()}
      </div>
      <button class="btn" type="button" onclick={(event) => onNavigate(event, '/issues/new')}
        >New issue</button
      >
    </header>

    {@render children()}
  </main>
</div>

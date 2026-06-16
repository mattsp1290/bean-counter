<script lang="ts">
  // Dark is the default. This toggle flips the data-theme attribute on <html>
  // and persists the choice; the initial dark attribute is set inline in
  // index.html so there is no flash before this component mounts.
  type Theme = 'dark' | 'light'

  function current(): Theme {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  }

  let theme = $state<Theme>(current())

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('bc-theme', theme)
    } catch {
      // storage unavailable (private mode) — toggle still works for the session
    }
  }
</script>

<button
  type="button"
  class="btn btn-secondary mt-4 w-full justify-start gap-2"
  onclick={toggle}
  aria-pressed={theme === 'light'}
  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
>
  <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
  <span>{theme === 'dark' ? 'Dark' : 'Light'} theme</span>
</button>

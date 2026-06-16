<script lang="ts">
  interface Props {
    label?: string
    message: string
  }

  let { label = 'Loading', message }: Props = $props()
</script>

<div
  class="grid min-h-[280px] place-content-center gap-3 p-6 text-center"
  role="status"
  aria-label={label}
>
  <span
    class="size-6 justify-self-center rounded-full border-[3px] border-border-strong border-t-primary motion-safe:animate-spin"
    aria-hidden="true"
  ></span>
  <p class="text-muted">{message}</p>
</div>

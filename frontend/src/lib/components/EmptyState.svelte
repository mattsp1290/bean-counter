<script lang="ts">
  interface Props {
    title: string
    message: string
  }

  let { title, message }: Props = $props()
</script>

<div class="grid min-h-[280px] place-content-center gap-1.5 p-6 text-center">
  <h2 class="text-xl font-semibold text-text">{title}</h2>
  <p class="text-muted">{message}</p>
</div>

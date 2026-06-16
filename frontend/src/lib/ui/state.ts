import type { IssueState } from '../api'

/**
 * Color-coded pill classes per issue state. One source of truth shared by the
 * issues list, ready queue, and graph inspector so state reads consistently.
 * Each pairing meets WCAG AA (≥4.5:1 text on its background) in the dark theme.
 * Full literal class strings so Tailwind's content scanner detects them.
 */
const STATE_PILL: Record<IssueState, string> = {
  open: 'bg-surface-2 text-text',
  in_progress: 'bg-warning-subtle text-warning',
  blocked: 'bg-danger-subtle text-danger-text',
  closed: 'bg-surface-2 text-muted',
  done: 'bg-accent-subtle text-accent-fg',
}

const STATE_LABEL: Record<IssueState, string> = {
  open: 'open',
  in_progress: 'in progress',
  blocked: 'blocked',
  closed: 'closed',
  done: 'done',
}

export function statePillClass(state: string): string {
  return STATE_PILL[state as IssueState] ?? 'bg-surface-2 text-muted'
}

export function stateLabel(state: string): string {
  return STATE_LABEL[state as IssueState] ?? state
}

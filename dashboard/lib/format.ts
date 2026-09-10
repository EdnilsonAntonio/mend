import type { HealConfidence, HealStatus } from './types';

export const EMPTY_CELL = '—';

export function formatTimestamp(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso)) {
    return iso;
  }
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

const statusLabels: Record<HealStatus, string> = {
  investigating: 'Investigating',
  healed: 'Healed',
  needs_review: 'Needs review',
  failed: 'Failed',
};

export function statusLabel(status: HealStatus): string {
  return statusLabels[status];
}

const confidenceLabels: Record<HealConfidence, string> = {
  high: 'High',
  low: 'Low',
  none: 'None',
};

export function confidenceLabel(confidence: HealConfidence): string {
  return confidenceLabels[confidence];
}

export function statusBadgeClass(status: HealStatus): string {
  return `badge badge-status-${status}`;
}

export function confidenceBadgeClass(confidence: HealConfidence): string {
  return `badge badge-confidence-${confidence}`;
}

export function truncate(text: string, maxChars: number): string {
  if (maxChars < 1) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

export function shortId(id: string): string {
  const result = id.replace(/-/g, '').slice(0, 8);
  return result === '' ? EMPTY_CELL : result;
}

export function isSafePrUrl(url: string): boolean {
  return url.startsWith('https://');
}

export function prLinkLabel(url: string): string {
  const match = url.match(/\/pull\/(\d+)(?:$|[/?#])/);
  if (match) {
    return `#${match[1]}`;
  }
  return 'PR';
}

export function redactConnectionUrls(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://***')
    .replace(/\/\/[^/\s@]+:[^/\s@]*@/g, '//***:***@');
}

export interface ClampedText {
  readonly text: string;
  readonly clamped: boolean;
  readonly originalLength: number;
}

export function clampForDisplay(text: string, maxChars: number): ClampedText {
  if (maxChars < 1) {
    return {
      text: '',
      clamped: text.length > 0,
      originalLength: text.length,
    };
  }
  if (text.length <= maxChars) {
    return {
      text,
      clamped: false,
      originalLength: text.length,
    };
  }
  return {
    text: text.slice(0, maxChars),
    clamped: true,
    originalLength: text.length,
  };
}

export function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    get_dom_snapshot: 'DOM snapshot',
    query_selector: 'Query selector',
    run_single_test: 'Run single test',
  };
  return labels[tool] ?? tool;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms) || ms < 0) {
    return EMPTY_CELL;
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return '[unserialisable]';
  }
}

export function matchCountLabel(matchCount: number | null): string {
  if (matchCount === null) {
    return 'not measured';
  }
  if (matchCount === 0) {
    return '0 matches';
  }
  if (matchCount === 1) {
    return '1 match';
  }
  return `${matchCount} matches`;
}

export function booleanLabel(value: boolean | null): string {
  if (value === null) {
    return EMPTY_CELL;
  }
  return value ? 'yes' : 'no';
}

export function noPrExplanation(status: HealStatus): string {
  const explanations: Record<HealStatus, string> = {
    healed: 'No pull-request URL is recorded for this attempt.',
    needs_review: 'No pull request: low confidence routes to human review.',
    failed: 'No pull request: no verified fix was found.',
    investigating: 'No pull request: this attempt never settled.',
  };
  return explanations[status];
}

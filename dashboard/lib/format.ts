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

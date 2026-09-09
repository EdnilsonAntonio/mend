import { confidenceBadgeClass, confidenceLabel, statusBadgeClass, statusLabel } from '../../lib/format';
import type { HealConfidence, HealStatus } from '../../lib/types';

export function StatusBadge({ status }: { readonly status: HealStatus }) {
  return (
    <span className={statusBadgeClass(status)} data-testid="attempt-status" data-status={status}>
      {statusLabel(status)}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { readonly confidence: HealConfidence }) {
  return (
    <span
      className={confidenceBadgeClass(confidence)}
      data-testid="attempt-confidence"
      data-confidence={confidence}
    >
      {confidenceLabel(confidence)}
    </span>
  );
}

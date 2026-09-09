import { EMPTY_CELL, formatTimestamp, isSafePrUrl, prLinkLabel, shortId, truncate } from '../../lib/format';
import type { AttemptsLoad } from '../../lib/attempts';
import { summariseAttempts } from '../../lib/attempts';
import { StatusBadge } from './badge';
import { ConfidenceBadge } from './badge';

export function AttemptsView({ load }: { readonly load: AttemptsLoad }) {
  if (load.ok === false) {
    const codeMessage =
      load.code === 'no-database-url'
        ? 'Set DATABASE_URL to the PostgreSQL instance the runner writes to, then reload. See db/README.md.'
        : 'The database is unreachable or has not been migrated. Run npm run db:migrate, then reload.';

    return (
      <section className="panel panel-error" data-testid="attempts-error" data-code={load.code}>
        <h2>Cannot read heal attempts</h2>
        <p>{codeMessage}</p>
        <pre className="mono">{load.message}</pre>
      </section>
    );
  }

  const summary = summariseAttempts(load.rows);

  if (load.rows.length === 0) {
    return (
      <>
        <p className="summary" data-testid="attempts-summary">
          Showing {summary.total} attempts — healed {summary.byStatus.healed} · needs review{' '}
          {summary.byStatus.needs_review} · failed {summary.byStatus.failed} · investigating{' '}
          {summary.byStatus.investigating} · with PR {summary.withPr}
        </p>
        <section className="empty" data-testid="attempts-empty">
          <p>No heal attempts recorded yet.</p>
          <p>
            Run <code className="mono">npm run heal</code> to produce some.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <p className="summary" data-testid="attempts-summary">
        Showing {summary.total} attempts — healed {summary.byStatus.healed} · needs review{' '}
        {summary.byStatus.needs_review} · failed {summary.byStatus.failed} · investigating{' '}
        {summary.byStatus.investigating} · with PR {summary.withPr}
      </p>
      {load.truncated && (
        <p className="truncated-note" data-testid="attempts-truncated">
          Showing the {load.limit} most recent attempts.
        </p>
      )}
      <table className="table" data-testid="attempts-table">
        <thead>
          <tr>
            <th>Attempt</th>
            <th>Created (UTC)</th>
            <th>Spec file</th>
            <th>Test</th>
            <th>Status</th>
            <th>Confidence</th>
            <th>Selector change</th>
            <th>Tool calls</th>
            <th>PR</th>
          </tr>
        </thead>
        <tbody>
          {load.rows.flatMap((row) => {
            const mainRow = (
              <tr key={row.id} data-testid="attempt-row" data-attempt-id={row.id}>
                <td>
                  <code className="mono">{shortId(row.id)}</code>
                </td>
                <td>{formatTimestamp(row.createdAt)}</td>
                <td>
                  <code className="mono">{row.specFile}</code>
                </td>
                <td>{truncate(row.testName, 80)}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>
                  <ConfidenceBadge confidence={row.confidence} />
                </td>
                <td>
                  <code className="mono">{truncate(row.originalSelector, 48)}</code>
                  {' → '}
                  {row.proposedSelector === null ? (
                    <span>{EMPTY_CELL}</span>
                  ) : (
                    <code className="mono">{truncate(row.proposedSelector, 48)}</code>
                  )}
                </td>
                <td>{row.toolCallCount}</td>
                <td>
                  {row.prUrl === null ? (
                    EMPTY_CELL
                  ) : !isSafePrUrl(row.prUrl) ? (
                    <span className="mono">{truncate(row.prUrl, 60)}</span>
                  ) : (
                    <a href={row.prUrl} target="_blank" rel="noreferrer noopener" data-testid="attempt-pr-link">
                      {prLinkLabel(row.prUrl)}
                    </a>
                  )}
                </td>
              </tr>
            );

            const failureRow =
              row.failureReason !== null ? (
                <tr key={`${row.id}-failure`} data-testid="attempt-failure-reason">
                  <td colSpan={9} className="mono">
                    {truncate(row.failureReason, 300)}
                  </td>
                </tr>
              ) : null;

            return failureRow ? [mainRow, failureRow] : [mainRow];
          })}
        </tbody>
      </table>
    </>
  );
}

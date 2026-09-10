import Link from 'next/link';
import {
  EMPTY_CELL,
  formatTimestamp,
  isSafePrUrl,
  prLinkLabel,
  truncate,
  formatDuration,
  matchCountLabel,
  booleanLabel,
  noPrExplanation,
} from '../../lib/format';
import { StatusBadge, ConfidenceBadge } from './badge';
import { ClampedBlock, ChangedLines, TranscriptSteps } from './transcript-steps';
import {
  TOOL_CALL_CAP,
  MAX_SNAPSHOT_RENDER_CHARS,
  MAX_OUTPUT_RENDER_CHARS,
  MAX_SPEC_SOURCE_RENDER_CHARS,
  MAX_UNKNOWN_RENDER_CHARS,
} from '../../lib/transcript';
import type { AttemptDetailLoad } from '../../lib/attempt-detail';

const codeMessages: Record<string, string> = {
  'no-database-url': 'Set DATABASE_URL to the PostgreSQL instance the runner writes to, then reload. See db/README.md.',
  'invalid-id': 'That is not a valid heal attempt id. Attempt ids are UUIDs, as shown on the list view.',
  'not-found': 'No heal attempt with that id is recorded. It may belong to a different database.',
  'query-failed': 'The database is unreachable or has not been migrated. Run npm run db:migrate, then reload.',
};

export function AttemptDetailView({ load }: { readonly load: AttemptDetailLoad }) {
  return (
    <>
      <p className="detail-back">
        <Link href="/" data-testid="attempt-detail-back">
          ← All heal attempts
        </Link>
      </p>

      {load.ok === false && (
        <section className="panel panel-error" data-testid="attempt-detail-error" data-code={load.code}>
          <h2>Cannot show this heal attempt</h2>
          <p>{codeMessages[load.code]}</p>
          <p className="mono">{truncate(load.attemptId, 64)}</p>
          <pre className="mono">{load.message}</pre>
        </section>
      )}

      {load.ok === true && (
        <article
          className="detail"
          data-testid="attempt-detail"
          data-attempt-id={load.row.id}
          data-status={load.row.status}
          data-confidence={load.row.confidence}
        >
          <h2 className="detail-heading">{truncate(load.row.testName, 120)}</h2>
          <p className="mono">{load.row.specFile}</p>

          {/* Section 1: Outcome */}
          <section className="detail-section" data-testid="detail-outcome">
            <h2>Outcome</h2>
            <dl className="kv">
              <dt>Attempt</dt>
              <dd>
                <code className="mono">{load.row.id}</code>
              </dd>
              <dt>Test run</dt>
              <dd>
                <code className="mono">{load.row.testRunId}</code>
              </dd>
              <dt>Created (UTC)</dt>
              <dd>{formatTimestamp(load.row.createdAt)}</dd>
              <dt>Spec file</dt>
              <dd>
                <code className="mono">{load.row.specFile}</code>
              </dd>
              <dt>Test</dt>
              <dd>{load.row.testName}</dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={load.row.status} />
              </dd>
              <dt>Confidence</dt>
              <dd>
                <ConfidenceBadge confidence={load.row.confidence} />
              </dd>
              <dt>Original selector</dt>
              <dd>
                <code className="mono">{load.row.originalSelector}</code>
              </dd>
              <dt>Proposed selector</dt>
              <dd>
                {load.row.proposedSelector === null ? (
                  EMPTY_CELL
                ) : (
                  <code className="mono">{load.row.proposedSelector}</code>
                )}
              </dd>
              <dt>Tool calls</dt>
              <dd>
                {load.row.toolCallCount} of {TOOL_CALL_CAP}
              </dd>
              <dt>Failure reason</dt>
              <dd>{load.row.failureReason ?? EMPTY_CELL}</dd>
              <dt>Pull request</dt>
              <dd>
                {load.row.prUrl === null ? (
                  noPrExplanation(load.row.status)
                ) : !isSafePrUrl(load.row.prUrl) ? (
                  <span className="mono">{truncate(load.row.prUrl, 120)}</span>
                ) : (
                  <a href={load.row.prUrl} target="_blank" rel="noreferrer noopener" data-testid="attempt-pr-link">
                    {prLinkLabel(load.row.prUrl)}
                  </a>
                )}
              </dd>
            </dl>

            {load.transcript.kind === 'envelope' &&
              load.transcript.recordedConfidence !== null &&
              load.transcript.recordedConfidence !== load.row.confidence && (
                <p className="note note-warning" data-testid="detail-confidence-mismatch">
                  The transcript records the confidence gate&apos;s verdict as{' '}
                  <strong>{load.transcript.recordedConfidence}</strong>, but this attempt is stored as{' '}
                  <strong>{load.row.confidence}</strong>. The stored columns are authoritative; see the failure reason
                  above. This happens when pull-request delivery failed after a high-confidence heal — the fix is kept
                  and routed to human review.
                </p>
              )}
          </section>

          {/* Section 2: Verification */}
          <section className="detail-section" data-testid="detail-verification">
            <h2>Verification</h2>
            <p className="note">
              A fix is only ever recorded as healed after run_single_test re-executed the test and it passed. Model
              confidence alone is never sufficient.
            </p>

            {load.transcript.kind !== 'envelope' || load.transcript.verification === null ? (
              <p data-testid="detail-verification-none">
                run_single_test never returned a result for this attempt, so no fix could be accepted.
              </p>
            ) : (
              <>
                <dl className="kv">
                  <dt>Candidate selector</dt>
                  <dd>
                    <code>{load.transcript.verification.candidateSelector}</code>
                  </dd>
                  <dt>Executed</dt>
                  <dd>{booleanLabel(load.transcript.verification.executed)}</dd>
                  <dt>Passed</dt>
                  <dd>
                    <span className={load.transcript.verification.passed ? 'pass' : 'fail'}>
                      {booleanLabel(load.transcript.verification.passed)}
                    </span>
                  </dd>
                  <dt>Rejected</dt>
                  <dd>{load.transcript.verification.rejected ?? EMPTY_CELL}</dd>
                  <dt>Duration</dt>
                  <dd>{formatDuration(load.transcript.verification.durationMs)}</dd>
                </dl>
                <ChangedLines
                  changedLines={load.transcript.verification.changedLines}
                  testId="detail-changed-lines"
                />
                <ClampedBlock
                  text={load.transcript.verification.output}
                  maxChars={MAX_OUTPUT_RENDER_CHARS}
                  testId="detail-verification-output"
                  emptyMessage="No test output was captured."
                />
              </>
            )}
          </section>

          {/* Section 3: Confidence gate */}
          <section className="detail-section" data-testid="detail-confidence">
            <h2>Confidence gate</h2>
            <p className="note">
              Confidence is derived from observable signals — the measured DOM match count and the number of tool calls
              — never from asking the model how sure it is.
            </p>

            {load.transcript.kind !== 'envelope' ? (
              <p data-testid="detail-confidence-none">No confidence signals were recorded for this attempt.</p>
            ) : (
              <>
                {load.transcript.signals === null ? (
                  <p data-testid="detail-confidence-none">No confidence signals were recorded for this attempt.</p>
                ) : (
                  <dl className="kv" data-testid="detail-signals">
                    <dt>Verified by execution</dt>
                    <dd>{booleanLabel(load.transcript.signals.verified)}</dd>
                    <dt>Proposed selector</dt>
                    <dd>{load.transcript.signals.proposedSelector ?? EMPTY_CELL}</dd>
                    <dt>Tool calls</dt>
                    <dd>{load.transcript.signals.toolCallCount ?? EMPTY_CELL}</dd>
                    <dt>Measured matches</dt>
                    <dd>{matchCountLabel(load.transcript.signals.matchCount)}</dd>
                    <dt>Match measured</dt>
                    <dd>{booleanLabel(load.transcript.signals.matchMeasured)}</dd>
                    <dt>Tool-call cap reached</dt>
                    <dd>{booleanLabel(load.transcript.signals.capReached)}</dd>
                    <dt>Outcome</dt>
                    <dd>{load.transcript.signals.outcome ?? EMPTY_CELL}</dd>
                    <dt>Stop reason</dt>
                    <dd>{load.transcript.signals.stopReason ?? EMPTY_CELL}</dd>
                  </dl>
                )}

                {load.transcript.measurement === null ? (
                  <p data-testid="detail-measurement-none">
                    The verified selector was not measured — there was no verified fix to measure.
                  </p>
                ) : (
                  <dl className="kv" data-testid="detail-measurement">
                    <dt>Selector</dt>
                    <dd>{load.transcript.measurement.selector}</dd>
                    <dt>Matches</dt>
                    <dd>{matchCountLabel(load.transcript.measurement.matchCount)}</dd>
                    <dt>Measured</dt>
                    <dd>{booleanLabel(load.transcript.measurement.measured)}</dd>
                    <dt>Error</dt>
                    <dd>{load.transcript.measurement.error ?? EMPTY_CELL}</dd>
                    <dt>Measured at</dt>
                    <dd>{load.transcript.measurement.measuredAt ?? EMPTY_CELL}</dd>
                    <dt>Duration</dt>
                    <dd>{formatDuration(load.transcript.measurement.durationMs)}</dd>
                  </dl>
                )}

                {load.transcript.reasons.length === 0 ? (
                  <p data-testid="detail-confidence-reasons-none">
                    No downgrade reasons: this attempt met every condition for high confidence.
                  </p>
                ) : (
                  <ul className="reasons" data-testid="detail-confidence-reasons">
                    {load.transcript.reasons.map((reason, idx) => (
                      <li key={idx} className="reason">
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* Section 4: Bootstrap */}
          <section className="detail-section" data-testid="detail-bootstrap">
            <h2>What the agent saw first</h2>

            {load.transcript.kind !== 'envelope' || load.transcript.bootstrapSnapshot === null ? (
              <p data-testid="detail-dom-snapshot-none">
                No DOM snapshot was captured before the first model request.
              </p>
            ) : (
              <>
                <dl className="kv" data-testid="detail-dom-snapshot">
                  <dt>URL</dt>
                  <dd>{load.transcript.bootstrapSnapshot.url ?? EMPTY_CELL}</dd>
                  <dt>Captured at</dt>
                  <dd>{load.transcript.bootstrapSnapshot.capturedAt ?? EMPTY_CELL}</dd>
                  <dt>Estimated tokens</dt>
                  <dd>{load.transcript.bootstrapSnapshot.estimatedTokens ?? EMPTY_CELL}</dd>
                  <dt>Elements</dt>
                  <dd>{load.transcript.bootstrapSnapshot.elementCount ?? EMPTY_CELL}</dd>
                  <dt>Pruned/truncated</dt>
                  <dd>{booleanLabel(load.transcript.bootstrapSnapshot.truncated)}</dd>
                </dl>
                <ClampedBlock
                  text={load.transcript.bootstrapSnapshot.html}
                  maxChars={MAX_SNAPSHOT_RENDER_CHARS}
                  testId="detail-dom-snapshot-html"
                  emptyMessage="No HTML was captured."
                />
              </>
            )}

            {load.transcript.kind !== 'envelope' || load.transcript.bootstrapSpecSource === null ? (
              <p data-testid="detail-spec-source-none">No spec source was supplied to the model.</p>
            ) : (
              <ClampedBlock
                text={load.transcript.bootstrapSpecSource}
                maxChars={MAX_SPEC_SOURCE_RENDER_CHARS}
                testId="detail-spec-source"
                emptyMessage="The spec source was empty."
              />
            )}
          </section>

          {/* Section 5: Transcript replay */}
          <section className="detail-section" data-testid="detail-transcript">
            <h2>Transcript replay</h2>

            {load.transcript.kind === 'absent' && (
              <p data-testid="detail-no-transcript">
                No transcript was recorded. An attempt is stored before the agent runs, so an attempt that never
                settled has an empty transcript by design.
              </p>
            )}

            {load.transcript.kind === 'unrecognised' && (
              <>
                <p data-testid="detail-unrecognised-transcript">
                  The stored transcript does not match the expected envelope shape. The raw value is shown below.
                </p>
                <ClampedBlock
                  text={load.transcript.json}
                  maxChars={MAX_UNKNOWN_RENDER_CHARS}
                  testId="detail-raw-transcript"
                  emptyMessage="The stored value was empty."
                />
              </>
            )}

            {load.transcript.kind === 'envelope' && (
              <>
                <p className="summary" data-testid="detail-transcript-summary">
                  {load.transcript.steps.length} tool calls (hard cap {TOOL_CALL_CAP}) ·{' '}
                  {load.transcript.modelTurns.length} model turns · {load.transcript.messageCount} messages
                </p>

                {load.transcript.steps.length === 0 ? (
                  <p data-testid="detail-no-steps">The agent made no tool calls.</p>
                ) : (
                  <TranscriptSteps steps={load.transcript.steps} />
                )}
              </>
            )}
          </section>

          {/* Section 6: Model turns */}
          <section className="detail-section" data-testid="detail-model-turns">
            <h2>Model turns</h2>

            {load.transcript.kind !== 'envelope' || load.transcript.modelTurns.length === 0 ? (
              <p data-testid="detail-no-model-turns">No model turns were recorded.</p>
            ) : (
              <table className="table" data-testid="detail-model-turns-table">
                <thead>
                  <tr>
                    <th>Turn</th>
                    <th>Finish reason</th>
                    <th>Tools requested</th>
                    <th>Prompt tokens</th>
                    <th>Completion tokens</th>
                    <th>Total tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {load.transcript.modelTurns.flatMap((turn, idx) => {
                    const mainRow = (
                      <tr key={`turn-${idx}`} data-testid="model-turn">
                        <td>{turn.turn ?? EMPTY_CELL}</td>
                        <td>{turn.finishReason ?? EMPTY_CELL}</td>
                        <td>{turn.requestedTools.length > 0 ? turn.requestedTools.join(', ') : EMPTY_CELL}</td>
                        <td>{turn.promptTokens ?? EMPTY_CELL}</td>
                        <td>{turn.completionTokens ?? EMPTY_CELL}</td>
                        <td>{turn.totalTokens ?? EMPTY_CELL}</td>
                      </tr>
                    );

                    const contentRow =
                      turn.contentPreview !== '' ? (
                        <tr key={`turn-${idx}-content`} data-testid="model-turn-content">
                          <td colSpan={6} className="mono">
                            {truncate(turn.contentPreview, 500)}
                          </td>
                        </tr>
                      ) : null;

                    return contentRow ? [mainRow, contentRow] : [mainRow];
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* Section 7: Envelope metadata */}
          <section className="detail-section" data-testid="detail-envelope-meta">
            <h2>Record</h2>

            {load.transcript.kind !== 'envelope' ? (
              <p data-testid="detail-envelope-meta-none">No transcript envelope metadata is available.</p>
            ) : (
              <>
                <dl className="kv">
                  <dt>Transcript schema version</dt>
                  <dd>{load.transcript.schemaVersion ?? EMPTY_CELL}</dd>
                  <dt>Transcript reduced</dt>
                  <dd>{booleanLabel(load.transcript.truncated)}</dd>
                  <dt>Model</dt>
                  <dd>{load.transcript.model ?? EMPTY_CELL}</dd>
                  <dt>Run started at</dt>
                  <dd>{load.transcript.startedAt ? formatTimestamp(load.transcript.startedAt) : EMPTY_CELL}</dd>
                  <dt>Run duration</dt>
                  <dd>{formatDuration(load.transcript.durationMs)}</dd>
                  <dt>Outcome</dt>
                  <dd>{load.transcript.outcome ?? EMPTY_CELL}</dd>
                  <dt>Stop reason</dt>
                  <dd>{load.transcript.stopReason ?? EMPTY_CELL}</dd>
                  <dt>Agent error</dt>
                  <dd>{load.transcript.errorMessage ?? EMPTY_CELL}</dd>
                </dl>

                {load.transcript.truncated && (
                  <p className="note" data-testid="detail-transcript-reduced">
                    The stored transcript exceeded the 2 MB ceiling: the message list was cleared and long strings were
                    clamped before storage. Tool calls and results are still complete unless a value is marked as
                    clamped.
                  </p>
                )}
              </>
            )}
          </section>
        </article>
      )}
    </>
  );
}

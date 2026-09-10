import {
  EMPTY_CELL,
  clampForDisplay,
  formatDuration,
  matchCountLabel,
  booleanLabel,
  toolLabel,
} from '../../lib/format';
import {
  MAX_SNAPSHOT_RENDER_CHARS,
  MAX_OUTPUT_RENDER_CHARS,
  MAX_ARGUMENTS_RENDER_CHARS,
  MAX_UNKNOWN_RENDER_CHARS,
  MAX_CHANGED_LINES_RENDERED,
  MAX_PREVIEWS_RENDERED,
} from '../../lib/transcript';
import type { TranscriptStep, SpecLineChangeView } from '../../lib/transcript';

export function ChangedLines({
  changedLines,
  testId,
}: {
  readonly changedLines: readonly SpecLineChangeView[];
  readonly testId: string;
}) {
  if (changedLines.length === 0) {
    return <p className="note">No line change was recorded.</p>;
  }

  const shown = changedLines.slice(0, MAX_CHANGED_LINES_RENDERED);
  const wasCut = changedLines.length > MAX_CHANGED_LINES_RENDERED;

  return (
    <>
      <table className="diff-table" data-testid={testId}>
        <thead>
          <tr>
            <th>Line</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((line, idx) => (
            <tr key={idx}>
              <td>{line.lineNumber ?? EMPTY_CELL}</td>
              <td>
                <code className="mono diff-before">{line.before}</code>
              </td>
              <td>
                <code className="mono diff-after">{line.after}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {wasCut && (
        <p className="clamp-note">
          Showing {MAX_CHANGED_LINES_RENDERED} of {changedLines.length} changed lines.
        </p>
      )}
    </>
  );
}

export function ClampedBlock({
  text,
  maxChars,
  testId,
  emptyMessage,
}: {
  readonly text: string;
  readonly maxChars: number;
  readonly testId: string;
  readonly emptyMessage: string;
}) {
  if (text === '') {
    return <p className="note">{emptyMessage}</p>;
  }

  const c = clampForDisplay(text, maxChars);
  return (
    <>
      <pre className="mono block" data-testid={testId}>
        {c.text}
      </pre>
      {c.clamped && (
        <p className="clamp-note">
          Showing the first {maxChars} of {c.originalLength} characters.
        </p>
      )}
    </>
  );
}

export function TranscriptSteps({ steps }: { readonly steps: readonly TranscriptStep[] }) {
  return (
    <>
      {steps.map((step) => (
        <section
          className="step"
          key={`${step.index}-${step.toolCallId ?? 'x'}`}
          data-testid="transcript-step"
          data-step-index={step.index}
          data-tool={step.tool}
          data-ok={String(step.ok)}
        >
          <h3 className="step-header">
            <span className="step-index">{step.index}</span> {toolLabel(step.tool)}{' '}
            <span className={step.ok ? 'pass' : 'fail'}>{step.ok ? 'ok' : 'not ok'}</span>{' '}
            <span className="step-duration">{formatDuration(step.durationMs)}</span>
          </h3>
          <dl className="kv">
            <dt>Arguments</dt>
            <dd>
              <code className="mono">
                {clampForDisplay(step.rawArguments, MAX_ARGUMENTS_RENDER_CHARS).text || EMPTY_CELL}
              </code>
            </dd>
          </dl>

          {step.detail.kind === 'dom-snapshot' && (
            <div className="step-body" data-testid="step-dom-snapshot">
              <dl className="kv">
                <dt>URL</dt>
                <dd>{step.detail.snapshot.url ?? EMPTY_CELL}</dd>
                <dt>Estimated tokens</dt>
                <dd>{step.detail.snapshot.estimatedTokens ?? EMPTY_CELL}</dd>
                <dt>Elements</dt>
                <dd>{step.detail.snapshot.elementCount ?? EMPTY_CELL}</dd>
                <dt>Pruned/truncated</dt>
                <dd>{booleanLabel(step.detail.snapshot.truncated)}</dd>
              </dl>
              <ClampedBlock
                text={step.detail.snapshot.html}
                maxChars={MAX_SNAPSHOT_RENDER_CHARS}
                testId="step-dom-snapshot-html"
                emptyMessage="No HTML was captured."
              />
            </div>
          )}

          {step.detail.kind === 'query-selector' && (
            <div className="step-body" data-testid="step-query-selector">
              <dl className="kv">
                <dt>Selector</dt>
                <dd>
                  <code className="mono">{step.detail.selector}</code>
                </dd>
                <dt>Matches</dt>
                <dd>{matchCountLabel(step.detail.matchCount)}</dd>
                <dt>Previews truncated</dt>
                <dd>{booleanLabel(step.detail.previewsTruncated)}</dd>
                <dt>Error</dt>
                <dd>
                  {step.detail.error === null
                    ? EMPTY_CELL
                    : `${step.detail.error.kind}: ${step.detail.error.message}`}
                </dd>
              </dl>

              {step.detail.previews.length === 0 ? (
                <p className="note">No matching elements to preview.</p>
              ) : (
                <>
                  <table className="preview-table" data-testid="step-previews">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Tag</th>
                        <th>Id</th>
                        <th>Classes</th>
                        <th>Role</th>
                        <th>Text</th>
                        <th>Visible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {step.detail.previews.slice(0, MAX_PREVIEWS_RENDERED).map((preview, idx) => (
                        <tr key={idx} data-testid="step-preview">
                          <td>{preview.index ?? EMPTY_CELL}</td>
                          <td>{preview.tagName ?? EMPTY_CELL}</td>
                          <td>{preview.id ?? EMPTY_CELL}</td>
                          <td>{preview.classList.length > 0 ? preview.classList.join(' ') : EMPTY_CELL}</td>
                          <td>{preview.role ?? EMPTY_CELL}</td>
                          <td>{preview.text || EMPTY_CELL}</td>
                          <td>{booleanLabel(preview.visible)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {step.detail.previews.length > MAX_PREVIEWS_RENDERED && (
                    <p className="clamp-note">
                      Showing {MAX_PREVIEWS_RENDERED} of {step.detail.previews.length} matching elements.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {step.detail.kind === 'run-single-test' && (
            <div className="step-body" data-testid="step-run-single-test">
              <dl className="kv">
                <dt>Candidate selector</dt>
                <dd>
                  <code>{step.detail.candidate}</code>
                </dd>
                <dt>Executed</dt>
                <dd>{booleanLabel(step.detail.executed)}</dd>
                <dt>Passed</dt>
                <dd>
                  <span className={step.detail.passed ? 'pass' : 'fail'}>{booleanLabel(step.detail.passed)}</span>
                </dd>
                <dt>Rejected</dt>
                <dd>{step.detail.rejected ?? EMPTY_CELL}</dd>
              </dl>

              {step.detail.violations.length === 0 ? (
                <p className="note">No assertion-integrity violation was found.</p>
              ) : (
                <ul data-testid="step-violations">
                  {step.detail.violations.map((v, idx) => (
                    <li key={idx}>
                      <code className="mono">{v.rule}</code> — {v.detail}
                    </li>
                  ))}
                </ul>
              )}

              <ChangedLines changedLines={step.detail.changedLines} testId="step-changed-lines" />

              <ClampedBlock
                text={step.detail.output}
                maxChars={MAX_OUTPUT_RENDER_CHARS}
                testId="step-test-output"
                emptyMessage="No test output was captured."
              />
            </div>
          )}

          {step.detail.kind === 'error' && (
            <div className="step-body" data-testid="step-error">
              <p className="fail" data-testid="step-error-message">
                {step.detail.message}
              </p>
            </div>
          )}

          {step.detail.kind === 'unknown' && (
            <div className="step-body" data-testid="step-unknown">
              <ClampedBlock
                text={step.detail.json}
                maxChars={MAX_UNKNOWN_RENDER_CHARS}
                testId="step-unknown-json"
                emptyMessage="No result was recorded."
              />
            </div>
          )}
        </section>
      ))}
    </>
  );
}

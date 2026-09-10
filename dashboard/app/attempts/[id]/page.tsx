import { loadAttemptDetail } from '../../../lib/attempt-detail';
import { getRowReader } from '../../../lib/db';
import { AttemptDetailView } from '../../_components/attempt-detail';

/** Read-through on every request: this is a live report, never a build-time snapshot. */
export const dynamic = 'force-dynamic';

export default async function AttemptDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const load = await loadAttemptDetail(getRowReader(), id);
  return (
    <main>
      <AttemptDetailView load={load} />
    </main>
  );
}

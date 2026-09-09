import { loadAttempts } from '../lib/attempts';
import { getRowReader } from '../lib/db';
import { AttemptsView } from './_components/attempts-table';

/** Read-through on every request: this is a live report, never a build-time snapshot. */
export const dynamic = 'force-dynamic';

export default async function AttemptsPage() {
  const load = await loadAttempts(getRowReader());
  return <main><AttemptsView load={load} /></main>;
}

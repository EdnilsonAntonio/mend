import { captureDomSnapshotFromUrl } from '../get-dom-snapshot.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const url =
    args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3100/';

  try {
    const snapshot = await captureDomSnapshotFromUrl(url);

    if (json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      // Print metadata to stderr, HTML to stdout.
      const depthStr = snapshot.depthLimit ?? 'none';
      console.error(
        `url=${snapshot.url} tokens=${snapshot.estimatedTokens} elements=${snapshot.elementCount} truncated=${snapshot.truncated} depthLimit=${depthStr}`,
      );
      console.log(snapshot.html);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`get_dom_snapshot failed: ${message}`);
    process.exit(1);
  }
}

main();

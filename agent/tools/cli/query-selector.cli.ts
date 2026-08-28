import { querySelectorFromUrl } from '../query-selector.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const urlArg = args.find((a) => a.startsWith('--url='));
  const url =
    urlArg === undefined
      ? 'http://localhost:3100/'
      : urlArg.slice('--url='.length);
  const positionals = args.filter((a) => !a.startsWith('--'));

  // Argument validation.
  if (positionals.length !== 1) {
    const usageLine1 =
      'Usage: npx tsx agent/tools/cli/query-selector.cli.ts <selector> [--url=<url>] [--json]';
    const usageLine2 =
      '   or: npm run --silent tool:query-selector -- <selector> [--url=<url>] [--json]';
    console.error(usageLine1);
    console.error(usageLine2);
    process.exit(2);
  }

  const selector = positionals[0];
  if (selector === undefined) {
    const usageLine1 =
      'Usage: npx tsx agent/tools/cli/query-selector.cli.ts <selector> [--url=<url>] [--json]';
    const usageLine2 =
      '   or: npm run --silent tool:query-selector -- <selector> [--url=<url>] [--json]';
    console.error(usageLine1);
    console.error(usageLine2);
    process.exit(2);
  }

  try {
    const result = await querySelectorFromUrl(selector, url);

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Print header line.
      const errorStr = result.error === null ? 'none' : result.error.kind;
      console.log(
        `selector=${result.selector} matches=${result.matchCount} shown=${result.previews.length} truncated=${result.previewsTruncated} error=${errorStr}`,
      );

      // Print preview lines.
      for (const preview of result.previews) {
        const idStr = preview.id ?? '-';
        const classStr = preview.classList.join(' ') || '-';
        const roleStr = preview.role ?? '-';
        console.log(
          `[${preview.index}] ${preview.tagName} id=${idStr} class=${classStr} role=${roleStr} visible=${preview.visible} text=${JSON.stringify(preview.text)}`,
        );
      }

      // Print error to stderr if present.
      if (result.error !== null) {
        console.error(`query_selector error: ${result.error.message}`);
      }
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`query_selector failed: ${message}`);
    process.exit(1);
  }
}

main();

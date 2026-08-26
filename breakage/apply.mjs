// breakage/apply.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const TARGET = path.join(REPO_ROOT, 'app-under-test', 'index.html');
const PRISTINE = path.join(HERE, 'index.pristine.html');
const BROKEN = path.join(HERE, 'index.broken.html');

const USAGE = 'Usage: node breakage/apply.mjs <on|off|status>';

/** @returns {Promise<'pristine' | 'broken' | 'unknown'>} */
async function readState() {
  let target;
  let pristine;
  let broken;

  // Try to read TARGET; if it doesn't exist, treat as 'unknown'
  try {
    target = await fs.readFile(TARGET);
  } catch (err) {
    if (err.code === 'ENOENT') {
      target = null;
    } else {
      throw err;
    }
  }

  // Try to read PRISTINE and BROKEN; if either is missing, exit with error
  try {
    pristine = await fs.readFile(PRISTINE);
  } catch (err) {
    console.error('Missing breakage variant file. Expected breakage/index.pristine.html and breakage/index.broken.html.');
    process.exit(1);
  }

  try {
    broken = await fs.readFile(BROKEN);
  } catch (err) {
    console.error('Missing breakage variant file. Expected breakage/index.pristine.html and breakage/index.broken.html.');
    process.exit(1);
  }

  // Compare TARGET against pristine and broken
  if (target === null) {
    return 'unknown';
  }

  if (target.equals(pristine)) {
    return 'pristine';
  }

  if (target.equals(broken)) {
    return 'broken';
  }

  return 'unknown';
}

/** @returns {Promise<void>} */
async function main() {
  const command = process.argv[2];

  if (command === 'status') {
    const state = await readState();
    console.log(state);
    return;
  }

  if (command === 'on') {
    const state = await readState();
    if (state === 'broken') {
      console.log('breakage already on');
      return;
    }
    if (state === 'unknown') {
      console.error('app-under-test/index.html matches neither variant; refusing to overwrite. Run "npm run break:off" to restore the pristine app.');
      process.exit(1);
    }
    // state === 'pristine', so copy BROKEN to TARGET
    await fs.copyFile(BROKEN, TARGET);
    console.log('breakage on');
    return;
  }

  if (command === 'off') {
    const pristineBuffer = await fs.readFile(PRISTINE);
    await fs.copyFile(PRISTINE, TARGET);
    console.log('breakage off');
    return;
  }

  // Invalid command or missing command
  console.error(USAGE);
  process.exit(2);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

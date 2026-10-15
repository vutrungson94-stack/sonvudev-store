import { promises as fs } from 'node:fs';

/**
 * Closes a test server and removes the directory it was pointed at.
 *
 * This line was written out, identically, in twenty-one test files, and it raced.
 * The store writes through a promise chain so two updates cannot interleave; the
 * chain is module state and outlives the test that started it. Removing the data
 * directory while a write is still queued removes files out from under it: the
 * temporary file appears after the directory walk has passed its name, and on
 * Windows fs.rm fails with ENOTEMPTY. Every other platform deletes it silently and
 * leaves a test failing in a way that looks like the code under test.
 *
 * The drain comes first, and the retry is the second line of defence for a write
 * that starts between the drain and the walk.
 *
 * @param {import('node:http').Server|undefined|null} server
 * @param {string} dir
 */
export const closeTest = async (server, dir) => {
  server?.close();
  // Imported here, not at the top of this file, and that is the whole point of
  // writing it this way. src/store.js decides where the data directory is the
  // moment it is imported — it reads DATA_DIR once, at module scope. A static
  // import here would therefore be hoisted above every test file's own
  // `process.env.DATA_DIR = tempDir`, the store would resolve to the repository's
  // real data/ directory, and the suite would seed, overwrite and litter it with
  // test orders. Every test that sets DATA_DIR after its imports depends on this
  // module staying import-free.
  const { flushWrites } = await import('../../src/store.js');
  await flushWrites();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
};
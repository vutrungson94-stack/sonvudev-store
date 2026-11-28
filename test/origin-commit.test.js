import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';
import { parseCommit } from '../scripts/origin-commit.mjs';

test('parseCommit reads the sha from a health body', () => {
  const sha = process.env.APP_URL && '6f2db69fde850e2fcee98969eaddceb9c70da9b5';
  assert.equal(parseCommit(JSON.stringify({ ok: true, commit: sha })), sha);
  assert.equal(parseCommit('{"ok":true,"commit":""}'), '', 'missing sha is not stale evidence');
  assert.equal(parseCommit('not json'), '', 'unparseable body must not trigger a deploy');
  assert.equal(parseCommit({ ok: true, commit: 'deadbeef' }), 'deadbeef');
});

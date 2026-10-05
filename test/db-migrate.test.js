import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';

// The splitter that turns supabase/schema.sql into requests PostgREST will accept.
//
// PostgREST's query endpoint takes one statement per call, so a mistake here is not
// a syntax error in a file nobody reads — it is a migration that applies twenty
// statements and then fails, with no transaction to roll them back. And the split
// used to depend on counting apostrophes across the whole file, including inside
// comments, so one possessive in a sentence of prose could swallow every semicolon
// after it.
//
// statements() is not exported, so it is reached by reading the module source and
// evaluating just that function — which is honest here, because the property under
// test is what the parser does with a string, not how it is wired up.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'db-migrate.mjs'), 'utf8');
const body = source.slice(source.indexOf('function statements('), source.indexOf('/** Columns the running code writes'));
const statements = new Function(`${body}\nreturn statements;`)();

const schema = () => fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');

test('một câu có dấu nháy lệ trong comment không được nuốt phần còn lại của file', () => {
  // The exact shape that was in the file: a comment containing "the provider's
  // currency" — one apostrophe, odd, and the splitter believed a string literal had
  // opened. Everything after it stopped being a statement boundary.
  const sql = [
    "create table t (a text);",
    "-- What actually reached the account, in the provider's currency.",
    "create table u (b text);",
  ].join('\n');
  assert.equal(statements(sql).length, 2, 'hai câu, không phải một');
});

test('dấu nháy kép bên trong chuỗi không được tính là đóng chuỗi', () => {
  // '' is one literal quote, not a close followed by an open. Splitting on the first
  // of the pair cuts a statement in half and the remainder fails as a fragment.
  const sql = "insert into t (a) values ('O''Brien');\ncreate table u (b text);";
  const out = statements(sql);
  assert.equal(out.length, 2);
  assert.match(out[0], /'O''Brien'/);
});

test('thân hàm $$ … $$ là một câu, dù bên trong có dấu chấm phẩy', () => {
  // A function body is one statement whatever it contains. A naive semicolon split
  // sends the second half on its own and Postgres rejects it with a syntax error
  // pointing at the wrong line.
  const sql = [
    'create function f() returns void as $$',
    'begin',
    "  raise notice 'don''t split me; not even here';",
    '  perform 1;',
    'end;',
    '$$;',
    'create table u (b text);',
  ].join('\n');
  const out = statements(sql);
  assert.equal(out.length, 2, 'thân hàm phải giữ nguyên');
  assert.match(out[0], /\$\$/);
});

test('mọi câu trong schema.sql tách ra đều là một câu Postgres duy nhất', () => {
  // The property that matters on the real file: no output statement contains another
  // statement. A merge shows up as a DDL keyword after a terminating semicolon.
  const out = statements(schema());
  // Comments and dollar-quoted bodies are removed first, for two reasons. Prose in
  // this file legitimately names `create table` while explaining a mistake, and a
  // keyword in a sentence is not a second statement. And the plpgsql body of the
  // constraint block contains two `alter table` lines on purpose — one statement, two
  // commands, which is the entire point of the do block.
  const merged = out.filter((statement) => {
    const code = statement
      .replace(/\$\$[\s\S]*?\$\$/g, ' $$body$$ ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
      .trim();
    return /;\s*\n[\s\S]*\b(create|alter|insert)\s+(table|index|unique|constraint)\b/i.test(code);
  });
  assert.deepEqual(merged.map((s) => s.slice(0, 80)), [],
    'một câu đang chứa khai báo khác — nghĩa là hai câu bị gộp làm một');
});

test('không câu nào dài bất thường', () => {
  // A guard on the splitter rather than on this schema: when a split goes wrong the
  // symptom is always one statement carrying many times the work, and this is the
  // cheapest place to notice it before a migration tries to send it.
  const out = statements(schema());
  const longest = Math.max(...out.map((s) => s.length));
  assert.ok(longest < 2500, `câu dài nhất ${longest} ký tự — nhiều khả năng đã gộp nhầm`);
});

test('khối ràng buộc trong schema là idempotent, không phải drop rồi add mỗi lần chạy', () => {
  // Adding a check constraint re-validates every existing row. On an unchanged schema
  // that is the whole order table re-read to confirm a decision made last time — and
  // because these statements go one at a time with no transaction, a row that failed
  // validation would leave everything above applied and nothing recording where.
  const sql = schema();
  assert.match(sql, /pg_get_constraintdef/,
    'phải đọc định nghĩa constraint hiện tại trước khi thay thế');
  const bare = sql.match(/^\s*alter table public\.orders add constraint orders_status_check/m);
  assert.ok(bare, 'vẫn phải có câu add constraint');
  // At column 0, not merely present: inside the do block the drop is indented and
  // conditional, and it has to be. A drop that runs unconditionally re-validates the
  // whole table on every apply, which is the cost this replaced.
  assert.ok(!/^alter table public\.orders drop constraint if exists orders_status_check;$/m.test(sql),
    'không được drop constraint ở top level — nó phải nằm trong khối chỉ chạy khi định nghĩa khác');
  // And the conditional has to actually be conditional.
  assert.match(sql, /if current_definition is distinct from\s*\n?\s*'CHECK/,
    'phải so định nghĩa hiện tại với định nghĩa mong muốn trước khi thay thế');
  assert.match(sql, /^\s*\$\$;$/m, 'khối do phải đóng bằng $$;');
});

test('mọi index trong REQUIRED_INDEXES đều được schema.sql tạo ra', () => {
  // The check answers "does the live database have what the schema declares", so an
  // index missing from the list is an index whose absence nothing would report. One
  // was missing for exactly that reason — orders_idempotency_key_idx, which both the
  // expiry sweep and the repeated-checkout lookup read.
  const migrate = source;
  const required = migrate.slice(migrate.indexOf('const REQUIRED_INDEXES'), migrate.indexOf('// Read-only check first'));
  const sql = schema();
  const declared = new Set([...sql.matchAll(/create (?:unique )?index if not exists (\w+)/g)].map((m) => m[1]));
  const listed = [...required.matchAll(/"([a-z_]+_idx)"|"([a-z_]+_uniq)"/g)].map((m) => m[1] || m[2]);
  assert.ok(listed.length > 0, 'phải đọc được danh sách index');
  const missing = [...new Set(listed)].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `REQUIRED_INDEXES nhắc index schema.sql không tạo: ${missing.join(', ')}`);
  // And the other direction, for the index that matters most.
  assert.ok(declared.has('orders_idempotency_key_idx'), 'schema.sql phải tạo orders_idempotency_key_idx');
  assert.ok(listed.includes('orders_idempotency_key_idx'), 'db:check phải hỏi orders_idempotency_key_idx');
});

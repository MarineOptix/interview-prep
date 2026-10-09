// Access codes from the console.
//   npm run codes -- create --count 10 --rehearsals 3 --days 30 --note "first testers"
//   npm run codes -- list
// Works on the database in DATA_DIR (see .env.example).
import { parseArgs } from 'node:util';
import { getDb, dbFile, closeDb } from '../lib/db.js';
import { createCodes, listCodes, SOURCES } from '../lib/access.js';

const USAGE = `Usage:
  npm run codes -- create [--count 1] [--rehearsals 1] [--days 30] [--source promo] [--note "text"]
  npm run codes -- list

  --count        how many codes to issue (default 1)
  --rehearsals   rehearsals on each code (default 1)
  --days         days the codes stay valid; leave out for no end date
  --source       ${SOURCES.join(' | ')} (default promo)
  --note         a reminder for yourself, e.g. who the codes are for`;

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string', default: '1' },
      rehearsals: { type: 'string', default: '1' },
      days: { type: 'string' },
      source: { type: 'string', default: 'promo' },
      note: { type: 'string', default: '' },
    },
  });
} catch (err) {
  fail(err.message);
}

const [command] = parsed.positionals;
const { count, rehearsals, days, source, note } = parsed.values;
const whole = (text) => (/^\d+$/.test(text) ? Number(text) : NaN);

try {
  if (command === 'create') {
    const codes = createCodes(getDb(), { count: whole(count), rehearsals: whole(rehearsals), days: days === undefined ? null : whole(days), source, note });
    console.log(codes.join('\n'));
    console.error(`\n${codes.length} code(s), ${rehearsals} rehearsal(s) each, ${days === undefined ? 'no end date' : `valid ${days} day(s)`}. Database: ${dbFile()}`);
  } else if (command === 'list') {
    const rows = listCodes(getDb());
    for (const row of rows) {
      console.log([row.code, `${row.used}/${row.total} used`, row.expiresAt ? `until ${row.expiresAt.slice(0, 10)}` : 'no end date', row.source, row.note].filter(Boolean).join('  '));
    }
    console.error(`\n${rows.length} code(s). Database: ${dbFile()}`);
  } else {
    fail(command ? `Unknown command: ${command}` : 'Say what to do: create or list.');
  }
} catch (err) {
  fail(err.message);
} finally {
  closeDb();
}

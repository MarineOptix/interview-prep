// Stage 0 check from the command line: `npm run check:providers`.
// Reads keys from the environment (or .env) and prints one line per call.
import { runChecks } from '../lib/provider-check.js';

const report = await runChecks();
for (const r of report.results) {
  const mark = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
  const timing = r.skipped ? '' : ` (${r.ms} ms${r.status ? `, HTTP ${r.status}` : ''})`;
  console.log(`${mark}  ${r.title}${timing}\n      ${r.detail}`);
}
console.log(report.ok ? '\nGemini is reachable from this server: text, speech and audio input all work.' : '\nAt least one Gemini call did not pass. See the lines marked FAIL or SKIP above.');
process.exit(report.ok ? 0 : 1);

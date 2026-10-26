// ============================================================================
// TEST RUNNER
// ============================================================================
// Runs every suite in tests/suites and exits non-zero when something fails,
// so it can gate a commit or a CI job.
//
//   node tests/run.mjs
//
import { loadMeshPlug, AssertionError } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suiteDir = path.join(here, 'suites');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

const files = fs.readdirSync(suiteDir)
  .filter((f) => f.endsWith('.mjs'))
  .sort();

console.log(`${BOLD}Loading the mesh modules${OFF}`);
const M = await loadMeshPlug();
console.log(`${DIM}three.js r${M.THREE.REVISION} and ${Object.keys(M).length} globals ready${OFF}\n`);

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  // A file URL is needed for a dynamic import on Windows.
  const mod = await import(pathToFileURL(path.join(suiteDir, file)).href);
  const s = mod.default;
  if (!s || !s.tests) continue;
  console.log(`${BOLD}${s.name}${OFF}`);
  for (const t of s.tests) {
    try {
      await t.fn(M);
      passed++;
      console.log(`  ${GREEN}pass${OFF} ${t.name}`);
    } catch (e) {
      failed++;
      failures.push({ suite: s.name, test: t.name, error: e });
      console.log(`  ${RED}FAIL${OFF} ${t.name}`);
      if (e instanceof AssertionError) {
        console.log(`       ${DIM}${e.message}${OFF}`);
      } else {
        console.log(`       ${DIM}${e.message}${OFF}`);
      }
    }
  }
  console.log('');
}

if (failures.length) {
  console.log(`${BOLD}${RED}Failures${OFF}`);
  for (const f of failures) {
    console.log(`  ${f.suite} > ${f.test}`);
    console.log(`    ${f.error.stack ? f.error.stack.split('\n').slice(0, 4).join('\n    ') : f.error.message}`);
  }
  console.log('');
}

const total = passed + failed;
console.log(`${BOLD}${failed ? RED : GREEN}${passed}/${total} passed${OFF}`);
process.exit(failed ? 1 : 0);

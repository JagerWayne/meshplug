// ============================================================================
// TEST HARNESS
// ============================================================================
// Loads the MeshPlug mesh modules into a sandbox so they can be tested in
// plain Node, with no npm install and no browser.
//
// The modules are plain scripts that share one global scope, exactly as they
// do in the browser, so the sandbox mirrors the real thing closely.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// The modules under test. None of them contain JSX, so they can be evaluated
// as they are.
const MESH_MODULES = [
  'geometry.js',
  'analysis.js',
  'repair.js',
  'selection.js',
  'offset.js',
  'csg.js',
  'parsers.js'
];

let threeCache = null;

async function loadThree() {
  if (threeCache) return threeCache;
  // The same build the browser uses, so the tests measure the real thing.
  const url = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download three.js: ${res.status}`);
  threeCache = await res.text();
  return threeCache;
}

// Builds a sandbox with three.js and the mesh modules loaded into it.
export async function loadMeshPlug() {
  const three = await loadThree();
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextDecoder,
    TextEncoder,
    Blob,
    URL,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Map,
    Set,
    Promise
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(three, sandbox, { filename: 'three.min.js' });
  for (const file of MESH_MODULES) {
    const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    vm.runInContext(src, sandbox, { filename: file });
  }
  return sandbox;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(condition, message = 'expected a truthy value') {
  if (!condition) throw new AssertionError(message);
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new AssertionError(
      `${message ? message + ': ' : ''}expected ${format(expected)} but got ${format(actual)}`
    );
  }
}

export function assertClose(actual, expected, tolerance = 1e-6, message = '') {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new AssertionError(
      `${message ? message + ': ' : ''}expected ${expected} +/- ${tolerance} but got ${actual}`
    );
  }
}

export function assertDeepClose(actual, expected, tolerance = 1e-6, message = '') {
  if (Array.isArray(expected)) {
    assertEqual(actual.length, expected.length, `${message} length`);
    for (let i = 0; i < expected.length; i++) {
      assertClose(actual[i], expected[i], tolerance, `${message}[${i}]`);
    }
    return;
  }
  for (const key of Object.keys(expected)) {
    assertClose(actual[key], expected[key], tolerance, `${message}.${key}`);
  }
}

export function assertThrows(fn, message = 'expected the call to throw') {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) throw new AssertionError(message);
}

function format(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v && v.constructor && v.constructor.name) return `${v.constructor.name}(${JSON.stringify(v)})`;
  return String(v);
}

// ---------------------------------------------------------------------------
// Suite definition
//   A suite file exports { name, tests: [{ name, fn }] }. The runner loads
//   them and reports the result.
// ---------------------------------------------------------------------------
export function suite(name, tests) {
  return { name, tests };
}

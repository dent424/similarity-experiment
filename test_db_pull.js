// Local test of the real API handlers against the live Neon DB.
// Sets env vars, then dynamically imports the handlers (they read
// POSTGRES_URL at module load).
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
process.env.POSTGRES_URL = env.match(/POSTGRES_URL=(.+)/)[1].trim().replace(/^["']|["']$/g, '');
process.env.EXPORT_API_KEY = 'local-test-key';

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(s) { this.body = s; return this; },
    end() { return this; }
  };
}

// --- Test 1: /api/export (CSV pull) ---
const { default: exportHandler } = await import('./api/export.js');

const badKey = mockRes();
await exportHandler({ method: 'GET', query: { key: 'wrong-key' } }, badKey);
console.log(`export with wrong key: ${badKey.statusCode} ${JSON.stringify(badKey.body)} (expect 401)`);

const exp = mockRes();
await exportHandler({ method: 'GET', query: { key: 'local-test-key' } }, exp);
const lines = String(exp.body).split('\n');
console.log(`export with valid key: ${exp.statusCode}, ${lines.length - 1} data rows`);
console.log(`header: ${lines[0]}`);
const sample = lines.find(l => l.includes('5-product-pilot'));
console.log(`sample row: ${sample ? sample.slice(0, 120) + '...' : 'NONE FOUND'}`);

// --- Test 2: /api/assign-pairs (balanced assignment pull) ---
const { default: assignHandler } = await import('./api/assign-pairs.js');
const stimuli = JSON.parse(readFileSync('./stimuli/image-only-pilot-2026-05-19/stimuli.json', 'utf8'));
const productIds = stimuli.products.map(p => p.id);

const asg = mockRes();
await assignHandler({
  method: 'POST',
  body: { experiment_name: 'image-only-pilot-2026-05-19', product_ids: productIds, n_pairs: 30 }
}, asg);

console.log(`\nassign-pairs: ${asg.statusCode}`);
const a = asg.body.assignments;
console.log(`assignments returned: ${a.length} (expect 30)`);
const uniquePairs = new Set(a.map(x => x.pair_id));
console.log(`unique pairs: ${uniquePairs.size} (expect 30)`);
const validPositions = a.every(x => ['AB', 'BA'].includes(x.position));
const validIds = a.every(x => productIds.includes(x.left_product_id) && productIds.includes(x.right_product_id));
const noSelf = a.every(x => x.left_product_id !== x.right_product_id);
const pairIdConsistent = a.every(x => x.pair_id === [x.left_product_id, x.right_product_id].sort().join('_'));
console.log(`positions valid: ${validPositions}, ids valid: ${validIds}, no self-pairs: ${noSelf}, pair_id consistent: ${pairIdConsistent}`);
console.log(`first 3: ${JSON.stringify(a.slice(0, 3), null, 2)}`);

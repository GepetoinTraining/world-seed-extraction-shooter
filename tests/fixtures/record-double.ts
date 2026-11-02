/**
 * A STAND-IN FOR TURSO. The real network driver talks to this over real HTTP, in the
 * protocol sqld speaks (Hrana 2 over HTTP, JSON), with SQLite underneath through node:sqlite.
 * It proves the driver path, the SQL and every failure this door has to survive. It proves
 * nothing about Turso's own limits, timing or rules, and passing here is not meeting Turso.
 *
 *   node --disable-warning=ExperimentalWarning --import tsx tests/fixtures/record-double.ts <file> <port> [token]
 *
 * POST /__fault { mode } sets how it misbehaves, for bars and for play:
 *   none           answers
 *   refuse         answers every pipeline with a 503, and applies nothing
 *   lost-answer    applies the next pipeline holding an insert into cold_writedowns, cuts the connection, then goes to `then`
 *   drop           cuts the connection of the next `times` pipelines, and applies nothing
 *   slow           waits `ms` before each answer
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const [, , file, portText, token] = process.argv;
const port = Number(portText);
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL');

let fault: { mode: string; ms?: number; then?: string; times?: number } = { mode: 'none' };

const toValue = (v: any): any => {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (typeof v === 'string') return { type: 'text', value: v };
  return { type: 'blob', base64: Buffer.from(v).toString('base64') };
};
const fromValue = (v: any): any => {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') return BigInt(v.value);
  if (v.type === 'float') return v.value;
  if (v.type === 'text') return v.value;
  return Buffer.from(v.base64, 'base64');
};

const stored = new Map<number, string>();

function runStmt(stmt: any) {
  const text: string = stmt.sql ?? stored.get(stmt.sql_id);
  const prepared = db.prepare(text);
  prepared.setReadBigInts(true);
  const args = (stmt.args ?? []).map(fromValue);
  const named = Object.fromEntries((stmt.named_args ?? []).map((a: any) => [a.name, fromValue(a.value)]));
  const hasNamed = Object.keys(named).length > 0;
  const rows: any[] = hasNamed ? prepared.all(named, ...args) : prepared.all(...args);
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const done: any = db.prepare('SELECT changes() c, last_insert_rowid() r').get();
  return {
    cols: columns.map(name => ({ name, decltype: null })),
    rows: rows.map(row => columns.map(name => {
      const value = row[name];
      // A REAL column holding a whole number is a float on the wire, as sqld sends it.
      return typeof value === 'number' ? { type: 'float', value } : toValue(value);
    })),
    affected_row_count: /^s*(insert|update|delete)/i.test(text) ? Number(done.c) : 0,
    last_insert_rowid: String(done.r)
  };
}

function holds(cond: any, ok: boolean[], errored: boolean[]): boolean {
  if (!cond) return true;
  if (cond.type === 'ok') return ok[cond.step] === true;
  if (cond.type === 'error') return errored[cond.step] === true;
  if (cond.type === 'not') return !holds(cond.cond, ok, errored);
  if (cond.type === 'and') return cond.conds.every((c: any) => holds(c, ok, errored));
  if (cond.type === 'or') return cond.conds.some((c: any) => holds(c, ok, errored));
  return true;
}

function runBatch(batch: any) {
  const step_results: any[] = [];
  const step_errors: any[] = [];
  const ok: boolean[] = [];
  const errored: boolean[] = [];
  batch.steps.forEach((step: any, i: number) => {
    step_results[i] = null;
    step_errors[i] = null;
    ok[i] = false;
    errored[i] = false;
    if (!holds(step.condition, ok, errored)) return;
    try {
      step_results[i] = runStmt(step.stmt);
      ok[i] = true;
    } catch (e) {
      step_errors[i] = { message: (e as Error).message };
      errored[i] = true;
    }
  });
  return { step_results, step_errors };
}

function runRequest(request: any) {
  if (request.type === 'execute') return { type: 'execute', result: runStmt(request.stmt) };
  if (request.type === 'batch') return { type: 'batch', result: runBatch(request.batch) };
  if (request.type === 'sequence') { db.exec(request.sql); return { type: 'sequence' }; }
  if (request.type === 'store_sql') { stored.set(request.sql_id, request.sql); return { type: 'store_sql' }; }
  if (request.type === 'close_sql') { stored.delete(request.sql_id); return { type: 'close_sql' }; }
  if (request.type === 'close') return { type: 'close' };
  throw new Error(`The double has no ${request.type}.`);
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? '').split('?')[0];
    if (path === '/__fault') {
      fault = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return send(200, { fault });
    }
    if (path === '/__sql') {
      // A bar's own look at what is stored, past the door under test.
      return send(200, { rows: runStmt(JSON.parse(Buffer.concat(chunks).toString('utf8'))).rows });
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
    if (path !== '/v2/pipeline') return send(404, { error: `No ${path} here.` });
    if (fault.mode === 'refuse') return send(503, { error: 'The double is refusing, as it was told to.' });
    if (fault.mode === 'slow') await new Promise(r => setTimeout(r, fault.ms ?? 1000));
    if (fault.mode === 'drop') {
      const left = (fault.times ?? 1) - 1;
      fault = left > 0 ? { mode: 'drop', times: left } : { mode: 'none' };
      req.socket.destroy();
      return;
    }

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const text = JSON.stringify(body.requests);
    const results = body.requests.map((request: any) => {
      try {
        return { type: 'ok', response: runRequest(request) };
      } catch (e) {
        return { type: 'error', error: { message: (e as Error).message } };
      }
    });
    if (fault.mode === 'lost-answer' && text.includes('INSERT INTO cold_writedowns')) {
      fault = { mode: fault.then ?? 'none' };
      req.socket.destroy();
      return;
    }
    const closes = body.requests.some((r: any) => r.type === 'close');
    send(200, { baton: closes ? null : 'baton', base_url: null, results });
  });
});

server.listen(port, '127.0.0.1', () => process.stdout.write('READY\n'));

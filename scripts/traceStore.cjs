// Parser-only import graph of the repo: entries, the shared store, and the spider's body.
// Usage: node trace.cjs <repoRoot> <outJson>
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const ts = require(path.join(root, 'node_modules', 'typescript'));
const out = process.argv[3];

const SKIP = new Set(['node_modules', 'dist', 'prototype', '.git', '.claude']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p);
  }
})(root);
const rel = p => path.relative(root, p).split(path.sep).join('/');
const fileSet = new Set(files.map(rel));

function resolve(fromRel, spec) {
  let base;
  if (spec.startsWith('.')) base = path.join(root, path.dirname(fromRel), spec);
  else if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
  else return null;
  const cands = [base, base.replace(/\.js$/, '.ts'), base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  for (const c of cands) { const r = rel(c); if (fileSet.has(r)) return r; }
  return null;
}

const graph = {};      // file -> [{to, dynamic, typeOnly, line}]
for (const f of fileSet) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edges = [];
  const add = (spec, node, dynamic, typeOnly) => {
    const to = resolve(f, spec);
    if (to) edges.push({ to, dynamic, typeOnly, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  (function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(n) ? !!(n.importClause && n.importClause.isTypeOnly) : !!n.isTypeOnly;
      add(n.moduleSpecifier.text, n, false, typeOnly);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      add(n.arguments[0].text, n, true, false);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      add(n.argument.literal.text, n, false, true);
    }
    ts.forEachChild(n, visit);
  })(sf);
  graph[f] = edges;
}

function reach(starts, opts = {}) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !graph[f]) continue;
    seen.add(f);
    if (opts.block && opts.block.has(f) && !starts.includes(f)) continue;
    for (const e of graph[f]) if (!(opts.noDynamic && e.dynamic)) stack.push(e.to);
  }
  return seen;
}

const exists = f => fileSet.has(f);
const gameEntries = ['index.tsx'].filter(exists);
const serverEntries = ['server/main.ts', 'server/hub/main.ts', 'server/hosted/main.ts'].filter(exists);
const scriptEntries = [...fileSet].filter(f => /^scripts\/[^/]+\.tsx?$/.test(f));
const apiEntries = [...fileSet].filter(f => /^api\/.+\.tsx?$/.test(f));

const game = reach(gameEntries);
const serverSide = reach([...serverEntries, ...apiEntries]);
const serverOnlyMain = reach(['server/main.ts']);
const store = new Set([...game].filter(f => serverSide.has(f)));
const storeMainOnly = new Set([...game].filter(f => serverOnlyMain.has(f)));
// Closure: every edge out of the store lands in the store
const leaksOut = [];
for (const f of store) for (const e of graph[f]) if (!store.has(e.to)) leaksOut.push(`${f}:${e.line} -> ${e.to}${e.dynamic ? ' (dynamic)' : ''}${e.typeOnly ? ' (type)' : ''}`);

const gameOnly = new Set([...game].filter(f => !store.has(f)));
const serverOnly = new Set([...serverSide].filter(f => !store.has(f)));

// Cross edges: game-only -> server-only and server-only -> game-only
const cross = [];
for (const f of fileSet) for (const e of graph[f]) {
  if (gameOnly.has(f) && serverOnly.has(e.to)) cross.push(`game->server ${f}:${e.line} -> ${e.to}`);
  if (serverOnly.has(f) && gameOnly.has(e.to)) cross.push(`server->game ${f}:${e.line} -> ${e.to}`);
}

// Tests
const tests = [...fileSet].filter(f => /^tests\/[^/]+\.tsx?$/.test(f));
const testReach = Object.fromEntries(tests.map(t => [t, reach([t])]));
const classify = r => {
  const k = [];
  if ([...r].some(f => gameOnly.has(f))) k.push('game');
  if ([...r].some(f => serverOnly.has(f))) k.push('server');
  if ([...r].some(f => !f.startsWith('tests/') && !store.has(f) && !gameOnly.has(f) && !serverOnly.has(f))) k.push('other');
  return k.length ? k.join('+') : 'store only';
};
const classes = {};
for (const t of tests) { const c = classify(testReach[t]); classes[c] = (classes[c] || 0) + 1; }

// Spider's body: blocking which single module cuts the most game-only reach across tests (dynamic edges kept)
const own = [...fileSet].filter(f => !f.startsWith('tests/'));
const gameOnlyOf = r => [...r].filter(f => gameOnly.has(f)).length;
const baseline = Object.fromEntries(tests.map(t => [t, gameOnlyOf(testReach[t])]));
const cut = [];
for (const m of own) {
  let lost = 0, testsHit = 0;
  for (const t of tests) {
    if (!testReach[t].has(m) || baseline[t] === 0) continue;
    const after = gameOnlyOf(reach([t], { block: new Set([m]) }));
    const d = baseline[t] - after;
    if (d > 0) { lost += d; testsHit++; }
  }
  if (lost > 0) cut.push({ m, lost, testsHit, store: store.has(m) });
}
cut.sort((a, b) => b.lost - a.lost);

// Same, with dynamic imports ignored: how much of the web is lazy
const noDyn = Object.fromEntries(tests.map(t => [t, gameOnlyOf(reach([t], { noDynamic: true }))]));

fs.writeFileSync(out, JSON.stringify({
  counts: { files: fileSet.size, game: game.size, serverSide: serverSide.size, store: store.size, storeWithMainOnly: storeMainOnly.size, gameOnly: gameOnly.size, serverOnly: serverOnly.size },
  entries: { gameEntries, serverEntries, scriptEntries, apiEntries },
  storeClosed: leaksOut.length === 0, leaksOut,
  cross, classes,
  testGameOnly: baseline, testGameOnlyNoDynamic: noDyn,
  spider: cut.slice(0, 25),
  store: [...store].sort(),
  graph
}, null, 1));
console.log(JSON.stringify({ counts: { files: fileSet.size, game: game.size, serverSide: serverSide.size, store: store.size, storeWithMainOnly: storeMainOnly.size }, storeClosed: leaksOut.length === 0, leaks: leaksOut.length, cross: cross.length, classes }, null, 1));

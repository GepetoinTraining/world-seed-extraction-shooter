// @vitest-environment node
/**
 * ONE WAY ONLY. The code the game and the servers both run lives in shared/, and reaches nothing
 * outside it. The game never reaches the servers' own code, and the servers never reach the game's.
 * Both sides call shared/ and agree because they call the same thing.
 *
 * Read with TypeScript's parser alone, file by file: no program and no checker, so it stays quick
 * however much code there is. Every kind of import counts, a type-only one and a late one included,
 * and data files too. Each break is named by its file and line.
 *
 * The sides are folders: shared/; the servers are server/ and api/; the game is src/ and the files
 * at the root that the page's entry (named in index.html) reaches. Tests, scripts and tools may
 * import from anywhere.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type Side = 'shared' | 'server' | 'game';
interface Edge { from: string; to: string; line: number }

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TRIES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js'];

/** Joins a relative specifier onto a file's folder, in forward slashes, `..` worked out. */
function joinRel(fromFile: string, spec: string): string {
  const parts = fromFile.split('/').slice(0, -1);
  for (const step of spec.split('/')) {
    if (step === '..') parts.pop();
    else if (step !== '.' && step !== '') parts.push(step);
  }
  return parts.join('/');
}

/** Every relative import in a file, resolved against the files that exist. */
function importsOf(file: string, text: string, exists: (path: string) => boolean): Edge[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edges: Edge[] = [];
  const add = (lit: ts.StringLiteralLike) => {
    if (!lit.text.startsWith('.')) return;
    const base = joinRel(file, lit.text);
    const to = [...TRIES.map(t => base + t), base.replace(/\.js$/, '.ts')].find(exists);
    if (to) edges.push({ from: file, to, line: sf.getLineAndCharacterOfPosition(lit.getStart(sf)).line + 1 });
  };
  (function visit(n: ts.Node) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) add(n.moduleReference.expression);
    else if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) add(n.arguments[0]);
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) add(n.argument.literal);
    ts.forEachChild(n, visit);
  })(sf);
  return edges;
}

/** The page's entry scripts, as index.html names them. */
const entriesOf = (html: string): string[] =>
  [...html.matchAll(/<script[^>]*\bsrc="\/?([^"]+)"/g)].map(m => m[1]);

/**
 * The breaks in a tree of files: path → text, paths relative to the root in forward slashes.
 * `html` is the page that names the game's entry.
 */
export function breaksOf(files: Map<string, string>, html: string): Record<'sharedOut' | 'gameToServer' | 'serverToGame', string[]> {
  const exists = (p: string) => files.has(p);
  const edges = new Map<string, Edge[]>();
  for (const [file, text] of files) if (SOURCE.test(file)) edges.set(file, importsOf(file, text, exists));

  // The root-level files the page's entry reaches belong to the game
  const rootGame = new Set<string>();
  const stack = entriesOf(html).filter(exists);
  const seen = new Set<string>();
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!f.includes('/')) rootGame.add(f);
    for (const e of edges.get(f) ?? []) stack.push(e.to);
  }
  const sideOf = (f: string): Side | null =>
    f.startsWith('shared/') ? 'shared'
      : f.startsWith('server/') || f.startsWith('api/') ? 'server'
        : f.startsWith('src/') || rootGame.has(f) ? 'game'
          : null;

  const out = { sharedOut: [] as string[], gameToServer: [] as string[], serverToGame: [] as string[] };
  for (const list of edges.values()) for (const e of list) {
    const from = sideOf(e.from), to = sideOf(e.to);
    const said = `${e.from}:${e.line} imports ${e.to}`;
    if (from === 'shared' && to !== 'shared') out.sharedOut.push(said);
    if (from === 'game' && to === 'server') out.gameToServer.push(said);
    if (from === 'server' && to === 'game') out.serverToGame.push(said);
  }
  return out;
}

/** The repo's own files, without packages, builds or the prototype. */
function repoFiles(root: string): Map<string, string> {
  const skip = new Set(['node_modules', 'dist', 'dist-site', 'prototype']);
  const files = new Map<string, string>();
  (function walk(dir: string, rel: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name.startsWith('.') || (rel === '' && e.name === 'data')) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), path);
      else if (SOURCE.test(e.name)) files.set(path, readFileSync(join(dir, e.name), 'utf8'));
      else if (e.name.endsWith('.json')) files.set(path, '');
    }
  })(root, '');
  return files;
}

describe('the code both sides run is imported one way only', () => {
  const root = process.cwd();
  const files = repoFiles(root);
  const breaks = breaksOf(files, readFileSync(join(root, 'index.html'), 'utf8'));

  it('the check reads the repo: shared/ has files and they import each other', () => {
    expect(existsSync(join(root, 'shared', 'tsconfig.json'))).toBe(true);
    const shared = [...files.keys()].filter(f => f.startsWith('shared/') && SOURCE.test(f));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some(f => importsOf(f, files.get(f)!, p => files.has(p)).length > 0)).toBe(true);
  });

  it('nothing in shared/ imports from outside it', () => {
    expect(breaks.sharedOut).toEqual([]);
  });

  it('the game imports none of the servers\' own code', () => {
    expect(breaks.gameToServer).toEqual([]);
  });

  it('the servers import none of the game\'s own code', () => {
    expect(breaks.serverToGame).toEqual([]);
  });

  it('a break of each kind is found and named by file and line, whatever the kind of import', () => {
    const tree = new Map<string, string>([
      ['index.tsx', `import App from './App';\n`],
      ['App.tsx', `import { a } from './shared/a';\nexport default a;\n`],
      ['vite.config.ts', `import { plugin } from './server/plugin';\n`],
      ['shared/a.ts', `import { b } from './b';\nimport type { G } from '../src/g';\nexport const a = b;\n`],
      ['shared/b.ts', `export const b = 1;\nexport const late = () => import('../server/s');\n`],
      ['src/g.ts', `export type G = number;\nimport { a } from '../shared/a';\nexport { s } from '../server/s.ts';\n`],
      ['src/data.ts', `import options from '../server/options.json';\n`],
      ['server/s.ts', `import { a } from '../shared/a';\nexport const s = 1;\nexport type T = import('../App').default;\n`],
      ['server/options.json', ''],
      ['server/plugin.ts', `export const plugin = 1;\n`],
      ['api/route.ts', `const g = require('../src/g');\n`],
      ['tests/any.test.ts', `import { s } from '../server/s';\nimport { G } from '../src/g';\n`]
    ]);
    const found = breaksOf(tree, '<script type="module" src="/index.tsx"></script>');
    expect(found.sharedOut.sort()).toEqual(['shared/a.ts:2 imports src/g.ts', 'shared/b.ts:2 imports server/s.ts']);
    expect(found.gameToServer.sort()).toEqual(['src/data.ts:1 imports server/options.json', 'src/g.ts:3 imports server/s.ts']);
    expect(found.serverToGame.sort()).toEqual(['api/route.ts:1 imports src/g.ts', 'server/s.ts:3 imports App.tsx']);
  });
});

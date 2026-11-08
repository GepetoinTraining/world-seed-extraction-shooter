/**
 * THE HUB HAS ONE WRITER, AND THE TECH WEB ONE DOOR. The hub store owns the hub's state; a system takes
 * a view of it, or a port, and hands its changes back as data (src/entities/hub/hubView.ts). The tech
 * web is the hub's own container (techWebView.ts): every change to `web` and `tech` goes through the
 * store's `applyTech`. The stores reach each other only through the ports they offer (storePorts.ts).
 * Read with the parser alone:
 *
 * - who may import the hub store: a screen (a .tsx file, or anything under src/components), a store
 *   (a file that makes one with zustand's `create`), the boot (src/logic/initialization), and tests;
 * - no store imports another store;
 * - inside the hub store and its slice, only `applyTech` writes `web` or `tech`;
 * - neither list of changes names a function.
 *
 * And the store's two doors apply what they are handed, in order.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorStore: { get: vi.fn(async () => null), put: vi.fn(async () => undefined), query: vi.fn(async () => []), saveContent: vi.fn(async () => undefined) },
  VectorNamespace: { ITEMS: 'ITEMS', TERRITORIES: 'TERRITORIES', TRANSACTIONS: 'TRANSACTIONS', CONTENT: 'CONTENT', CHARACTERS: 'CHARACTERS' }
}));

import { IItem } from '../shared/types';
import { hubPort, techWebPort, useHubStore } from '../src/entities/hub/store';
import { emptyTech } from '../src/entities/hub/hubTech';

const STORES = ['src/entities/world/store', 'src/entities/player/store', 'src/entities/hub/store'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
/** Every module a file imports, early or late, as a path from the root without its extension. */
function importsOf(file: string): { to: string; line: number }[] {
  const sf = parse(file);
  const out: { to: string; line: number }[] = [];
  (function visit(n: ts.Node) {
    const spec = ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier
      : ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier
        : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) ? n.arguments[0]
          : null;
    if (spec && spec.text.startsWith('.')) out.push({ to: join(file, '..', spec.text).split('\\').join('/').replace(/\.tsx?$/, ''), line: lineOf(sf, n) });
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

describe('the hub store is the one writer of the hub, and the tech web has one door', () => {
  it('only screens, stores and the boot import the hub store; each system takes the hub as an argument', () => {
    const breaks: string[] = [];
    for (const file of [...sources('src'), 'App.tsx', 'index.tsx']) {
      if (file.endsWith('.tsx') || file.startsWith('src/components/') || file.startsWith('src/logic/initialization/') || file === `${STORES[2]}.ts`) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bcreate(<[^>]*>)?\(/.test(text) && /from 'zustand'/.test(text)) continue;
      for (const i of importsOf(file)) if (i.to === STORES[2]) breaks.push(`${file}:${i.line} imports the hub store`);
    }
    expect(breaks).toEqual([]);
  });

  it('no store imports another store: each reaches the others through the ports they offer', () => {
    const breaks: string[] = [];
    for (const store of STORES) {
      for (const i of importsOf(`${store}.ts`)) if (STORES.includes(i.to) && i.to !== store) breaks.push(`${store}.ts:${i.line} imports ${i.to}`);
    }
    expect(breaks).toEqual([]);
  });

  it('inside the hub store and its slice, only applyTech writes the tech web', () => {
    const breaks: string[] = [];
    for (const file of ['src/entities/hub/store.ts', 'src/entities/hub/techDoors.ts']) {
      const sf = parse(file);
      (function visit(n: ts.Node, inApplyTech: boolean) {
        if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'applyTech') inApplyTech = true;
        if (!inApplyTech && ts.isCallExpression(n) && /^(set|useHubStore\.setState)$/.test(n.expression.getText(sf))) {
          const arg = n.arguments[0];
          const objects: ts.ObjectLiteralExpression[] = [];
          (function find(m: ts.Node) { if (ts.isObjectLiteralExpression(m)) objects.push(m); ts.forEachChild(m, find); })(arg);
          for (const o of objects) for (const p of o.properties) {
            // the state handed to set: the object itself, or the one an arrow hands back
            if (o === arg || (ts.isParenthesizedExpression(o.parent) && o.parent.parent === arg)) {
              const key = p.name?.getText(sf);
              if (key === 'web' || key === 'tech') breaks.push(`${file}:${lineOf(sf, p)} writes ${key} outside applyTech`);
            }
          }
        }
        ts.forEachChild(n, c => visit(c, inApplyTech));
      })(sf, false);
    }
    expect(breaks).toEqual([]);
  });

  for (const [file, union] of [['src/entities/hub/hubView.ts', 'HubChange'], ['src/entities/hub/techWebView.ts', 'TechWebChange']] as const) {
    it(`${union} is plain data, and its file imports types only`, () => {
      const sf = parse(file);
      const found: string[] = [];
      sf.forEachChild(n => {
        if (ts.isImportDeclaration(n) && !n.importClause?.isTypeOnly) found.push(`${file}:${lineOf(sf, n)} imports a value`);
        if (!ts.isTypeAliasDeclaration(n) || n.name.text !== union) return;
        (function visit(m: ts.Node) {
          if (ts.isFunctionTypeNode(m) || ts.isMethodSignature(m) || ts.isConstructorTypeNode(m)) found.push(`${file}:${lineOf(sf, m)} names a function`);
          ts.forEachChild(m, visit);
        })(n.type);
        found.push('seen');
      });
      expect(found).toEqual(['seen']);
    });
  }

  it('each change handed to the hub, and to the tech web, lands, in order', () => {
    const item = (id: string): IItem => ({ id, name: id } as IItem);
    useHubStore.setState({ lots: [{ id: 'lot_1', lotIndex: 0, ownerId: 'me', ownerName: 'Me', purchaseDate: 0, structureType: 'FARM', inventory: [item('a'), item('b')], price: 0 }] });
    hubPort.apply(
      { kind: 'LOT_STORE_ADD', lotId: 'lot_1', items: [item('c')] },
      { kind: 'LOT_STORE_REMOVE', lotId: 'lot_1', itemId: 'a' },
      { kind: 'LOT_LIST', lotId: 'lot_1', itemId: 'b', price: 7 }
    );
    const lot = hubPort.view().lots[0];
    expect(lot.inventory.map(i => i.id)).toEqual(['c']);
    expect(lot.shopListings?.map(l => [l.item.id, l.price])).toEqual([['b', 7]]);
    hubPort.apply({ kind: 'LOT_UNLIST', lotId: 'lot_1', itemId: 'b' });
    expect(hubPort.view().lots[0].inventory.map(i => i.id)).toEqual(['c', 'b']);

    // Tech web 0, then a person's ask and a workshop that stands
    techWebPort.apply({ kind: 'WEB', web: { nodes: {} } }, { kind: 'TECH', tech: emptyTech() });
    techWebPort.apply(
      { kind: 'ASK', residentId: 'res_1', ask: { stationId: 'st_forge', words: 'a forge', by: 'TALK' } },
      { kind: 'WORKSHOP_ADD', workshop: { id: 'ws_1', residentId: 'res_1', lotId: 'lot_1', mode: 'WORKSTATION', stations: ['st_forge'], name: 'Forge', bill: [], pool: {} } },
      { kind: 'WORKSHOPS_STAND', ids: ['ws_1'], at: 42 }
    );
    const { tech } = techWebPort.view();
    expect(tech.asks.res_1?.stationId).toBe('st_forge');
    expect(tech.workshops.map(w => [w.id, w.standsAt])).toEqual([['ws_1', 42]]);
  });
});

/**
 * THE PLAYER HAS ONE WRITER. The player store owns the player's state; a system takes the player, or a
 * port to it, and hands its changes back as data (src/entities/player/playerView.ts). Two checks hold that:
 *
 * - who may import the store module, read with the parser alone: a screen (.tsx), a store (a file that
 *   makes one with zustand's `create`), the boot (src/logic/initialization), and tests. The hub store's
 *   own slice (techDoors.ts, made inside the hub store) waits for the hub store's pass, by name. Each
 *   other importer, late imports included, is named by file and line.
 * - the store's one door applies each kind of change it is handed, in order.
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
import { playerPort, usePlayerStore } from '../src/entities/player/store';

const STORE = 'src/entities/player/store';
const HUB_PASS = new Set(['src/entities/hub/techDoors.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('the player store is the one writer of the player', () => {
  it('only screens, stores and the boot import the store; each system takes the player as an argument', () => {
    const breaks: string[] = [];
    for (const file of [...sources('src'), 'App.tsx', 'index.tsx']) {
      if (file.endsWith('.tsx') || file.startsWith('src/logic/initialization/') || file === `${STORE}.ts` || HUB_PASS.has(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bcreate(<[^>]*>)?\(/.test(text) && /from 'zustand'/.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
      const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const reaches = (spec: string) => spec.startsWith('.') && join(file, '..', spec).split('\\').join('/') === STORE;
      (function visit(n: ts.Node) {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && reaches(n.moduleSpecifier.text)) breaks.push(`${file}:${at(n)} imports the player store`);
        if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && reaches(n.arguments[0].text)) {
          breaks.push(`${file}:${at(n)} imports the player store late`);
        }
        ts.forEachChild(n, visit);
      })(sf);
    }
    expect(breaks).toEqual([]);
  });

  it('the view, the changes and the calls are types only: reaching them reaches nothing else of the game', () => {
    const text = readFileSync('src/entities/player/playerView.ts', 'utf8');
    const imports = [...text.matchAll(/^import (type )?[^;]+;/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1], m[0]).toBe('type ');
  });

  it('each change handed in lands, in order', () => {
    const item = (id: string): IItem => ({ id, name: id } as IItem);
    const start = usePlayerStore.getState().player;
    usePlayerStore.setState({
      player: { ...start, bank: { ...start.bank, gold: 100, stashTabs: [{ ...(start.bank.stashTabs[0] ?? { id: 'tab_0', name: 'MAIN' } as any), items: [item('a')] }] } }
    });
    playerPort.apply(
      { kind: 'GOLD', delta: -30 },
      { kind: 'STASH_ADD', items: [item('b'), item('c')] },
      { kind: 'STASH_REMOVE', ids: ['a'] },
      { kind: 'UPDATE', update: p => ({ ...p, username: 'Read back' }) }
    );
    const after = playerPort.view().player;
    expect(after.bank.gold).toBe(70);
    expect(after.bank.stashTabs[0].items.map(i => i.id)).toEqual(['b', 'c']);
    expect(after.username).toBe('Read back');
    playerPort.apply({ kind: 'SET', player: start });
    expect(playerPort.view().player).toBe(start);
  });
});

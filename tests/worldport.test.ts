/**
 * THE WORLD HAS ONE WRITER. The world store owns the world's state; a system takes a view of it and
 * hands its changes back as data (src/entities/world/worldView.ts). Two checks hold that:
 *
 * - who may import the store module, read with the parser alone: a screen (.tsx), a store (a file
 *   that makes one with zustand's `create`), the boot (src/logic/initialization), and tests. Each
 *   other importer is named by file and line.
 * - the store's one door applies each kind of change it is handed, in order.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorStore: { get: vi.fn(async () => null), put: vi.fn(async () => undefined), query: vi.fn(async () => []), saveContent: vi.fn(async () => undefined) },
  VectorNamespace: { ITEMS: 'ITEMS', TERRITORIES: 'TERRITORIES', TRANSACTIONS: 'TRANSACTIONS', CONTENT: 'CONTENT' }
}));

import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { useWorldStore, worldPort } from '../src/entities/world/store';
import { bodyOf } from '../src/entities/world/worldView';

const STORE = 'src/entities/world/store';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('the world store is the one writer of the world', () => {
  it('only screens, stores and the boot import the store; each system takes the world as an argument', () => {
    const breaks: string[] = [];
    for (const file of [...sources('src'), 'App.tsx', 'index.tsx']) {
      if (file.endsWith('.tsx') || file.startsWith('src/logic/initialization/') || file === `${STORE}.ts`) continue;
      const text = readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
      const makesAStore = /\bcreate(<[^>]*>)?\(/.test(text) && /from 'zustand'/.test(text);
      if (makesAStore) continue;
      sf.forEachChild(n => {
        if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
        const spec = n.moduleSpecifier.text;
        if (!spec.startsWith('.')) return;
        const to = join(file, '..', spec).split('\\').join('/');
        if (to === STORE) breaks.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} imports the world store`);
      });
    }
    expect(breaks).toEqual([]);
  });

  it('the view and the changes are types and readers only: reaching them reaches nothing else of the game', () => {
    const text = readFileSync('src/entities/world/worldView.ts', 'utf8');
    const imports = [...text.matchAll(/^import (type )?[^;]+;/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1], m[0]).toBe('type ');
  });

  it('each change handed in lands, in order', () => {
    const body = (id: string, x: number): IWorldEntity =>
      ({ id, type: EntityType.MOB, definitionId: 'mob_rat', position: { x, y: 10 }, isHostile: true, health: 5 } as IWorldEntity);
    useWorldStore.setState({
      activeWorldId: 'w1', generation: 0, populationRecord: null, directorRecord: null,
      currentMap: { seed: 's', chunks: { '0,0': { entities: [] } }, sectors: {} } as any,
      availableWorlds: [{ id: 'w1', playerCount: 2 } as any, { id: 'w2', playerCount: 7 } as any]
    });
    worldPort.apply(
      { kind: 'ADD_BODY', entity: body('a', 10) },
      { kind: 'ADD_BODY', entity: body('b', 20) },
      { kind: 'UPDATE_BODY', entityId: 'a', patch: { health: 1 } },
      { kind: 'REMOVE_BODY', entityId: 'b' },
      { kind: 'DROP_COUNTED', worldId: 'w1' }
    );
    const view = worldPort.view();
    expect(bodyOf(view, 'a')?.health).toBe(1);
    expect(bodyOf(view, 'b')).toBeUndefined();
    expect(view.availableWorlds.map(w => w.playerCount)).toEqual([3, 7]);
    // A record for a world that is not the one open is not taken
    worldPort.apply({ kind: 'ADOPT_RECORD', worldId: 'w2', record: { anything: true } as any });
    expect(worldPort.view().directorRecord).toBeNull();
  });
});

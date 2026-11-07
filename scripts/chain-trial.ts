/**
 * THE CHAIN TRIAL. Pedro, 2026-11-01: "you can run code to see it working, give a tribe
 * (amazonian pre writing) a 3000 AD engineering genious, and sprinkle some weird things in
 * between, check how many calls you need to node and edge them".
 *
 * It asks through the door's own prompts and judges through the real law, and it does not
 * care who answers. One round at a time, so a person can stand in as the provider:
 *
 *   node --import tsx scripts/chain-trial.ts ask <dir> <person>       writes <dir>/ask.txt
 *   node --import tsx scripts/chain-trial.ts take <dir> <person> <f>  judges an answer
 *   node --import tsx scripts/chain-trial.ts report <dir>             the count so far
 *
 * It never reads a key. Add one to the server to run it live.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildChainRequest, CHAIN_SCHEMA } from '../shared/intelligence/prompts';
import { ChainWeb, IChainGround, IChainRound, IChainWeb, emptyChain } from '../shared/logic/theme/ChainWeb';
import { WebBank } from '../shared/logic/content/WebBank';
import { ThemeRank } from '../shared/logic/theme/ThemeTypes';

// A people with no writing, no metal and no wheel. Fire, stone, cane, river.
export const TRIBE_GROUND: IChainGround = {
  things: [
    { key: 'palm_wood', name: 'Palm Wood', tags: ['wood', 'flora'], rank: 'F' },
    { key: 'river_clay', name: 'River Clay', tags: ['stone', 'mineral'], rank: 'F' },
    { key: 'flint', name: 'Flint', tags: ['stone', 'mineral'], rank: 'F' },
    { key: 'cane_fiber', name: 'Cane Fiber', tags: ['fiber', 'flora'], rank: 'F' },
    { key: 'river_sand', name: 'River Sand', tags: ['sand', 'mineral'], rank: 'F' },
    { key: 'jungle_fruit', name: 'Jungle Fruit', tags: ['fruit', 'flora'], rank: 'F' },
    { key: 'manioc_root', name: 'Manioc Root', tags: ['grain', 'flora'], rank: 'F' },
    { key: 'curare_vine', name: 'Curare Vine', tags: ['flora'], rank: 'E' },
    { key: 'fishbone', name: 'Fishbone', tags: ['biological'], rank: 'F' },
    { key: 'resin', name: 'Tree Resin', tags: ['flora'], rank: 'E' },
    { key: 'charcoal', name: 'Charcoal', tags: ['fire'], rank: 'E' }
  ],
  stations: [
    { key: 'fire_pit', name: 'Fire Pit', tool: ['tongs'], material: ['fire'] },
    { key: 'knapping_stone', name: 'Knapping Stone', tool: ['chisel'], material: ['stone'] },
    { key: 'drying_rack', name: 'Drying Rack', tool: ['sickle'], material: ['grain'] }
  ],
  tools: ['axe', 'chisel', 'sickle', 'tongs', 'mortar', 'blade']
};

interface IPerson { key: string; name: string; rank: ThemeRank; concept: string; knows: string; workshop: string; tool: string[]; material: string[] }

interface ITrialState {
  chain: IChainWeb;
  calls: { person: string; round: number; ok: boolean; reason?: string; chars: number; opened: number; answered: number; nodes: number; edges: number }[];
  people: Record<string, IPerson>;
}

const statePath = (dir: string) => join(dir, 'state.json');
const load = (dir: string): ITrialState => existsSync(statePath(dir))
  ? JSON.parse(readFileSync(statePath(dir), 'utf8'))
  : { chain: emptyChain(), calls: [], people: {} };
const save = (dir: string, state: ITrialState) => { mkdirSync(dir, { recursive: true }); writeFileSync(statePath(dir), JSON.stringify(state, null, 1)); };

// The tribe's own words count, as a theme's do once it is installed.
const TRIBE_WORDS = new Set([
  ...TRIBE_GROUND.tools, ...TRIBE_GROUND.things.flatMap(t => t.tags),
  ...TRIBE_GROUND.stations.flatMap(s => [...s.tool, ...s.material]),
  'hammer', 'saw', 'drill', 'adze', 'mallet', 'shears', 'shuttle', 'blowpipe', 'awl', 'pickaxe',
  'metal', 'ore', 'glass', 'cloth', 'paper', 'ink', 'seed', 'berry', 'fire'
]);
const registered = (tag: string) => TRIBE_WORDS.has(tag) || WebBank.current().tags.some(t => t.tag === tag && !t.retired);

const groundLine = (ground: IChainGround) => ({
  things: ground.things.map(t => `${t.key} (${t.rank}): ${t.name}`),
  stations: ground.stations.map(s => `${s.key}: ${s.name}, ${s.tool.join('/')} on ${s.material.join('/')}`),
  tools: ground.tools
});

const writtenLine = (chain: IChainWeb) => ({
  words: chain.tags.map(t => t.tag),
  things: [...chain.materials.map(m => `${m.key} (${m.rank})`), ...chain.goods.map(g => `${g.key} (${g.rank})${g.answers ? ` answers ${g.answers}` : ''}`), ...chain.gear.map(g => `${g.key} (${g.rank}), tool ${g.tags.join('/')}`)],
  stations: chain.stations.map(s => `${s.key}: ${s.tool.join('/')} on ${s.material.join('/')}`)
});

function ask(dir: string, personKey: string) {
  const state = load(dir);
  const person = state.people[personKey];
  if (!person) throw new Error(`No such person: ${personKey}`);
  const open = ChainWeb.open(person.concept, person.rank, state.chain, TRIBE_GROUND, personKey);
  const last = [...state.calls].reverse().find(c => c.person === personKey);
  const request = buildChainRequest({ person, ground: groundLine(TRIBE_GROUND), written: writtenLine(state.chain), open, refused: last && !last.ok ? last.reason : undefined });
  const text = `SYSTEM:\n${request.system}\n\nSCHEMA:\n${JSON.stringify(CHAIN_SCHEMA)}\n\nUSER:\n${request.messages[0].content}`;
  writeFileSync(join(dir, 'ask.txt'), text);
  console.log(JSON.stringify({ person: personKey, open: open.length, needs: open.map(n => `${n.kind}:${n.key}`), chars: text.length }));
}

function take(dir: string, personKey: string, file: string) {
  const state = load(dir);
  const person = state.people[personKey];
  const open = ChainWeb.open(person.concept, person.rank, state.chain, TRIBE_GROUND, personKey);
  const raw = readFileSync(file, 'utf8');
  const round = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as IChainRound;
  const verdict = ChainWeb.judge(round, state.chain, TRIBE_GROUND, open, registered);
  const n = state.calls.filter(c => c.person === personKey).length + 1;
  if (verdict.ok) state.chain = ChainWeb.merge(state.chain, round, personKey);
  const after = ChainWeb.open(person.concept, person.rank, state.chain, TRIBE_GROUND, personKey);
  const m = ChainWeb.measure(state.chain);
  state.calls.push({ person: personKey, round: n, ok: verdict.ok, reason: verdict.reason, chars: raw.length, opened: after.length, answered: open.length - after.filter(a => open.some(o => o.key === a.key)).length, nodes: m.nodes, edges: m.edges });
  save(dir, state);
  console.log(JSON.stringify({ person: personKey, round: n, ok: verdict.ok, reason: verdict.reason, stillOpen: after.map(a => `${a.kind}:${a.key}`), ...m }));
}

function report(dir: string) {
  const state = load(dir);
  console.log(JSON.stringify({ calls: state.calls, measure: ChainWeb.measure(state.chain) }, null, 1));
}

const [, , command, dir, a, b] = process.argv;
if (command === 'ask') ask(dir, a);
else if (command === 'take') take(dir, a, b);
else if (command === 'report') report(dir);
else if (command === 'people') {
  const state = load(dir);
  const raw = readFileSync(a, 'utf8');
  for (const p of JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).professions as IPerson[]) state.people[p.key] = p;
  save(dir, state);
  console.log(Object.keys(state.people).join(', '));
}

// What it all came to: each person's road, with nothing raised, then in the order they arrived.
if (command === 'roads') {
  const state = load(dir);
  const raised = new Set(TRIBE_GROUND.stations.map(s => s.key));
  for (const [key, person] of Object.entries(state.people)) {
    const alone = ChainWeb.route(person.concept, state.chain, TRIBE_GROUND, { stations: new Set(TRIBE_GROUND.stations.map(s => s.key)), bench: true });
    const after = ChainWeb.route(person.concept, state.chain, TRIBE_GROUND, { stations: raised, bench: true });
    const calls = state.calls.filter(c => c.person === key);
    console.log(JSON.stringify({ key, calls: calls.length, refused: calls.filter(c => !c.ok).length, chars: calls.reduce((n, c) => n + c.chars, 0), road: alone.stations.length, broken: !!alone.broken, roadInOrder: after.stations.length, roadStations: alone.stations }));
    for (const s of after.stations) raised.add(s);
  }
  console.log(JSON.stringify(ChainWeb.measure(state.chain)));
}

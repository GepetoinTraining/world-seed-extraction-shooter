/**
 * THE DOOR'S ROUTES, as a function of method, path and body: the server's handler (http.ts) and a
 * page that holds its own door (src/logic/intelligence/PageDoor.ts) answer through the same table,
 * so a door in a browser is the same door, asking the same things in the same shapes.
 */
import { IntelligenceDoor, TALK_MESSAGE_LIMIT, type IDoorMessage } from './door';
import { SETTINGS, type DoorSetting } from './setting';
import { buildBargainRequest, buildCreationRequest, buildKamiPersonaRequest, buildVoiceGiftRequest, buildKamiSetRequest, buildKamiTalkRequest, buildBasesRequest, buildLootRequest, buildNpcGoalRequest, buildNpcMeetRequest, buildNpcTalkRequest, buildRestRequest, buildTalkRequest, buildThemeRequest, buildWorldPassRequest, isWorldPass, WINDOW_REQUESTS } from './prompts';
import { askChainInParts } from './parts';

/** TQ: the first order's ask is one short message (Pedro: "one short tweet"). */
export const VOICE_GIFT_CHARACTERS = 280;

/** An answer: a JSON body, or lines written as they come, ending with the last one. */
export type DoorAnswer =
  | { status: number; json: unknown; stream?: undefined }
  | { status: number; json?: undefined; stream: (write: (line: string) => void, signal: AbortSignal) => Promise<string> };

const json = (status: number, value: unknown): DoorAnswer => ({ status, json: value });

/** `path` is what follows the mount: /status, /machine, /options, /talk, /theme, /world/pass, /creation, /chain, /kami/persona, /kami/talk, /kami/set, /kami/gift, /npc/talk, /npc/goal, /npc/bargain, /npc/meet, /rest/file, /rest/collect, /window/file, /window/collect, and the voice's /machine/try, /local/choose, /local/pull, /key, /auto. */
export async function routeDoor(door: IntelligenceDoor, method: string, path: string, body: any, given?: DoorSetting): Promise<DoorAnswer> {
  if (path === '/status') return json(200, await door.status());
  const setting = given ?? SETTINGS.get(door);
  // The check on this machine and the free options: read here, answered to this machine only
  if (path === '/machine' && method === 'GET') return setting ? json(200, await setting.check.read()) : json(200, { status: 'REFUSED', reason: 'This server has no setting to read.' });
  if (path === '/options' && method === 'GET') return json(200, setting ? { keyed: setting.options.keyed, local: setting.options.local ?? null } : { keyed: [], local: null });
  // Whose keys are held and which is in use. Never a key.
  if (path === '/keys' && method === 'GET') return json(200, { keys: setting ? setting.keys() : [] });
  if (method !== 'POST') return json(405, { error: 'POST only.' });

  const conversation = (body.messages ?? []) as IDoorMessage[];
  const unsettable = () => json(200, { status: 'REFUSED', reason: 'The voice cannot be changed on this server.' });
  switch (path) {
    case '/machine/try':
      if (!setting) return unsettable();
      return json(200, await setting.check.tryModel(String(body.model ?? setting.local.runtime.model)));
    case '/local/choose':
      if (!setting) return unsettable();
      setting.useLocal(String(body.model ?? ''));
      return json(200, { status: await setting.status(), machine: await setting.check.read() });
    case '/local/pull': {
      if (!setting) return unsettable();
      const model = String(body.model ?? '').trim();
      if (!model || !setting.local.runtime.pull) return json(200, { ok: false, reason: 'Nothing to pull.' });
      return json(200, await setting.local.runtime.pull(model));
    }
    case '/key': {
      if (!setting) return unsettable();
      // The key stops here. What goes back says only whether it worked.
      const out = await setting.useKey(String(body.optionId ?? ''), String(body.key ?? ''));
      return json(200, out);
    }
    case '/key/test':
      if (!setting) return unsettable();
      // One question to the provider. The key is not held after it, whatever the answer.
      return json(200, await setting.testKey(String(body.optionId ?? ''), String(body.key ?? '')));
    case '/key/use':
      if (!setting) return unsettable();
      return json(200, await setting.useHeld(String(body.optionId ?? '')));
    case '/key/forget':
      if (!setting) return unsettable();
      return json(200, setting.forgetKey(String(body.optionId ?? '')));
    case '/auto':
      if (!setting) return unsettable();
      setting.useAuto();
      return json(200, await setting.status());
    case '/talk':
      return json(200, await door.ask(buildTalkRequest(conversation, body.draft ?? {})));
    case '/theme':
      return json(200, await door.ask(buildThemeRequest(conversation, body.draft ?? {})));
    case '/creation':
      return json(200, await door.ask(buildCreationRequest(body.ask ?? {})));
    case '/chain':
      return json(200, await askChainInParts(door, body.ask ?? {}));
    case '/loot':
      return json(200, await door.ask(buildLootRequest(body.ask ?? {})));
    case '/world/bases':
      // IB: what a minting adds, in one ask
      return json(200, await door.ask(buildBasesRequest(body.ask ?? {})));
    case '/world/pass':
      if (!isWorldPass(body.pass)) return json(200, { status: 'REFUSED', reason: 'A world is written in no such pass.' });
      return json(200, await door.ask(buildWorldPassRequest(body.pass, body.ask ?? {}, body.draft ?? {})));
    case '/kami/talk':
      // One JSON line for each piece as it is written, then one saying how it ended. A closed tab stops the bill.
      return {
        status: 200,
        stream: async (write, signal) => {
          const out = await door.askStream(buildKamiTalkRequest(conversation, body.persona), text => {
            if (!signal.aborted) write(`${JSON.stringify({ text })}\n`);
          }, signal);
          return `${JSON.stringify({ done: true, status: out.status, usage: out.usage, reason: out.reason })}\n`;
        }
      };
    case '/kami/set':
      return json(200, await door.ask(buildKamiSetRequest(conversation, body.ask ?? {}, body.persona)));
    case '/kami/gift': {
      // TQ: one short message, at most a tweet; nothing longer is carried
      const said = String(body.ask?.said ?? '');
      if (!said.trim() || said.length > VOICE_GIFT_CHARACTERS) return json(200, { status: 'REFUSED', reason: `One short message: ${VOICE_GIFT_CHARACTERS} characters at most.` });
      return json(200, await door.ask(buildVoiceGiftRequest(body.ask ?? {})));
    }
    case '/kami/persona':
      return json(200, await door.ask(buildKamiPersonaRequest(String(body.seed ?? ''))));
    case '/npc/talk':
    case '/npc/bargain': {
      if (String(body.ask?.said ?? '').length > TALK_MESSAGE_LIMIT) return json(200, { status: 'REFUSED', reason: `That is more than one person can say at once: ${TALK_MESSAGE_LIMIT} characters.` });
      const build = path === '/npc/talk' ? buildNpcTalkRequest : buildBargainRequest;
      return json(200, await door.askTalk(String(body.talkId ?? 'talk'), build(body.ask ?? {})));
    }
    case '/npc/meet':
      return json(200, await door.askTalk(String(body.talkId ?? 'meet'), buildNpcMeetRequest(body.ask ?? {})));
    case '/npc/goal':
      return json(200, await door.askTalk(String(body.talkId ?? 'talk'), buildNpcGoalRequest(body.ask ?? {})));
    case '/rest/file':
      return json(200, await door.fileRest(String(body.id ?? 'rest'), buildRestRequest(body.queue ?? {}, body.theme ?? {})));
    case '/rest/collect':
      return json(200, await door.collectRest(String(body.batchId ?? '')));
    case '/window/file': {
      const build = WINDOW_REQUESTS[String(body.kind)];
      if (!build) return json(200, { status: 'REFUSED', reason: 'A window carries no such ask.' });
      return json(200, await door.fileWindow(String(body.id ?? 'window'), build(body.asks ?? [], body.theme ?? {}), Number(body.spent) || 0));
    }
    case '/window/collect':
      return json(200, await door.collectRest(String(body.batchId ?? '')));
    default:
      return json(404, { error: 'No such door.' });
  }
}

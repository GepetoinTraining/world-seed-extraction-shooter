/**
 * Which worlds this game plays live (LiveClient), and how each came to be one. Entering a marked
 * world joins its room; every other world is this browser's alone. Kept in this browser.
 *
 *   HUB      the world the hub hosts itself (ConnectWorld.tsx under a runner; the lobby on the domain)
 *   JOINED   a world a player opened, served to this game by the lobby (OpenWorlds.ts)
 *   MINE     a world of this game's own, opened to others
 *   CLOSING  one of this game's own, closed on the hub, whose shared part has not been written back here yet
 */
export type LiveMark = 'HUB' | 'JOINED' | 'MINE' | 'CLOSING';

const KEY = 'ws_live_worlds';
/** The list this file kept before a world could be a player's: each one was the hub's own. */
const OLD_KEY = 'ws_hosted_worlds';

const read = (): Record<string, LiveMark> => {
  if (typeof localStorage === 'undefined') return {};
  const marks: Record<string, LiveMark> = {};
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '[]');
    if (Array.isArray(old)) for (const uid of old) if (typeof uid === 'string') marks[uid] = 'HUB';
  } catch { /* an unreadable old list marks nothing */ }
  try {
    const now = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (now && typeof now === 'object') for (const [uid, mark] of Object.entries(now)) if (mark === 'HUB' || mark === 'JOINED' || mark === 'MINE' || mark === 'CLOSING') marks[uid] = mark;
  } catch { /* an unreadable list marks nothing */ }
  return marks;
};

const write = (marks: Record<string, LiveMark>) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(marks));
    localStorage.removeItem(OLD_KEY);
  } catch { /* a browser that keeps nothing asks the lobby again next time */ }
};

export const HostedLink = {
  remember(worldUid: string, mark: LiveMark = 'HUB') {
    const marks = read();
    if (marks[worldUid] === mark) return;
    write({ ...marks, [worldUid]: mark });
  },
  forget(worldUid: string) {
    const { [worldUid]: gone, ...rest } = read();
    if (gone !== undefined) write(rest);
  },
  markOf: (worldUid: string | null | undefined): LiveMark | null => (worldUid ? read()[worldUid] ?? null : null),
  /** Entering it joins its room. A world being closed is this game's own again. */
  is: (worldUid: string | null | undefined): boolean => {
    const mark = worldUid ? read()[worldUid] : undefined;
    return mark === 'HUB' || mark === 'JOINED' || mark === 'MINE';
  },
  marked: (mark: LiveMark): string[] => Object.entries(read()).filter(([, m]) => m === mark).map(([uid]) => uid)
};

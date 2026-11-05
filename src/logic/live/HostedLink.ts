/**
 * Which world this game connected to as our hosted world (ConnectWorld.tsx). Entering it joins it
 * live (LiveClient); every other world is this browser's alone. Kept in this browser, since only
 * this browser connected it.
 */
const KEY = 'ws_hosted_worlds';

const read = (): string[] => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x: unknown) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export const HostedLink = {
  remember(worldUid: string) {
    if (typeof localStorage === 'undefined') return;
    const list = read();
    if (!list.includes(worldUid)) localStorage.setItem(KEY, JSON.stringify([...list, worldUid]));
  },
  is: (worldUid: string | null | undefined): boolean => !!worldUid && read().includes(worldUid)
};

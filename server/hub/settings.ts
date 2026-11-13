/**
 * THE HUB'S SETTINGS, AND WHERE A HOST ALREADY KEEPS THEM (Pedro, 2026-11-13: "we need to set up how
 * to work these out right?"). Every setting the hub reads, by its own name, with what it is for. Some
 * of them a host writes by itself under names of its own, the moment a database is connected or a
 * project is deployed; the hub reads those when its own name is not set, and its own name always wins.
 *
 * Read on the providers' own pages (PLAYTEST_LEDGER.md, the HD rows say which and when):
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN     Turso's integration on Vercel: the database connected to the project.
 *                                            The store, when no Postgres is named (Pedro, 2026-11-13: "Yes, Turso only")
 *   DATABASE_URL, DATABASE_URL_UNPOOLED      a Postgres the host connected (Neon's integration writes these): the
 *                                            pooled address and the direct one. Read before Turso's, as a store named
 *   VERCEL_PROJECT_PRODUCTION_URL            Vercel itself: the production domain, without its scheme, set even
 *                                            in a preview; the shortest custom domain once there is one
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY        Clerk's integration on Vercel (beside CLERK_SECRET_KEY, the hub's own name)
 *
 * NEVER A VALUE. Which name a setting was read from is said in the log (`settingsLine`), and what is
 * missing is said by name. A setting marked `secret` is also hidden wherever a developers' view would
 * otherwise show it inside a row (dev.ts).
 */

export interface IHostName {
  /** The name a host writes. */
  name: string;
  /** Who writes it. */
  by: string;
  /** How the host's value becomes the hub's. */
  read?: (value: string) => string;
  /** Read only beside these: a direct address belongs to the store it came with. */
  when?: (env: NodeJS.ProcessEnv, fromOf: (name: string) => string | null) => boolean;
}

export interface ISetting {
  name: string;
  /** What it is for, in a few words. */
  what: string;
  /** Without it this hub checks nothing; the sentence that says so. */
  needed?: string;
  /** Names a host writes for the same thing, read in this order when the hub's own is not set. */
  host?: IHostName[];
  /** Its value is a key, a token, a password or an address that carries one. */
  secret?: boolean;
  /** What is said of the host's names when this one is missing, in place of the list of them. */
  lackSays?: string;
}

export const HUB_SETTINGS: readonly ISetting[] = [
  {
    name: 'WS_HUB_DATABASE_URL', what: 'the store: a database address (libsql:// or https://, or postgres://)', secret: true,
    needed: 'this hub has no store to check against.',
    // A Postgres named is the store; with none, the database TURSO_DATABASE_URL names is (HT6). No provider is
    // said as the one expected (Pedro, 2026-11-13: "not neon, I'm not going to dabble in neon")
    host: [
      { name: 'DATABASE_URL', by: 'a database the host connected to the project (postgres://)' },
      { name: 'TURSO_DATABASE_URL', by: 'a database the host connected to the project (libsql://)' }
    ],
    lackSays: ', nor DATABASE_URL, nor TURSO_DATABASE_URL with TURSO_AUTH_TOKEN, the names a host writes when a database is connected to the project'
  },
  { name: 'WS_HUB_KEY', what: 'the hub\'s signing key, PKCS#8 PEM', secret: true, needed: 'this hub has no key to sign with. `npm run hub:key` makes one in your own terminal.' },
  {
    name: 'WS_PUBLIC_URL', what: 'the hub\'s own address, inside everything it signs',
    needed: 'this hub does not know its own address.',
    host: [{ name: 'VERCEL_PROJECT_PRODUCTION_URL', by: 'the host itself', read: v => `https://${v.replace(/^https?:\/\//, '')}` }]
  },
  {
    name: 'WS_LIVE_LISTEN_URL', what: 'a direct connection, for the word between instances', secret: true,
    host: [{
      name: 'DATABASE_URL_UNPOOLED', by: 'the same database, its direct address',
      when: (env, fromOf) => fromOf('WS_HUB_DATABASE_URL') === 'DATABASE_URL' && !own(env, 'WS_LIVE_DATABASE_URL')
    }]
  },
  { name: 'WS_LIVE_DATABASE_URL', what: 'the hosted world\'s documents, when kept apart from the hub\'s', secret: true },
  { name: 'WS_RECORD', what: '1 keeps a Postgres store\'s record on Turso; a store on Turso is its own record' },
  { name: 'TURSO_DATABASE_URL', what: 'a database address (libsql://): the store\'s when no Postgres is named, else the record\'s', secret: true },
  { name: 'TURSO_AUTH_TOKEN', what: 'that database\'s token', secret: true },
  { name: 'TURSO_LIVE_DATABASE_URL', what: 'a record of its own for the world\'s documents kept apart', secret: true },
  { name: 'TURSO_LIVE_AUTH_TOKEN', what: 'its token', secret: true },
  { name: 'CRON_SECRET', what: 'what the host\'s scheduled call carries', secret: true },
  { name: 'CLERK_JWT_KEY', what: 'Clerk\'s public key; naming it makes this hub\'s accounts Clerk\'s' },
  {
    name: 'CLERK_PUBLISHABLE_KEY', what: 'what the site loads Clerk with, public by design',
    host: [{ name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', by: 'Clerk\'s integration' }]
  },
  { name: 'CLERK_SECRET_KEY', what: 'to delete an account at Clerk', secret: true },
  { name: 'CLERK_WEBHOOK_SECRET', what: 'to read Clerk\'s word that an account was deleted', secret: true },
  { name: 'CLERK_AUTHORIZED_PARTIES', what: 'the origins a Clerk token may come from' },
  { name: 'WS_DEV_ACCOUNTS', what: 'the accounts that may open the developers\' view, comma-separated' }
];

const SETTING = new Map(HUB_SETTINGS.map(s => [s.name, s]));

/** A name's own value, if it holds more than spaces. */
function own(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

interface IFound { value?: string; from: string | null }

function find(env: NodeJS.ProcessEnv): Map<string, IFound> {
  const found = new Map<string, IFound>();
  const fromOf = (name: string) => found.get(name)?.from ?? null;
  // In the list's order, so a host name's condition can ask about a setting above it
  for (const setting of HUB_SETTINGS) {
    const mine = own(env, setting.name);
    if (mine) { found.set(setting.name, { value: mine, from: setting.name }); continue; }
    const host = (setting.host ?? []).find(h => own(env, h.name) && (!h.when || h.when(env, fromOf)));
    found.set(setting.name, host ? { value: (host.read ?? (v => v))(own(env, host.name)!), from: host.name } : { from: null });
  }
  return found;
}

/** The environment with each of the hub's names filled from the host's, where its own is not set. */
export function withHostNames(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const [name, found] of find(env)) if (found.value !== undefined) out[name] = found.value;
  return out;
}

export interface ISettingRead {
  name: string;
  what: string;
  needed: boolean;
  set: boolean;
  /** The name it was read from: its own, a host's, or none. */
  from: string | null;
}

/** Every setting, by name, set or not and from where. Never a value. */
export function settingsRead(env: NodeJS.ProcessEnv): ISettingRead[] {
  const found = find(env);
  return HUB_SETTINGS.map(s => ({ name: s.name, what: s.what, needed: !!s.needed, set: found.get(s.name)!.from !== null, from: found.get(s.name)!.from }));
}

/** The function's log line: which name each setting was read from, and which are not set. */
export function settingsLine(env: NodeJS.ProcessEnv): string {
  const read = settingsRead(env);
  const set = read.filter(s => s.set).map(s => (s.from === s.name ? s.name : `${s.name} (from ${s.from})`));
  const unset = read.filter(s => !s.set).map(s => s.name);
  return `[HUB] Settings: ${set.length ? set.join(', ') : 'none'}.${unset.length ? ` Not set: ${unset.join(', ')}.` : ''}`;
}

/** The sentence for a needed setting that is not set: its name, where a host would have written it, and why it matters. */
export function lacking(name: string): string {
  const s = SETTING.get(name)!;
  const host = s.lackSays ?? (s.host?.length ? `, nor ${s.host.map(h => h.name).join(' or ')}, which ${s.host[0].by} writes` : '');
  return `${name} is not set${host}: ${s.needed ?? `${s.what}.`}`;
}

/** The publishable key, by the hub's own name or the one Clerk's integration writes. Public by design. */
export const publishableKeyOf = (env: NodeJS.ProcessEnv): string | undefined => withHostNames(env).CLERK_PUBLISHABLE_KEY?.trim() || undefined;

/**
 * Every text a secret setting holds, as it might appear anywhere: whole, its password if it is an
 * address that carries one, and a PEM's body without its line ends. A developers' view hides each
 * wherever it finds it (dev.ts). Short values are left out: they would hide ordinary words.
 */
export function secretTexts(env: NodeJS.ProcessEnv): string[] {
  const resolved = withHostNames(env);
  const names = new Set<string>();
  for (const s of HUB_SETTINGS) {
    if (!s.secret) continue;
    names.add(s.name);
    for (const h of s.host ?? []) names.add(h.name);
  }
  const out = new Set<string>();
  for (const name of names) {
    for (const value of [env[name], resolved[name]]) {
      const text = value?.trim();
      if (!text) continue;
      out.add(text);
      out.add(text.replace(/\\n/g, '\n'));
      try {
        const url = new URL(text);
        if (url.password) out.add(decodeURIComponent(url.password));
      } catch { /* not an address */ }
      const body = text.replace(/\\n/g, '\n').match(/-----BEGIN [^-]+-----([\s\S]+?)-----END/);
      if (body) {
        const flat = body[1].replace(/\s+/g, '');
        out.add(flat);
        for (const line of body[1].split('\n').map(l => l.trim())) out.add(line);
      }
    }
  }
  return [...out].filter(t => t.length >= 8).sort((a, b) => b.length - a.length);
}

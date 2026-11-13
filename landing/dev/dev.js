// The developers' page's only script (server/hub/dev.ts has the routes it reads). The routes answer
// only an account on the list the host holds; to anyone else they are addresses that do not exist.
// So this page asks them first, and when they do not answer, it asks who is signed in and shows that
// person their own account key, which is what goes on the list.
//
// Nothing is written into the page as markup: every word is text, every row's content a text node.
// A state is said with a shape and a word (the stylesheet's marks), never by color alone.
(function () {
  const $ = id => document.getElementById(id);
  const HUB = '/api/hub';

  // --- making the page out of text --------------------------------------------------------------

  const el = (tag, props, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'className') e.className = v;
      else if (k === 'data') for (const [d, dv] of Object.entries(v)) e.dataset[d] = dv;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) e.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
    return e;
  };
  // ok: a filled square; note: a diamond; none: a hollow square; warn: a triangle; busy: a broken line
  const mark = shape => el('span', { className: 'mark', data: { mark: shape }, 'aria-hidden': 'true' });
  const say = (target, shape, ...parts) => { target.textContent = ''; target.append(mark(shape), ...parts); };
  const code = text => el('code', {}, text);
  const when = at => (at ? `${new Date(at).toISOString().replace('T', ' ').slice(0, 19)} UTC` : 'never');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

  const ask = async path => {
    try {
      const res = await fetch(HUB + path, { cache: 'no-store', credentials: 'same-origin' });
      const out = await res.json().catch(() => ({}));
      return { status: res.status, ...out };
    } catch {
      return { ok: false, status: 0, reason: 'This hub cannot be reached right now.' };
    }
  };
  const query = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString();

  // --- who is asking ----------------------------------------------------------------------------

  async function start() {
    const state = await ask('/dev/state');
    if (state.status === 200 && state.ok) return show(state);
    // The routes do not answer this account: say why, from what the page itself may ask
    const session = await ask('/session');
    if (!session.ok || !session.account) {
      return say($('who-said'), 'warn', 'Nobody is signed in here. ', el('a', { href: '/' }, 'Sign in on the first page'), ', then come back.');
    }
    say($('who-said'), 'none', `Signed in as ${session.account.handle}, an account not on this hub's list of developers.`);
    $('key-text').textContent = session.account.key;
    $('who-key').hidden = false;
  }

  // --- the state of things ----------------------------------------------------------------------

  function show(state) {
    const { you, hub } = state;
    say($('who-said'), 'ok', `Signed in as ${you.handle} (${you.key}), on the list. This hub is ${hub.id}, at ${hub.url}; its accounts are ${hub.accounts === 'clerk' ? 'Clerk\'s' : 'its own'}. Read at ${when(state.at)}.`);
    $('dev-body').hidden = false;

    const settings = $('settings-list');
    settings.textContent = '';
    for (const s of state.settings) {
      const shape = s.set ? 'ok' : s.needed ? 'warn' : 'none';
      const words = s.given ? `set, ${s.given}` : s.set ? (s.from === s.name ? 'set' : `set, read from ${s.from}`) : s.needed ? 'not set, and needed' : 'not set';
      settings.append(el('li', {}, mark(shape), el('span', {}, code(s.name), ` ${words}. `, el('span', { className: 'hint' }, s.what))));
    }

    const db = $('db-list');
    db.textContent = '';
    const line = (shape, ...parts) => { const li = el('li'); say(li, shape, ...parts); db.append(li); };
    const d = state.database;
    if (!d.answers) line('warn', `The database does not answer: ${d.problem}`);
    else {
      const m = d.migrations || {};
      const whole = m.applied !== null && m.applied === m.known;
      line(whole ? 'ok' : 'warn', `The database answers (${d.dialect}). ${m.applied ?? '?'} of ${m.known} migrations applied${m.newest ? `, the newest ${m.newest}` : ''}.`);
    }
    const r = state.record || {};
    if (r.asked) {
      line(r.state === 'READY' ? 'ok' : 'warn', `The record: ${r.state}. ${plural(r.behind ?? 0, 'change')} not yet on the record. Last write-down read back whole: ${r.last || 'none yet'}.`, r.says ? ` It says: ${r.says}` : '');
    } else {
      line('none', `No record is kept here (WS_RECORD is not 1).${r.marked !== undefined ? ` ${plural(r.marked, 'change')} marked for one.` : ''}`);
    }
    if (state.scheduled) line(state.scheduled.lastRun ? 'note' : 'none', state.scheduled.lastRun ? `The scheduled call last came at ${when(state.scheduled.lastRun)}.` : 'The scheduled call has not come yet.');
    if (state.erasures) line(state.erasures.waiting ? 'warn' : 'ok', state.erasures.waiting ? `${plural(state.erasures.waiting, 'erasure')} still waiting on the record, the oldest from ${when(state.erasures.oldest)}.` : 'No erasure is waiting.');

    const counts = $('counts');
    counts.textContent = '';
    counts.append(el('thead', {}, el('tr', {}, el('th', {}, 'What'), el('th', {}, 'How many'), el('th', {}, 'The latest'))));
    const body = el('tbody');
    for (const [name, c] of Object.entries(state.counts || {})) {
      const words = name.replace(/([A-Z])/g, ' $1').toLowerCase();
      // Which table the latest is in is the store's word, never this page's
      const latest = c.latest ? opener(c.latest.table, c.latest.id, `${c.latest.id}, ${when(c.latest.at)}`) : 'none';
      body.append(el('tr', {}, el('td', {}, words), el('td', {}, String(c.count)), el('td', {}, latest)));
    }
    counts.append(body);
    return tables();
  }

  // --- the data itself --------------------------------------------------------------------------

  let showing = null;

  async function tables() {
    const out = await ask('/dev/tables');
    const list = $('table-list');
    list.textContent = '';
    if (!out.ok) return say(list, 'warn', out.reason || `The hub answered ${out.status}.`);
    const group = (title, items) => {
      list.append(el('h3', { className: 'dev-sub' }, title));
      const ul = el('ul', { className: 'dev-list' });
      for (const item of items) ul.append(el('li', {}, item));
      list.append(ul);
    };
    const pick = (label, params) => el('button', { type: 'button', on: { click: () => rows({ ...params, page: 0 }) } }, label);
    // Every table named here, and asked for when one is picked, is a name the store gave
    group('Tables', out.tables.map(t => pick(`${t.name}: ${plural(t.rows, 'row')}`, { table: t.name })));
    group('Collections of documents, by namespace and kind', out.collections.map(c => pick(`${c.namespace} · ${c.type ?? '(no type)'}: ${plural(c.rows, 'row')}`, { table: c.table, namespace: c.namespace, type: c.type })));
    if (out.ledger.length) group('Ledger rows, by kind', out.ledger.map(l => pick(`${l.type}: ${plural(l.rows, 'row')}`, { table: l.table, type: l.type })));
  }

  async function rows(params) {
    showing = params;
    const said = $('rows-said');
    say(said, 'busy', 'Reading…');
    const out = await ask(`/dev/rows?${query(params)}`);
    const table = $('rows-table');
    table.textContent = '';
    if (!out.ok) { $('newer').disabled = true; $('older').disabled = true; return say(said, 'warn', out.reason || `The hub answered ${out.status}.`); }
    const what = [params.table, params.namespace, params.type].filter(Boolean).join(' · ');
    const first = out.page * out.size;
    say(said, 'note', out.rows.length ? `${what}: rows ${first + 1} to ${first + out.rows.length} of ${out.total}, newest first.` : `${what}: no rows here.`);
    $('newer').disabled = out.page === 0;
    $('older').disabled = first + out.rows.length >= out.total;
    if (!out.rows.length) return;
    const columns = Object.keys(out.rows[0]);
    table.append(el('thead', {}, el('tr', {}, ...columns.map(c => el('th', {}, c)))));
    const body = el('tbody');
    for (const row of out.rows) {
      const id = row.id ?? row.key;
      body.append(el('tr', {}, ...columns.map(c => el('td', {}, (c === 'id' || c === 'key') && id !== undefined ? opener(out.table, id, String(id)) : cell(c, row[c])))));
    }
    table.append(body);
  }
  $('newer').addEventListener('click', () => showing && rows({ ...showing, page: Math.max(0, showing.page - 1) }));
  $('older').addEventListener('click', () => showing && rows({ ...showing, page: showing.page + 1 }));

  /** A list's cell: a moment as a date (the row opened whole keeps the number), nothing as a dash. */
  const MOMENT = /(At|_at|^at|^ts)$/;
  function cell(column, value) {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    if (MOMENT.test(column) && Number.isFinite(n) && n > 0) return when(n);
    return String(value);
  }

  /** A row's id that opens it whole; one kept under a hash only stands as text. */
  function opener(table, id, label) {
    if (/^hub_(session|nonce)_/.test(String(id))) return label;
    return el('button', { type: 'button', className: 'link', on: { click: () => open(table, id) } }, label);
  }

  async function open(table, id) {
    const said = $('row-said');
    say(said, 'busy', 'Reading…');
    const out = await ask(`/dev/row?${query({ table, id })}`);
    if (!out.ok) { $('row-text').textContent = ''; return say(said, 'warn', out.reason || `The hub answered ${out.status}.`); }
    say(said, 'note', `${table}: `, code(String(id)), '. What is hidden says so where it stood.');
    $('row-text').textContent = JSON.stringify(out.row, null, 2);
  }

  // --- found by an id ---------------------------------------------------------------------------

  const find = $('find-form');
  find.addEventListener('submit', async event => {
    event.preventDefault();
    const id = find.elements.namedItem('id').value.trim();
    const target = $('find-out');
    target.textContent = '';
    const said = el('p', { className: 'said', role: 'status' });
    target.append(said);
    say(said, 'busy', 'Looking…');
    const out = await ask(`/dev/find?${query({ id })}`);
    if (!out.ok) return say(said, 'warn', out.reason || `The hub answered ${out.status}.`);
    say(said, 'note', `For ${out.id}: ${plural(out.exact.length, 'document')} by that id exactly, ${plural(out.documents.length, 'document')} naming it, ${plural(out.ledger.rows, 'receipt')} held under it, and ${plural(out.ledger.mentionedIn, 'other receipt')} naming it.`);
    const list = (title, items) => {
      if (!items.length) return;
      target.append(el('h3', { className: 'dev-sub' }, title));
      target.append(el('ul', { className: 'dev-list dev-column' }, ...items.map(i => el('li', {}, i))));
    };
    list('By that id exactly', out.exact.map(e => opener(e.table, e.id, e.id)));
    list('Documents naming it, newest first', out.documents.map(d => el('span', {}, opener(d.table, d.id, d.id), ` ${d.type ?? d.namespace}, ${when(d.updatedAt)}`)));
    list('Its newest receipts', out.ledger.newest.map(r => el('span', {}, opener(r.table, r.id, r.id), ` ${r.type}, ${when(r.ts)}`)));
  });

  start();
})();

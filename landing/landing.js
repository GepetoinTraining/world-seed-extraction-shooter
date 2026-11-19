// The landing page's only script. It signs a person in to this hub, shows what the hub holds of
// them and lets them have it deleted. Nothing is kept in the browser by this page: the hub's session
// rides in a cookie this script cannot read, and it carries on into the game at /play/.
//
// A hub says who keeps its accounts (GET /api/hub/where). Where that is Clerk, an e-mail and a
// password are asked by Clerk's own form, loaded from Clerk's own address, and this page then asks
// the hub for its session once. Where the hub keeps its own, a handle and a password are asked here.
(function () {
  const $ = id => document.getElementById(id);
  const HUB = '/api/hub';

  // A state is said with a shape and a word. The shapes are the stylesheet's, one for each state,
  // so none is told from another by color.
  const SHAPES = { '[■]': 'ok', '[◆]': 'note', '[ ]': 'none', '[!]': 'warn', '[…]': 'busy' };
  const say = (el, mark, text) => {
    el.textContent = '';
    const m = document.createElement('span');
    m.className = 'mark';
    m.dataset.mark = SHAPES[mark] || 'note';
    m.setAttribute('aria-hidden', 'true');
    el.append(m, text);
  };
  const show = (el, on) => { el.hidden = !on; };

  const ask = async (path, body) => {
    try {
      const res = await fetch(HUB + path, body === undefined
        ? { cache: 'no-store', credentials: 'same-origin' }
        : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      return { status: res.status, ...out };
    } catch {
      return { ok: false, status: 0, reason: 'This hub cannot be reached right now.' };
    }
  };

  ask('/health').then(h => say($('hub-said'), h.ok ? '[■]' : '[!]', h.ok ? `This hub is ${h.hub.id}, at ${h.hub.url}.` : 'This hub did not answer as a hub.'));

  const accountSaid = $('account-said');
  /** That this browser has held a sign-in here. No name, no id: only that the account comes first next time. */
  const KNOWN = 'ws_hub_known';
  const knownHere = () => { try { return localStorage.getItem(KNOWN) === '1'; } catch { return false; } };
  let clerk = null;

  // What the page shows follows one thing: who the hub says is signed in.
  async function render() {
    const where = await ask('/where');
    const signedIn = where.signedIn || null;
    show($('signed-in'), !!signedIn);
    show($('play-go'), !!signedIn);
    show($('play-wait'), !signedIn);
    show($('yours-section'), !!signedIn);
    show($('clerk-forms'), !signedIn && where.accounts === 'clerk');
    show($('builtin-forms'), !signedIn && where.accounts !== 'clerk');
    show($('clerk-stuck'), false);
    // This browser has been signed in here before: the next visit opens on signing in, never on making an account
    if (signedIn) { try { localStorage.setItem(KNOWN, '1'); } catch { /* a private window keeps nothing */ } }
    // A hub that answers the model's asks itself (`voice`) says so; one that does not says the voice is the player's own
    for (const el of document.querySelectorAll('[data-voice]')) show(el, el.dataset.voice === (where.voice ? 'hub' : 'own'));
    if (signedIn) {
      say(accountSaid, '[■]', `Signed in as ${signedIn}.`);
      await held();
    } else if (where.configured) {
      say(accountSaid, '[◆]', 'Nobody is signed in.');
    } else {
      say(accountSaid, '[!]', where.reason || 'This hub cannot be reached right now.');
    }
    return where;
  }

  async function held() {
    const out = await ask('/account');
    const list = $('held-list');
    list.textContent = '';
    if (!out.ok) return;
    const line = text => { const li = document.createElement('li'); say(li, '[◆]', text); list.append(li); };
    line(`The account ${out.account.handle}.`);
    if (out.characters.length === 0) line('No characters yet.');
    for (const c of out.characters) line(`${c.displayName || 'A character'}: ${c.receipts} receipt${c.receipts === 1 ? '' : 's'} held${c.standing === 'CHALLENGED' ? ', its standing challenged' : ''}.`);
    if (out.people > 0) line(`${out.people} of your cities' people.`);
    if (out.worlds > 0) line(`${out.worlds} world${out.worlds === 1 ? '' : 's'} you had checked.`);
  }

  // ---------------------------------------------------------------------------------------------
  // Clerk: an e-mail and a password, asked by Clerk's own form
  // ---------------------------------------------------------------------------------------------

  const script = (src, attrs) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('That script did not load.'));
    document.head.append(el);
  });

  async function loadClerk(publishableKey) {
    // A publishable key is its instance's own address, encoded
    const host = atob(publishableKey.replace(/^pk_(test|live)_/, '')).replace(/\$$/, '');
    await script(`https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await script(`https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': publishableKey });
    // No usage telemetry: this page's policy lets nothing out to it anyway, and asking not to try keeps the console clean
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, telemetry: false });
    return window.Clerk;
  }

  // The hub's own session, for someone Clerk has signed in: asked once, and kept in the hub's cookie
  let exchanging = null;
  function exchange() {
    exchanging = exchanging || (async () => {
      try {
        const token = await clerk.session.getToken();
        const out = await ask('/sessions/clerk', { token });
        if (!out.ok) {
          // Signed in with the e-mail, and this hub did not take it. The account exists, so the page says what
          // happened and offers to try again or sign out; it never offers to make the account a second time
          show($('clerk-forms'), false);
          show($('clerk-stuck'), true);
          say(accountSaid, '[!]', `You are signed in with your e-mail, and this hub could not take that sign-in. ${out.reason || `It answered ${out.status}.`}`);
        } else {
          await render();
        }
      } finally {
        exchanging = null;
      }
    })();
    return exchanging;
  }

  async function withClerk(where) {
    const mount = $('clerk-mount');
    try {
      clerk = await loadClerk(where.clerk.publishableKey);
    } catch (e) {
      return say(accountSaid, '[!]', 'The sign-in form could not be loaded. Check the connection and reload.');
    }
    const form = which => {
      clerk.unmountSignUp(mount);
      clerk.unmountSignIn(mount);
      // Clerk's own form, in the machine's colors and corners. A name it does not know is passed over.
      const variables = {
        colorPrimary: '#20de81', colorBackground: '#0a0a0a', colorText: '#f2f2ee', colorForeground: '#f2f2ee', colorTextSecondary: '#9b9ba4', colorMutedForeground: '#9b9ba4',
        colorInputBackground: '#050505', colorInput: '#050505', colorInputText: '#f2f2ee', colorInputForeground: '#f2f2ee', colorNeutral: '#d6d6cf', colorDanger: '#ef4444',
        borderRadius: '0px', fontFamily: 'inherit'
      };
      const options = { fallbackRedirectUrl: location.pathname, signInFallbackRedirectUrl: location.pathname, signUpFallbackRedirectUrl: location.pathname, appearance: { variables } };
      if (which === 'sign-up') clerk.mountSignUp(mount, options);
      else clerk.mountSignIn(mount, options);
    };
    $('show-sign-up').addEventListener('click', () => form('sign-up'));
    $('show-sign-in').addEventListener('click', () => form('sign-in'));
    $('clerk-retry').addEventListener('click', () => { say(accountSaid, '[…]', 'Asking this hub again…'); void exchange(); });
    $('clerk-out').addEventListener('click', async () => { await clerk.signOut().catch(() => undefined); location.reload(); });
    // Signed in at Clerk, here or in another tab: the hub's session follows
    clerk.addListener(({ user }) => { if (user && !where.signedIn) void exchange(); });
    if (clerk.isSignedIn && !where.signedIn) await exchange();
    // The account comes first: a browser that has been signed in here opens on signing in; a new one, on making an account
    else if (!clerk.isSignedIn) form(knownHere() ? 'sign-in' : 'sign-up');
  }

  // ---------------------------------------------------------------------------------------------
  // A hub that keeps its own accounts
  // ---------------------------------------------------------------------------------------------

  const builtin = $('account-form');
  builtin.addEventListener('submit', async event => {
    event.preventDefault();
    const make = event.submitter && event.submitter.value === 'make';
    const handle = builtin.handle.value.trim();
    const password = builtin.password.value;
    if (make && password !== builtin.again.value) return say(accountSaid, '[!]', 'The two passwords differ.');
    const buttons = builtin.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    say(accountSaid, '[…]', make ? 'Making the account…' : 'Signing in…');
    try {
      if (make) {
        const made = await ask('/accounts', { handle, password });
        if (!made.ok) return say(accountSaid, '[!]', made.reason || `The hub answered ${made.status}.`);
      }
      const out = await ask('/sessions', { handle, password, keep: 'cookie' });
      builtin.password.value = '';
      builtin.again.value = '';
      if (!out.ok) return say(accountSaid, '[!]', out.reason || `The hub answered ${out.status}.`);
      await render();
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Signed in: the way out, and everything deleted
  // ---------------------------------------------------------------------------------------------

  $('sign-out').addEventListener('click', async () => {
    await ask('/session/end', {});
    if (clerk) await clerk.signOut().catch(() => undefined);
    await render();
    if (clerk) location.reload();
  });

  const del = $('delete-form');
  const delSaid = $('delete-said');
  del.addEventListener('submit', async event => {
    event.preventDefault();
    const button = del.querySelector('button');
    button.disabled = true;
    say(delSaid, '[…]', 'Deleting…');
    try {
      const out = await ask('/account/delete', { confirm: del.confirm.value.trim() });
      if (!out.ok) return say(delSaid, '[!]', out.reason || `The hub answered ${out.status}.`);
      del.confirm.value = '';
      if (clerk) await clerk.signOut().catch(() => undefined);
      await render();
      const e = out.erased || {};
      say(accountSaid, out.reason ? '[!]' : '[■]', out.reason
        || `Deleted: the account, ${e.characters || 0} character${e.characters === 1 ? '' : 's'} and ${e.rows || 0} receipt${e.rows === 1 ? '' : 's'}. Nothing of it is on this hub.`);
    } finally {
      button.disabled = false;
    }
  });

  render().then(where => { if (where.accounts === 'clerk' && where.clerk) return withClerk(where); });
})();

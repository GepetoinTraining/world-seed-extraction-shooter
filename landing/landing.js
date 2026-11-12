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

  const say = (el, mark, text) => {
    el.textContent = '';
    const m = document.createElement('span');
    m.className = 'mark';
    m.setAttribute('aria-hidden', 'true');
    m.textContent = mark;
    el.append(m, ' ', text);
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
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    return window.Clerk;
  }

  // The hub's own session, for someone Clerk has signed in: asked once, and kept in the hub's cookie
  let exchanging = null;
  function exchange() {
    exchanging = exchanging || (async () => {
      try {
        const token = await clerk.session.getToken();
        const out = await ask('/sessions/clerk', { token });
        if (!out.ok) say(accountSaid, '[!]', out.reason || `The hub answered ${out.status}.`);
        else await render();
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
      const options = { fallbackRedirectUrl: location.pathname, signInFallbackRedirectUrl: location.pathname, signUpFallbackRedirectUrl: location.pathname };
      if (which === 'sign-up') clerk.mountSignUp(mount, options);
      else clerk.mountSignIn(mount, options);
    };
    $('show-sign-up').addEventListener('click', () => form('sign-up'));
    $('show-sign-in').addEventListener('click', () => form('sign-in'));
    // Signed in at Clerk, here or in another tab: the hub's session follows
    clerk.addListener(({ user }) => { if (user && !where.signedIn) void exchange(); });
    if (clerk.isSignedIn && !where.signedIn) await exchange();
    else if (!clerk.isSignedIn) form('sign-up');
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

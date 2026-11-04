// The landing page's only script: it makes an account on this hub and says which hub this is.
// Nothing is kept in the browser: no token, no password. Signing in happens in the game.
(function () {
  const $ = id => document.getElementById(id);

  const say = (el, mark, text) => {
    el.textContent = '';
    const m = document.createElement('span');
    m.className = 'mark';
    m.setAttribute('aria-hidden', 'true');
    m.textContent = mark;
    el.append(m, ' ', text);
  };


  fetch('/api/hub/health', { cache: 'no-store' })
    .then(r => r.json())
    .then(h => say($('hub-said'), h && h.ok ? '[■]' : '[!]', h && h.ok ? `This hub is ${h.hub.id}, at ${h.hub.url}.` : 'This hub did not answer as a hub.'))
    .catch(() => say($('hub-said'), '[!]', 'This hub cannot be reached right now.'));

  const form = $('account-form');
  const said = $('account-said');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const handle = form.handle.value.trim();
    const password = form.password.value;
    if (password !== form.again.value) return say(said, '[!]', 'The two passwords differ.');
    const button = form.querySelector('button');
    button.disabled = true;
    say(said, '[…]', 'Making the account…');
    try {
      const res = await fetch('/api/hub/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, password }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        form.password.value = '';
        form.again.value = '';
        say(said, '[■]', `The account ${out.account.handle} is made. Sign in with it from inside the game, under SYSTEM, THE HUB.`);
      } else {
        say(said, '[!]', out.reason || `The hub answered ${res.status}.`);
      }
    } catch {
      say(said, '[!]', 'This hub cannot be reached right now.');
    } finally {
      button.disabled = false;
    }
  });
})();

// Login page behavior. Externalized from login.html so a strict
// Content-Security-Policy (script-src 'self', no unsafe-inline) can be enforced.
(function () {
  function $(s) { return document.querySelector(s); }

  function ensureIcon() {
    if (typeof window.icon !== 'function') return setTimeout(ensureIcon, 30);
    $('#login-logo').innerHTML = window.icon('layers', { size: 22 });
    $('#toggle-vis').innerHTML = window.icon('eye', { size: 16 });
  }
  ensureIcon();

  const cb = $('#trust-cb'), inp = $('#trusted');
  cb.addEventListener('click', () => { inp.checked = !inp.checked; cb.classList.toggle('checked', inp.checked); });

  $('#toggle-vis').addEventListener('click', () => {
    const p = $('#password');
    p.type = p.type === 'password' ? 'text' : 'password';
    $('#toggle-vis').innerHTML = window.icon(p.type === 'password' ? 'eye' : 'eye-off', { size: 16 });
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#password').value;
    const trusted = $('#trusted').checked;
    const btn = $('#submit'), lbl = $('#submit-label');
    btn.disabled = true; lbl.textContent = 'Signing in…';
    $('#err').textContent = '';
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, trusted }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Sign-in failed');
      // Redirect to where we came from, or home.
      const params = new URLSearchParams(location.search);
      location.href = params.get('next') || '/';
    } catch (err) {
      $('#err').textContent = err.message;
    } finally {
      btn.disabled = false; lbl.textContent = 'Sign in';
    }
  });
})();

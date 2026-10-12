// Shared by admin.html (postcards) and admin-users.html (users):
// sign-in, the saved session, toasts and small helpers.
let token = '';
let me = null; // { username, role }
let adminOptions = { roles: ['admin', 'edit'], onReady() {} };

const authHeaders = (extra = {}) => ({ ...extra, 'x-auth-token': 'Bearer ' + token });

function escText(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  setTimeout(() => el.className = '', 2800);
}

// ── LOGIN ──────────────────────────────────────
async function login() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('admin-key').value;
  if (!username || !password) return toast('Enter your username and password', 'error');
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (r.status === 403) return toast((await r.json()).error || 'Account disabled', 'error');
    if (!r.ok) return toast('Invalid username or password', 'error');
    const data = await r.json();
    token = data.token;
    me = { username: data.username, role: data.role };
    try { localStorage.setItem('session', JSON.stringify({ token, me })); } catch { /* storage blocked */ }
    // Setup-key sign-in: go straight to the page where accounts are created.
    if (data.bootstrap && !location.pathname.startsWith('/admin/users')) {
      location.href = '/admin/users';
      return;
    }
    showPanel();
    if (data.bootstrap) toast('Signed in with the setup key — create user accounts below', 'success');
  } catch {
    toast('Cannot reach API', 'error');
  }
}

function showPanel() {
  if (!adminOptions.roles.includes(me.role)) {
    toast('You do not have access to that page', 'error');
    setTimeout(() => { location.href = '/admin'; }, 1200);
    return;
  }
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('whoami').textContent = `${me.username} (${me.role})`;
  document.getElementById('logout-link').style.display = 'inline';
  document.getElementById('nav-users').style.display = me.role === 'admin' ? 'inline-block' : 'none';
  adminOptions.onReady();
}

function logout() {
  try { localStorage.removeItem('session'); } catch { /* storage blocked */ }
  location.reload();
}

// Session expired / revoked: return to the login screen.
function sessionExpired() {
  toast('Session expired — please sign in again', 'error');
  setTimeout(logout, 1200);
}

// Each page calls this once its own functions are defined.
function adminInit(options) {
  adminOptions = options;
  document.getElementById('admin-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });
  try {
    const saved = JSON.parse(localStorage.getItem('session') || 'null');
    if (saved && saved.token && saved.me) {
      token = saved.token;
      me = saved.me;
      showPanel();
    }
  } catch { /* ignore */ }
}

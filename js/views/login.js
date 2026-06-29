// =============================================================================
// views/login.js — Sign-in screen and access-request flow.
// =============================================================================

import { CONFIG } from '../config.js';
import { ORGS, ORG_ORDER } from '../constants.js';
import { users, upsertUser, newId, applyServerSnapshot } from '../storage.js';
import { verifyPassword, makeCredential } from '../crypto.js';
import { startSession, setServerUser } from '../state.js';
import { logAction } from '../audit.js';
import { DEMO_LOGINS } from '../seed.js';
import { esc, toast, openModal, closeModal } from '../ui.js';
import * as api from '../api.js';

function findByUsername(username) {
  const u = username.trim().toLowerCase();
  return users().find((x) => (x.username || '').toLowerCase() === u && !x.deleted) || null;
}

export function render(host, app) {
  const demoRows = DEMO_LOGINS.map((d) => `
    <button class="cred" data-user="${esc(d.username)}" data-pass="${esc(d.password)}">
      <span class="cred__name">${esc(d.username)}</span>
      <span class="cred__note">${esc(d.note)}</span>
    </button>
  `).join('');

  host.innerHTML = `
    <div class="auth">
      <div class="auth__panel">
        <div class="auth__brand">
          <div class="sigil" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="44" height="44">
              <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2"/>
              <circle cx="32" cy="32" r="6" fill="currentColor"/>
              <g stroke="currentColor" stroke-width="2" fill="none">
                <path d="M32 6 L32 20"/><path d="M53 44 L40 36"/><path d="M11 44 L24 36"/>
                <path d="M32 6 A26 26 0 0 1 53 44" opacity=".5"/>
                <path d="M53 44 A26 26 0 0 1 11 44" opacity=".5"/>
                <path d="M11 44 A26 26 0 0 1 32 6" opacity=".5"/>
              </g>
            </svg>
          </div>
          <div>
            <div class="auth__name">${esc(CONFIG.systemName)}</div>
            <div class="auth__sub">${esc(CONFIG.systemSubtitle)}</div>
          </div>
        </div>

        <p class="auth__notice">
          Restricted system. Access is logged. Credentials are personal and
          non-transferable.
        </p>

        <div class="field">
          <label for="login-user">Operator ID</label>
          <input id="login-user" type="text" autocomplete="username" spellcheck="false" placeholder="e.g. director" />
        </div>
        <div class="field">
          <label for="login-pass">Passphrase</label>
          <input id="login-pass" type="password" autocomplete="current-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" />
        </div>
        <div id="login-error" class="auth__error" hidden></div>

        <button id="login-submit" class="btn btn--primary btn--block">Authenticate</button>

        ${CONFIG.features.selfRegistration
          ? `<button id="login-register" class="auth__link">Request access \u2192</button>`
          : ''}
      </div>

      <aside class="auth__demo">
        <div class="auth__demo-head">Demonstration operators</div>
        <p class="auth__demo-hint">Tap to fill. Each tier sees the system differently.</p>
        <div class="cred-list">${demoRows}</div>
      </aside>
    </div>
  `;

  const userInput = host.querySelector('#login-user');
  const passInput = host.querySelector('#login-pass');
  const errorBox = host.querySelector('#login-error');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  async function attempt() {
    errorBox.hidden = true;
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!username || !password) {
      showError('Enter an operator ID and passphrase.');
      return;
    }

    // Server mode: the Worker authenticates and decides what this operator is
    // cleared to see. We then load that pre-filtered snapshot and hold the
    // record it returns. (A pending/disabled account gets the same generic
    // failure as bad credentials — the server does not reveal which.)
    if (api.serverMode()) {
      const submit = host.querySelector('#login-submit');
      submit.disabled = true;
      try {
        const me = await api.login(username, password);
        const snap = await api.fetchSnapshot();
        applyServerSnapshot(snap);
        setServerUser(me);
        app.refresh();
      } catch (e) {
        submit.disabled = false;
        if (e && e.status === 401) showError('Authentication failed. Check your credentials.');
        else showError('Could not reach the server. Please try again.');
      }
      return;
    }

    const user = findByUsername(username);
    if (!user) {
      showError('Authentication failed. Check your credentials.');
      return;
    }
    const ok = await verifyPassword(password, user.salt, user.passwordHash);
    if (!ok) {
      showError('Authentication failed. Check your credentials.');
      return;
    }
    if (user.accountStatus === 'pending') {
      showError('This request is awaiting Command approval.');
      return;
    }
    if (user.accountStatus === 'disabled') {
      showError('This account has been disabled. Contact Command.');
      return;
    }
    startSession(user.id);
    logAction(user, 'LOGIN', `${user.designation} signed in.`);
    app.refresh();
  }

  host.querySelector('#login-submit').addEventListener('click', attempt);
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passInput.focus(); });

  host.querySelectorAll('.cred').forEach((btn) => {
    btn.addEventListener('click', () => {
      userInput.value = btn.dataset.user;
      passInput.value = btn.dataset.pass;
      passInput.focus();
    });
  });

  const regBtn = host.querySelector('#login-register');
  if (regBtn) regBtn.addEventListener('click', () => openRegister(app));
}

// --- Access request (self-registration) -------------------------------------
function openRegister(app) {
  const orgOptions = ORG_ORDER
    .filter((o) => o !== 'command') // you don't self-register into Command
    .map((o) => `<option value="${o}">${esc(ORGS[o].name)}</option>`)
    .join('');

  const body = `
    <p class="modal__message">
      Submit a request for access. Command (CL5) reviews and assigns your
      clearance before the account is activated.
    </p>
    <div class="field"><label>Preferred codename</label><input id="reg-codename" type="text" placeholder="e.g. Sentinel" /></div>
    <div class="field"><label>Organisation</label><select id="reg-org">${orgOptions}</select></div>
    <div class="field"><label>Operator ID</label><input id="reg-username" type="text" placeholder="login name" spellcheck="false" /></div>
    <div class="field"><label>Passphrase</label><input id="reg-password" type="password" placeholder="choose a passphrase" /></div>
    <div id="reg-error" class="auth__error" hidden></div>
  `;

  const dialog = openModal({
    title: 'Request access',
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (close) => close() },
      {
        label: 'Submit request',
        tone: 'primary',
        onClick: async (close, dlg) => {
          const codename = dlg.querySelector('#reg-codename').value.trim();
          const org = dlg.querySelector('#reg-org').value;
          const username = dlg.querySelector('#reg-username').value.trim();
          const password = dlg.querySelector('#reg-password').value;
          const err = dlg.querySelector('#reg-error');
          err.hidden = true;

          if (!codename || !username || !password) {
            err.textContent = 'All fields are required.';
            err.hidden = false;
            return;
          }

          // Server mode: submit the request to the Worker, which creates the
          // pending account for Command to approve later. No local write.
          if (api.serverMode()) {
            try {
              await api.register({ codename, username, password, requestedOrg: org });
            } catch (e) {
              err.textContent = e && e.status === 409
                ? 'That operator ID is already in use.'
                : 'Could not submit your request. Please try again.';
              err.hidden = false;
              return;
            }
            close();
            toast('Request submitted. Command will review it shortly.', 'success');
            return;
          }

          const taken = users().some((u) => (u.username || '').toLowerCase() === username.toLowerCase());
          if (taken) {
            err.textContent = 'That operator ID is already in use.';
            err.hidden = false;
            return;
          }

          const { salt, hash } = await makeCredential(password);
          const now = new Date().toISOString();
          upsertUser({
            id: newId('usr'),
            designation: `PEND-${Math.floor(1000 + Math.random() * 8999)}`,
            codename,
            realName: '[REDACTED]',
            org,
            rank: null,
            clearance: null,
            status: 'active',
            username,
            salt,
            passwordHash: hash,
            accountStatus: 'pending',
            requestedOrg: org,
            awards: [], strikes: [], leave: null, notes: [],
            events: [{ id: newId('evt'), date: now, type: 'registration', text: `Access request submitted for ${ORGS[org].name}.` }],
            createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
          });
          logAction(null, 'REGISTRATION', `New access request: ${codename} \u2192 ${ORGS[org].short}.`);
          close();
          toast('Request submitted. Command will review it shortly.', 'success');
        },
      },
    ],
  });

  return dialog;
}

// =============================================================================
// views/login.js — Sign-in screen and access-request flow.
// =============================================================================

import { CONFIG } from '../config.js';
import { ORGS, ORG_ORDER, RANKS, clearanceForRank } from '../constants.js';
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
  // Demonstration operators are a LOCAL-DEMO affordance. Against a real backend
  // these are live accounts (the list includes a CL5), so a public sign-in page
  // must never advertise them — and even locally they stay folded away.
  const showDemo = !api.serverMode() && DEMO_LOGINS.length > 0;
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

      ${showDemo ? `<aside class="auth__demo">
        <details class="auth__demo-fold">
          <summary class="auth__demo-head">Demonstration operators</summary>
          <p class="auth__demo-hint">Local demo data only. Tap to fill — each tier sees the system differently.</p>
          <div class="cred-list">${demoRows}</div>
        </details>
      </aside>` : ''}
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
        // Surface the true cause in the console — a client-side error here would
        // otherwise masquerade as a network failure and be hard to diagnose.
        console.error('[login]', e);
        if (e && e.status === 401) showError('Authentication failed. Check your credentials.');
        else if (e && typeof e.status === 'number') showError('The server reported an error. Please try again.');
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
  // Internal Security is listed openly, but it isn't a fourth organisation — an
  // officer holds a cover post in Omega-1. Picking it requests that cover plus
  // the ISD caveat; Command activates the cover, ISD command inducts afterwards.
  const ISD_OPTION = '__isd';
  const coverOrgOf = (o) => (o === ISD_OPTION ? 'omega-1' : o);
  const orgOptions = ORG_ORDER
    .filter((o) => o !== 'command') // you don't self-register into Command
    .map((o) => `<option value="${o}">${esc(ORGS[o].name)}</option>`)
    .join('') + `<option value="${ISD_OPTION}">Internal Security Department</option>`;

  const firstOrg = ORG_ORDER.filter((o) => o !== 'command')[0];
  // The rank list follows the ladder you are actually applying to: an ISD
  // applicant seeks an ISD rank (Operative, Investigator, Inspector, …) — the
  // Omega-1 cover rank is Command's to assign, not theirs to request. Ethics
  // Committee intake is always at Assistant — Members and the Chairman are
  // appointed by promotion, not requested at registration.
  const ladderOrgOf = (o) => (o === ISD_OPTION ? 'isd' : o);
  const ranksForOrg = (o) => {
    const lo = ladderOrgOf(o);
    if (lo === 'ethics-committee') return ['Assistant'];
    if (lo === 'isd') return (RANKS.isd || []).slice().reverse(); // junior-first, like the induction form
    return RANKS[lo] || [];
  };
  const rankOptionsFor = (o) => ranksForOrg(o).map((r) => {
    const clr = clearanceForRank(ladderOrgOf(o), r);
    return `<option value="${esc(r)}">${esc(r)}${clr ? ` \u2014 ${esc(clr)}` : ''}</option>`;
  }).join('');

  const body = `
    <p class="modal__message">
      Submit a request for access. Command (CL5) reviews your requested rank and
      assigns your clearance before the account is activated.
    </p>
    <div class="field"><label>Preferred codename</label><input id="reg-codename" type="text" placeholder="e.g. Sentinel" /></div>
    <div class="field"><label>Organisation</label><select id="reg-org">${orgOptions}</select></div>
    <div class="field"><label>Rank sought</label><select id="reg-rank">${rankOptionsFor(firstOrg)}</select></div>
    <div class="field__hint">Your requested rank sets the clearance you're asking for. Command may adjust it on approval.</div>
    <div class="field__hint" id="reg-isd-hint" hidden>The rank above is on the Internal Security ladder. Officers also hold an unremarkable Omega-1 cover post, which Command assigns on approval; Internal Security command completes your induction and grants the caveat afterwards.</div>
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
          const orgChoice = dlg.querySelector('#reg-org').value;
          const rankChoice = dlg.querySelector('#reg-rank').value || null;
          const isISDPick = orgChoice === ISD_OPTION;
          // For ISD the rank sought is an ISD rank and rides in requestedISD;
          // the cover rank stays unrequested (Command assigns a modest cover).
          const requestedISD = isISDPick ? (rankChoice || true) : false;
          const org = coverOrgOf(orgChoice); // ISD lands on its Omega-1 cover post
          const requestedRank = isISDPick ? null : rankChoice;
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
              await api.register({ codename, username, password, requestedOrg: org, requestedRank, requestedISD });
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
            requestedRank,
            ...(requestedISD ? { requestedISD } : {}),
            awards: [], strikes: [], leave: null, notes: [],
            events: [{ id: newId('evt'), date: now, type: 'registration', text: `Access request submitted for ${requestedISD ? 'Internal Security Department (Omega-1 cover)' : ORGS[org].name}${typeof requestedISD === 'string' ? ` \u2014 ISD rank sought: ${requestedISD}` : (requestedRank ? ` \u2014 rank sought: ${requestedRank}` : '')}.` }],
            createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
          });
          logAction(null, 'REGISTRATION', `New access request: ${codename} \u2192 ${ORGS[org].short}.`);
          close();
          toast('Request submitted. Command will review it shortly.', 'success');
        },
      },
    ],
  });

  // Keep the rank-sought list in step with the chosen organisation, and reveal
  // the cover-post note when Internal Security is chosen.
  const regOrg = dialog.querySelector('#reg-org');
  const regRank = dialog.querySelector('#reg-rank');
  const isdHint = dialog.querySelector('#reg-isd-hint');
  if (regOrg && regRank) {
    regOrg.addEventListener('change', () => {
      regRank.innerHTML = rankOptionsFor(regOrg.value);
      if (isdHint) isdHint.hidden = regOrg.value !== ISD_OPTION;
    });
  }

  return dialog;
}

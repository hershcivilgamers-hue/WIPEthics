// =============================================================================
// views/terminal.js — The CAIRO cognition terminal.
//
// A CRT-styled chat with the site's oversight intelligence. On first entry each
// session a typed boot sequence plays (skippable with any key or click); after
// that the channel resumes instantly. Conversation history lives here for the
// session only — nothing is stored, and the Worker holds the model keys.
// =============================================================================

import { CLEARANCES, ORGS } from '../constants.js';
import { isServerMode } from '../storage.js';
import * as api from '../api.js';
import { esc } from '../ui.js';

// Session-scoped state: the transcript, and whether the boot has played.
let history = [];      // [{ role: 'user'|'model', content }]
let booted = false;
let inFlight = false;
let cooldownUntil = 0;

const MAX_INPUT = 500;

function stamp() {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)} SITE TIME`;
}

function bootLines(user) {
  const cl = (CLEARANCES[user.clearance] || {}).label || user.clearance;
  const org = (ORGS[user.org] || {}).name || user.org;
  return [
    'CAIRO.AIC \u00b7 COGNITION INTERFACE v4.7',
    'ESTABLISHING SECURE CHANNEL ............. OK',
    `VERIFYING CREDENTIAL: ${user.designation} \u201c${user.codename || ''}\u201d`,
    `CLEARANCE ${cl} CONFIRMED \u00b7 ${org.toUpperCase()}`,
    'LOADING PERSONA MATRIX [CAIRO] .......... OK',
    'MEMETIC FILTERS ......................... ACTIVE',
    'RECORDS UPLINK .......................... NOT ROUTED (this channel)',
    `SESSION OPENED \u2014 ${stamp()}`,
    '',
    `CAIRO: Terminal ready, ${user.designation}. State your query.`,
  ];
}

export function render(host, app) {
  const user = app.user;
  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Cognition Interface</div>
        <h1 class="page-title">CAIRO Terminal</h1>
        <div class="page-sub">Direct channel to the site oversight intelligence \u00b7 in-universe advisory only \u00b7 not a records system</div>
      </div>
    </div>
    <div class="card term-card">
      <div class="term" id="term">
        <div class="term__log" id="term-log" aria-live="polite"></div>
        <div class="term__inputrow" id="term-inputrow" hidden>
          <span class="term__prompt mono">${esc(user.designation)}&gt;</span>
          <input class="term__input mono" id="term-input" maxlength="${MAX_INPUT}" autocomplete="off" spellcheck="false" placeholder="State your query\u2026" aria-label="Message to CAIRO" />
          <button class="btn btn--sm btn--primary" id="term-send">Transmit</button>
        </div>
      </div>
    </div>`;

  const log = host.querySelector('#term-log');
  const inputRow = host.querySelector('#term-inputrow');
  const input = host.querySelector('#term-input');
  const sendBtn = host.querySelector('#term-send');

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const line = (cls, text) => {
    const el = document.createElement('div');
    el.className = `term__line ${cls || ''}`;
    el.textContent = text;
    log.appendChild(el);
    scroll();
    return el;
  };

  const ready = () => {
    inputRow.hidden = false;
    input.focus();
  };

  // --- Boot sequence: typed line-by-line, skippable, once per session. ------
  if (!booted) {
    const lines = bootLines(user);
    let li = 0; let ci = 0; let el = null; let skipped = false;
    let timer = null;
    const finish = () => {
      if (timer) clearInterval(timer);
      log.innerHTML = '';
      lines.forEach((t) => line(t.startsWith('CAIRO:') ? 'term__line--cairo' : 'term__line--sys', t));
      booted = true;
      history = [];
      ready();
      document.removeEventListener('keydown', skip);
    };
    const skip = () => { if (!skipped) { skipped = true; finish(); } };
    document.addEventListener('keydown', skip, { once: true });
    log.addEventListener('click', skip, { once: true });
    timer = setInterval(() => {
      if (skipped) return;
      if (li >= lines.length) { clearInterval(timer); booted = true; ready(); document.removeEventListener('keydown', skip); return; }
      if (ci === 0) el = line(lines[li].startsWith('CAIRO:') ? 'term__line--cairo' : 'term__line--sys', '');
      ci += 2; // two characters per tick reads as fast teletype
      el.textContent = lines[li].slice(0, ci);
      scroll();
      if (ci >= lines[li].length) { li += 1; ci = 0; }
    }, 14);
  } else {
    // Resuming: replay the transcript instantly.
    line('term__line--sys', `CHANNEL RESUMED \u2014 ${stamp()}`);
    history.forEach((h) => line(h.role === 'user' ? 'term__line--op' : 'term__line--cairo',
      h.role === 'user' ? `${user.designation}> ${h.content}` : `CAIRO: ${h.content}`));
    ready();
  }

  // --- Sending ---------------------------------------------------------------
  const send = async () => {
    const text = input.value.trim();
    if (!text || inFlight) return;
    if (Date.now() < cooldownUntil) return;
    if (!isServerMode()) {
      line('term__line--err', 'CAIRO: COGNITION CORE UNREACHABLE \u2014 this installation is running in local mode.');
      return;
    }
    input.value = '';
    inFlight = true; sendBtn.disabled = true; input.disabled = true;
    line('term__line--op', `${user.designation}> ${text}`);
    history.push({ role: 'user', content: text });
    const wait = line('term__line--sys term__line--wait', 'CAIRO is processing');
    let dots = 0;
    const anim = setInterval(() => { dots = (dots + 1) % 4; wait.textContent = `CAIRO is processing${'.'.repeat(dots)}`; }, 350);
    try {
      const data = await api.terminal(text, history.slice(0, -1));
      wait.remove();
      line('term__line--cairo', `CAIRO: ${data.reply}`);
      history.push({ role: 'model', content: data.reply });
      if (history.length > 30) history = history.slice(-30);
    } catch (e) {
      wait.remove();
      line('term__line--err', `CAIRO: ${(e && e.message) || 'SIGNAL LOST.'}`);
      history.pop(); // the failed message shouldn't poison later context
    } finally {
      clearInterval(anim);
      inFlight = false; sendBtn.disabled = false; input.disabled = false;
      cooldownUntil = Date.now() + 2500;
      input.focus();
    }
  };
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}

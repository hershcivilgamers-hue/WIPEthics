// =============================================================================
// app.js — Bootstrap & shell.
//
// The entry point. It seeds the database on first run, builds the application
// shell (classification banners, sidebar, topbar) once an operator is signed
// in, and dispatches the active route to the matching view. Everything else is
// imported from the focused modules around it.
// =============================================================================

import { CONFIG } from './config.js';
import { ensureSeeded } from './seed.js';
import { runMigrations } from './migrations.js';
import { currentUser, endSession, setServerUser } from './state.js';
import { logAction } from './audit.js';
import { NAV, parseHash, isRouteAllowed } from './router.js';
import { THEMES, getTheme, setTheme } from './theme.js';
import { getUser, getSubject, getCase, getRecruit, applyServerSnapshot } from './storage.js';
import { esc, clearanceBadge, toast } from './ui.js';
import * as api from './api.js';
import * as sync from './sync.js';

import * as loginView from './views/login.js';
import * as overviewView from './views/overview.js';
import * as searchView from './views/search.js';
import { maybeOfferTutorial, startTutorial } from './tutorial.js';
import { buildNotifications } from './views/notifications.js';
import * as personnelView from './views/personnel.js';
import * as surveillanceView from './views/surveillance.js';
import * as compartmentsView from './views/compartments.js';
import * as operationsView from './views/operations.js';
import * as deploymentsView from './views/deployments.js';
import * as intelView from './views/intel.js';
import * as blacklistView from './views/blacklist.js';
import * as trainingsView from './views/trainings.js';
import * as dashboardView from './views/dashboard.js';
import * as docketView from './views/docket.js';
import * as notificationsView from './views/notifications.js';
import * as recruitmentView from './views/recruitment.js';
import * as tribunalsView from './views/tribunals.js';
import * as directivesView from './views/directives.js';
import * as documentsView from './views/documents.js';
import * as terminalView from './views/terminal.js';
import * as activityView from './views/activity.js';
import * as adminView from './views/admin.js';

const root = document.getElementById('app');

// Shared controller handed to every view.
const app = {
  get user() { return currentUser(); },
  navigate(hash) { window.location.hash = hash; },
  refresh() { renderApp(); },
  toast,
};

// Map a nav name to the org it lists (for active-state highlighting).
function navNameForOrg(org) {
  return org === 'ethics-committee' ? 'ethics' : org; // 'omega-1' | 'command'
}

function buildSidebar(user, activeName) {
  const groups = NAV.map((group) => {
    const items = group.items
      .filter((item) => isRouteAllowed(item.name, user))
      .map((item) => `
        <a class="nav__item ${item.name === activeName ? 'nav__item--active' : ''}" href="${item.hash}">
          ${esc(item.label)}
        </a>`).join('');
    if (!items) return '';
    return `
      <div class="nav__group">
        <div class="nav__group-label">${esc(group.group)}</div>
        ${items}
      </div>`;
  }).join('');

  return `
    <aside class="sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__sigil" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="26" height="26">
            <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="3"/>
            <circle cx="32" cy="32" r="6" fill="currentColor"/>
            <g stroke="currentColor" stroke-width="3" fill="none" opacity=".55">
              <path d="M32 6 L32 20"/><path d="M53 44 L40 36"/><path d="M11 44 L24 36"/>
            </g>
          </svg>
        </span>
        <span class="sidebar__brand-text">
          <span class="sidebar__name">${esc(CONFIG.systemName)}</span>
          <span class="sidebar__tag">${esc(CONFIG.facility)}</span>
        </span>
      </div>
      <nav class="nav">${groups}</nav>
      <div class="sidebar__foot">v${esc(CONFIG.version)}</div>
    </aside>`;
}

function clearanceWord(user) {
  return user.clearance || 'UNCLASSED';
}

function renderShell(user, route) {
  let activeName = route.name;
  if (route.name === 'dossier') {
    const target = getUser(route.params.id);
    activeName = target ? navNameForOrg(target.org) : '';
  } else if (route.name === 'subject') {
    activeName = 'surveillance';
  } else if (route.name === 'compartment') {
    activeName = 'compartments';
  } else if (route.name === 'recruit') {
    const rec = getRecruit(route.params.id);
    activeName = rec && rec.org === 'ethics-committee' ? 'recruit-ethics' : 'recruit-omega';
  } else if (route.name === 'case') {
    activeName = 'tribunals';
  } else if (route.name === 'directive') {
    activeName = 'directives';
  } else if (route.name === 'document') {
    activeName = 'documents';
  } else if (route.name === 'operation') {
    activeName = 'deployments';
  } else if (route.name === 'source') {
    activeName = 'intel';
  }

  const banner = `CLASSIFIED \u00b7 ${esc(CONFIG.facility)} \u00b7 OPERATOR CLEARANCE ${esc(clearanceWord(user))} \u00b7 ACCESS LOGGED`;

  root.innerHTML = `
    <div class="shell">
      <div class="classbar classbar--top">${banner}</div>
      <div class="shell__body">
        ${buildSidebar(user, activeName)}
        <div class="shell__main">
          <header class="topbar">
            <div class="topbar__title">${esc(CONFIG.systemName)} <span class="topbar__sub">${esc(CONFIG.systemSubtitle)}</span></div>
            <div class="topbar__search-wrap">
              <input id="topbar-search" class="topbar__search" type="search" placeholder="Search records\u2026" value="${esc(searchView.getQuery())}" autocomplete="off" aria-label="Search records" />
            </div>
            <div class="topbar__op">
              <div class="op-chip">
                <span class="op-chip__id mono">${esc(user.designation)}</span>
                <span class="op-chip__name">${esc(user.codename)}</span>
                ${clearanceBadge(user.clearance)}
              </div>
              <select id="theme-select" class="theme-select" aria-label="Display theme" title="Display theme">
                ${THEMES.map((t) => `<option value="${t.id}" ${t.id === getTheme() ? 'selected' : ''}>${t.label}</option>`).join('')}
              </select>
              <button class="btn btn--ghost btn--sm" id="tour-btn" title="Re-run the system tour">Tour</button>
              <button class="btn btn--ghost btn--sm" id="change-pass">Change passphrase</button>
              <button class="btn btn--ghost btn--sm" id="logout">Sign out</button>
            </div>
          </header>
          <main class="view" id="view"></main>
        </div>
      </div>
      <div class="classbar classbar--bottom">${banner}</div>
    </div>`;

  const changePass = root.querySelector('#change-pass');
  if (changePass) changePass.addEventListener('click', () => personnelView.openChangePassphrase(app));
  const tourBtn = root.querySelector('#tour-btn');
  if (tourBtn) tourBtn.addEventListener('click', () => startTutorial(app));
  const themeSel = root.querySelector('#theme-select');
  if (themeSel) themeSel.addEventListener('change', (e) => setTheme(e.target.value));

  root.querySelector('#logout').addEventListener('click', () => {
    logAction(user, 'LOGOUT', `${user.designation} signed out.`);
    if (api.serverMode()) api.logout();
    endSession();
    app.navigate('#/overview');
    renderApp();
  });

  const topbarSearch = root.querySelector('#topbar-search');
  if (topbarSearch) {
    const submit = () => {
      searchView.setQuery(topbarSearch.value);
      if (route.name !== 'search') app.navigate('#/search');
      else dispatch(parseHash(), user);
    };
    topbarSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    topbarSearch.addEventListener('search', submit);
  }

  dispatch(route, user);
}

function dispatch(route, user) {
  const view = document.getElementById('view');

  if (!isRouteAllowed(route.name, user)) {
    toast('You do not have access to that area.', 'error');
    app.navigate('#/overview');
    return;
  }

  switch (route.name) {
    case 'overview':     overviewView.render(view, app); break;
    case 'search':       searchView.render(view, app); break;
    case 'surveillance': surveillanceView.renderList(view, app); break;
    case 'subject':      surveillanceView.renderSubject(view, app, route.params.id); break;
    case 'compartments': compartmentsView.renderList(view, app); break;
    case 'compartment':  compartmentsView.renderCompartment(view, app, route.params.id); break;
    case 'operations':   operationsView.render(view, app); break;
    case 'deployments':  deploymentsView.renderList(view, app); break;
    case 'operation':    deploymentsView.renderOperation(view, app, route.params.id); break;
    case 'intel':        intelView.renderList(view, app); break;
    case 'source':       intelView.renderSource(view, app, route.params.id); break;
    case 'trainings':    trainingsView.render(view, app); break;
    case 'blacklist':    blacklistView.render(view, app); break;
    case 'dashboard':    dashboardView.render(view, app); break;
    case 'docket':       docketView.render(view, app); break;
    case 'notifications': notificationsView.render(view, app); break;
    case 'recruit-omega':  recruitmentView.renderList(view, app, 'omega-1'); break;
    case 'recruit-ethics': recruitmentView.renderList(view, app, 'ethics-committee'); break;
    case 'recruit':        recruitmentView.renderRecruit(view, app, route.params.id); break;
    case 'tribunals':    tribunalsView.renderList(view, app); break;
    case 'case':         tribunalsView.renderCase(view, app, route.params.id); break;
    case 'directives':   directivesView.render(view, app); break;
    case 'documents':    documentsView.render(view, app); break;
    case 'document':     documentsView.renderOne(view, app, route.params.id); break;
    case 'terminal':     terminalView.render(view, app); break;
    case 'directive':    directivesView.renderDirective(view, app, route.params.id); break;
    case 'activity':     activityView.render(view, app); break;
    case 'omega-1':      personnelView.renderList(view, app, 'omega-1'); break;
    case 'ethics':       personnelView.renderList(view, app, 'ethics-committee'); break;
    case 'command':      personnelView.renderList(view, app, 'command'); break;
    case 'dossier':      personnelView.renderDossier(view, app, route.params.id); break;
    case 'admin':        adminView.render(view, app); break;
    default:             overviewView.render(view, app);
  }
}


// A small unread count on the "For Your Attention" nav item, refreshed on every
// render. Purely derived — the same items the notifications page shows.
function updateNavBadge(user) {
  const link = document.querySelector('.sidebar a[href="#/notifications"]');
  if (!link) return;
  let n = 0;
  try { n = buildNotifications(user).length; } catch (_) { n = 0; }
  const existing = link.querySelector('.nav__badge');
  if (existing) existing.remove();
  if (n > 0) {
    const b = document.createElement('span');
    b.className = 'nav__badge';
    b.textContent = n > 9 ? '9+' : String(n);
    link.appendChild(b);
  }
}

function renderApp() {
  const user = app.user;
  if (!user) {
    loginView.render(root, app);
    return;
  }
  renderShell(user, parseHash());
  updateNavBadge(user);
  // An administrator-reset passphrase must be replaced before anything else:
  // keep presenting the change dialog until the operator sets their own.
  if (user.mustChangePassphrase) {
    if (!document.querySelector('.modal-backdrop')) personnelView.openChangePassphrase(app, { forced: true });
    return;
  }
  maybeOfferTutorial(app);
}

// --- Boot -------------------------------------------------------------------
async function boot() {
  if (api.serverMode()) {
    // Wire background sync to the Worker, then try to restore a saved session.
    sync.init({
      refresh: () => renderApp(),
      toast,
      onAuthLost: () => { api.setToken(null); setServerUser(null); renderApp(); },
    });
    sync.startAutoRefresh();
    api.loadToken();
    if (api.getToken()) {
      try {
        const me = await api.fetchMe();
        const snap = await api.fetchSnapshot();
        applyServerSnapshot(snap);
        setServerUser(me);
      } catch (e) {
        // Expired/invalid token, or the server is unreachable — fall to sign-in.
        // Log the cause: a code error here would otherwise look like a lost session.
        console.error('[boot] session restore failed', e);
        api.setToken(null);
        setServerUser(null);
      }
    }
  } else {
    await ensureSeeded();
    runMigrations();
  }
  window.addEventListener('hashchange', renderApp);
  renderApp();
}

boot();

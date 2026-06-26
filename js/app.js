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
import { currentUser, endSession } from './state.js';
import { logAction } from './audit.js';
import { NAV, parseHash, isRouteAllowed } from './router.js';
import { getUser } from './storage.js';
import { esc, clearanceBadge, toast } from './ui.js';

import * as loginView from './views/login.js';
import * as overviewView from './views/overview.js';
import * as personnelView from './views/personnel.js';
import * as directivesView from './views/directives.js';
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
            <div class="topbar__op">
              <div class="op-chip">
                <span class="op-chip__id mono">${esc(user.designation)}</span>
                <span class="op-chip__name">${esc(user.codename)}</span>
                ${clearanceBadge(user.clearance)}
              </div>
              <button class="btn btn--ghost btn--sm" id="logout">Sign out</button>
            </div>
          </header>
          <main class="view" id="view"></main>
        </div>
      </div>
      <div class="classbar classbar--bottom">${banner}</div>
    </div>`;

  root.querySelector('#logout').addEventListener('click', () => {
    logAction(user, 'LOGOUT', `${user.designation} signed out.`);
    endSession();
    app.navigate('#/overview');
    renderApp();
  });

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
    case 'overview':   overviewView.render(view, app); break;
    case 'directives': directivesView.render(view, app); break;
    case 'activity':   activityView.render(view, app); break;
    case 'omega-1':    personnelView.renderList(view, app, 'omega-1'); break;
    case 'ethics':     personnelView.renderList(view, app, 'ethics-committee'); break;
    case 'command':    personnelView.renderList(view, app, 'command'); break;
    case 'dossier':    personnelView.renderDossier(view, app, route.params.id); break;
    case 'admin':      adminView.render(view, app); break;
    default:           overviewView.render(view, app);
  }
}

function renderApp() {
  const user = app.user;
  if (!user) {
    loginView.render(root, app);
    return;
  }
  renderShell(user, parseHash());
}

// --- Boot -------------------------------------------------------------------
async function boot() {
  await ensureSeeded();
  window.addEventListener('hashchange', renderApp);
  renderApp();
}

boot();

// =============================================================================
// api.js — Talks to the CAIRO.AIC Worker.
//
// This is the only file that makes network calls. It owns the session token,
// signs every request, and serializes writes so they reach the server in order.
// It knows nothing about the UI — callers (storage + sync) decide what to do
// with successes and the structured errors thrown here.
//
// When CONFIG.apiBaseUrl is null the whole module is dormant and the app runs
// on localStorage exactly as before.
// =============================================================================

import { CONFIG } from './config.js';

const TOKEN_KEY = 'cairo.aic.token';
let token = null;

// Read CONFIG dynamically so flipping apiBaseUrl (or tests) takes effect.
export function serverMode() { return !!CONFIG.apiBaseUrl; }
function base() { return (CONFIG.apiBaseUrl || '').replace(/\/+$/, ''); }

export function loadToken() {
  try { token = globalThis.sessionStorage?.getItem(TOKEN_KEY) || null; } catch (_) { token = null; }
  return token;
}
export function getToken() { return token; }
export function setToken(t) {
  token = t || null;
  try {
    if (token) globalThis.sessionStorage?.setItem(TOKEN_KEY, token);
    else globalThis.sessionStorage?.removeItem(TOKEN_KEY);
  } catch (_) { /* sessionStorage unavailable — keep the token in memory only */ }
}

async function request(method, path, body) {
  const res = await fetch(base() + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty/non-JSON body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status}).`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// --- auth & data ---
export async function login(username, password) {
  const data = await request('POST', '/api/login', { username, password });
  setToken(data.token);
  return data.user;
}
export async function logout() {
  try { await request('POST', '/api/logout'); } catch (_) { /* best effort */ }
  setToken(null);
}
export async function fetchMe() {
  const data = await request('GET', '/api/me');
  return data.user;
}
export async function fetchSnapshot() {
  return request('GET', '/api/data');
}
export async function register(payload) {
  return request('POST', '/api/register', payload);
}
// The CAIRO terminal: send one message plus recent history, get one reply.
export async function terminal(message, history) {
  return request('POST', '/api/terminal', { message, history });
}
export async function resetPassphrase(userId, passphrase) {
  return request('POST', `/api/users/${encodeURIComponent(userId)}/passphrase`, { passphrase });
}
export async function changeMyPassphrase(currentPassphrase, newPassphrase) {
  return request('POST', '/api/me/passphrase', { currentPassphrase, newPassphrase });
}
export async function signOutEverywhere() {
  await request('DELETE', '/api/me/sessions');
  setToken(null);
}

// --- writes (serialized) ---
let chain = Promise.resolve();
// Queue a write task so writes hit the server in the order they were made.
// The task owns its own error handling; the queue never rejects.
export function enqueue(task) {
  chain = chain.then(task, task).catch(() => {});
  return chain;
}
export function pushRecord(collection, record) {
  return request('PUT', `/api/${collection}/${encodeURIComponent(record.id)}`, record);
}
export function removeRecord(collection, id) {
  return request('DELETE', `/api/${collection}/${encodeURIComponent(id)}`);
}

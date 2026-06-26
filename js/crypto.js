// =============================================================================
// crypto.js — Password hashing.
//
// Uses PBKDF2 (SHA-256) via the Web Crypto API. Each password gets a random
// salt; we store the salt and the derived hash, never the password itself.
//
// IMPORTANT SECURITY NOTE
// -----------------------
// Because CAIRO currently runs entirely in the browser, hashing happens
// client-side. This protects stored passwords from casual inspection, but a
// determined user with developer tools can still bypass the login screen — the
// browser is not a trusted gatekeeper. The standing recommendation (carried
// over from the live system) is to move authentication behind the Cloudflare
// Worker before this is used for anything genuinely sensitive. The hashing here
// is written so that move is a drop-in: the same salt+hash format works
// server-side.
// =============================================================================

import { CONFIG } from './config.js';

const enc = new TextEncoder();

// True if the real Web Crypto PBKDF2 path is available (secure context).
function hasSubtle() {
  return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.importKey === 'function';
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Generate a random salt as a hex string.
export function newSalt(bytes = 16) {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fallback hash for environments without SubtleCrypto. Clearly weaker; only
// used so the demo still functions. Real deployments run in a secure context.
function weakHash(password, saltHex) {
  let h = 0x811c9dc5;
  const data = `${saltHex}:${password}`;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fallback$${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// Derive a hash for the given password + salt. Returns a hex string.
export async function hashPassword(password, saltHex) {
  if (!hasSubtle()) {
    return weakHash(password, saltHex);
  }
  const salt = enc.encode(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: CONFIG.pbkdf2Iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

// Create a {salt, hash} pair for a new password.
export async function makeCredential(password) {
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  return { salt, hash };
}

// Constant-ish time comparison of two hex strings.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify a candidate password against a stored salt + hash.
export async function verifyPassword(password, saltHex, expectedHash) {
  const actual = await hashPassword(password, saltHex);
  return safeEqual(actual, expectedHash);
}

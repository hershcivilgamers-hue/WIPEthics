// =============================================================================
// sync-hub.js — Live-sync pub/sub hub (Durable Object).
//
// One global instance. Clients open a hibernatable WebSocket after sign-in; the
// Worker forwards an internal "/notify" fetch after every authorized write, and
// the hub fans out a content-free "changed" ping. Each client then re-fetches the
// per-viewer-redacted REST snapshot (buildSnapshot), so redaction stays in ONE
// place and nothing sensitive ever crosses the socket. WebSocket Hibernation
// keeps idle connections free and survives eviction, so no per-socket state is
// held in memory.
//
// Deliberately a PLAIN class (not `extends DurableObject`) so this module never
// imports `cloudflare:workers` — that keeps the Worker entry (which re-exports
// this class) importable under plain Node for the handle() self-checks. Both
// hibernation (state.acceptWebSocket / state.getWebSockets) and the webSocket*
// handlers work on any Durable Object regardless of base class.
// =============================================================================

export class SyncHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    // A WebSocket upgrade (the Worker has already checked the session token) →
    // accept it as hibernatable and hand the client end back.
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    // Otherwise this is the Worker's internal "/notify" after a write: fan a bare
    // "changed" ping to every connected client. Each re-fetches what it may see.
    for (const ws of this.state.getWebSockets()) {
      try { ws.send('changed'); } catch (_) { /* socket is going away */ }
    }
    return new Response(null, { status: 204 });
  }

  // A client heartbeat keeps middleboxes from culling an otherwise-idle socket.
  webSocketMessage(ws, message) {
    if (message === 'ping') { try { ws.send('pong'); } catch (_) { /* closing */ } }
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (_) { /* already closed */ }
  }

  webSocketError() { /* no per-socket state to clean up */ }
}

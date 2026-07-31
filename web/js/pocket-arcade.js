"use strict";

class PocketArcadeClient {
  static TOKEN_KEY = "pocketArcade.sessionToken.v1";

  constructor() {
    this.profile = null;
    this.health = null;
    this.storage = { mounted: false };
    this.apps = [];
    this.players = new Map();
    this.chatMessages = [];
    this.gameMatches = new Map();
    this.gameSnapshots = new Map();
    this.gameInputSequences = new Map();
    this.game = Object.freeze({
      join: (appId) => this.joinGame(appId),
      leave: (matchId) => this.leaveGame(matchId),
      ready: (matchId) => this.readyGame(matchId),
      send: (matchId, action, data) => this.sendGameCommand(matchId, action, data),
      claimControl: (matchId) => this.claimGameControl(matchId),
      requestSnapshot: (matchId) => this.requestGameSnapshot(matchId),
      onMatch: (callback) => this.on("game.match", callback),
      onSnapshot: (callback) => this.on("game.snapshot", callback),
      onEvent: (callback) => this.on("game.event", callback),
      onResult: (callback) => this.on("game.result", callback),
      onError: (callback) => this.on("game.error", callback),
    });
    this.socket = null;
    this.sequence = 0;
    this.listeners = new Map();
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.intentionalClose = false;
    this.connectionStatus = "idle";
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, value) {
    for (const callback of this.listeners.get(event) || []) {
      try { callback(value); } catch (error) { console.error(error); }
    }
  }

  setConnection(status) {
    this.connectionStatus = status;
    this.emit("connection.changed", status);
  }

  clearGameConnectionState() {
    const previousMatches = [...this.gameMatches.values()];
    this.gameMatches.clear();
    this.gameSnapshots.clear();
    this.gameInputSequences.clear();
    for (const match of previousMatches) {
      this.emit("game.match", {
        ...match,
        state: "closed",
        you: {
          ...(match.you || {}),
          role: "none",
          controller: false,
        },
      });
    }
  }

  get token() {
    try { return localStorage.getItem(PocketArcadeClient.TOKEN_KEY); }
    catch { return null; }
  }

  set token(value) {
    try {
      if (value) localStorage.setItem(PocketArcadeClient.TOKEN_KEY, value);
      else localStorage.removeItem(PocketArcadeClient.TOKEN_KEY);
    } catch { /* Private browsing may deny storage. */ }
  }

  async request(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      cache: "no-store",
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`PocketArcade returned HTTP ${response.status}.`); }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error?.message || `Request failed (${response.status}).`);
      error.code = data.error?.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async initialise() {
    this.intentionalClose = false;
    this.setConnection("checking");
    const [health, storage, catalogue] = await Promise.all([
      this.request("/api/v1/health"),
      this.request("/api/v1/storage"),
      this.request("/api/v1/apps"),
    ]);
    this.health = health;
    this.storage = storage;
    this.apps = Array.isArray(catalogue.apps) ? catalogue.apps : [];
    this.emit("storage.changed", storage);
    this.emit("apps.changed", this.apps);

    let restoredBy = null;
    const existingToken = this.token;
    if (existingToken) {
      this.setConnection("restoring");
      try {
        const result = await this.request("/api/v1/profile/restore", {
          method: "POST",
          body: { sessionToken: existingToken },
        });
        this.profile = result.profile;
        restoredBy = "token";
      } catch (error) {
        if (error.code !== "invalid_session") throw error;
        this.token = null;
      }
    }
    if (!this.profile) {
      this.setConnection("recognising");
      try {
        const result = await this.request("/api/v1/profile/device-restore", {
          method: "POST",
        });
        this.profile = result.profile;
        this.token = result.sessionToken;
        restoredBy = "device";
      } catch (error) {
        if (!["device_not_recognised", "device_identity_unavailable",
              "device_identity_ambiguous"].includes(error.code)) throw error;
      }
    }
    if (!this.profile) {
      this.setConnection("profile-required");
      this.emit("profile.required");
      return { authenticated: false };
    }
    this.emit("profile.changed", this.profile);
    try { await this.connect(); }
    catch { /* onclose owns retry; keep the authenticated UI state */ }
    return { authenticated: true, restoredBy };
  }

  async createProfile(nickname, replaceDeviceBinding = false) {
    const result = await this.request("/api/v1/profile", {
      method: "POST",
      body: { nickname, replaceDeviceBinding },
    });
    this.profile = result.profile;
    this.token = result.sessionToken;
    this.emit("profile.changed", this.profile);
    try { await this.connect(); }
    catch { /* onclose owns retry; the new profile is still valid */ }
    return this.profile;
  }

  async updateProfile(nickname) {
    const result = await this.request("/api/v1/profile", {
      method: "PATCH",
      headers: { "X-PocketArcade-Token": this.token },
      body: { nickname },
    });
    this.profile = result.profile;
    this.emit("profile.changed", this.profile);
    return this.profile;
  }

  async updateAvatar(imageBase64) {
    const result = await this.request("/api/v1/profile/avatar", {
      method: "POST",
      headers: { "X-PocketArcade-Token": this.token },
      body: { imageBase64 },
    });
    this.profile = result.profile;
    this.emit("profile.changed", this.profile);
    return this.profile;
  }

  async switchPlayer() {
    if (this.token) {
      await this.request("/api/v1/profile/unbind-device", {
        method: "POST",
        headers: { "X-PocketArcade-Token": this.token },
      });
    }
    this.clearIdentity();
  }

  async deleteProfile() {
    if (!this.token) return this.clearIdentity();
    await this.request("/api/v1/profile", {
      method: "DELETE",
      headers: { "X-PocketArcade-Token": this.token },
    });
    this.clearIdentity();
  }

  clearIdentity() {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "Switching player");
    this.socket = null;
    this.token = null;
    this.profile = null;
    this.players.clear();
    this.chatMessages = [];
    this.gameMatches.clear();
    this.gameSnapshots.clear();
    this.gameInputSequences.clear();
    this.emit("profile.changed", null);
    this.emit("presence.changed", []);
    this.emit("chat.changed", []);
    this.setConnection("profile-required");
    this.emit("profile.required");
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    if (!this.token) return Promise.reject(new Error("No session token."));
    this.intentionalClose = false;
    this.setConnection(this.reconnectAttempt ? "reconnecting" : "connecting");
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/ws`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new Error("WebSocket handshake timed out."));
        }
      }, 8000);

      socket.onopen = () => {
        this.send("system.hello", {
          sessionToken: this.token,
          clientVersion: "0.3.0",
        });
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(event.data);
          return;
        }
        if (typeof event.data !== "string") return;
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; }
        if (message.v !== 1 || typeof message.type !== "string" ||
            typeof message.payload !== "object") return;
        if (message.type === "system.welcome") {
          if (message.payload.sessionToken) this.token = message.payload.sessionToken;
          this.profile = message.payload.profile;
          this.replacePlayers(message.payload.players || []);
          this.storage = { ...this.storage, ...message.payload.storage };
          this.emit("profile.changed", this.profile);
          this.emit("storage.changed", this.storage);
          this.reconnectAttempt = 0;
          this.setConnection("connected");
          clearTimeout(timeout);
          if (!settled) { settled = true; resolve(message.payload); }
        } else if (message.type === "error.authentication") {
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            const error = new Error(message.payload.message);
            error.code = message.payload.code;
            reject(error);
          }
          if (message.payload.code === "profile_required") this.clearIdentity();
        } else {
          this.handleMessage(message);
        }
      };
      socket.onerror = () => {
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error("WebSocket connection failed."));
        }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (this.socket === socket) this.socket = null;
        this.clearGameConnectionState();
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket closed before authentication."));
        }
        if (!this.intentionalClose && this.profile && this.token) this.scheduleReconnect();
      };
    });
  }

  scheduleReconnect() {
    this.setConnection("reconnecting");
    const delay = Math.min(30000, 750 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 7);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay + Math.random() * 350);
  }

  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({
      v: 1,
      type,
      id: ++this.sequence,
      payload,
    }));
    return true;
  }

  handleBinaryMessage(buffer) {
    const HEADER_BYTES = 36;
    const SNAPSHOT_KIND = 1;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) {
      return;
    }
    const view = new DataView(buffer);
    if (view.getUint8(0) !== 1 || view.getUint8(1) !== SNAPSHOT_KIND) return;
    const flags = view.getUint8(2);
    const appHandle = view.getUint32(4);
    const matchHandle = view.getUint32(8);
    const uint64 = (offset) =>
      view.getUint32(offset) * 0x100000000 + view.getUint32(offset + 4);
    const revision = uint64(12);
    const serverTick = uint64(20);
    const ackInputSeq = view.getUint32(28);
    const payloadLength = view.getUint32(32);
    if (payloadLength !== buffer.byteLength - HEADER_BYTES) return;
    const match = [...this.gameMatches.values()].find((candidate) =>
      (Number(candidate.appHandle) >>> 0) === appHandle &&
      (Number(candidate.matchHandle) >>> 0) === matchHandle
    );
    if (!match) return;
    let payload;
    try {
      const bytes = new Uint8Array(buffer, HEADER_BYTES, payloadLength);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return;
    }
    this.handleMessage({
      v: 1,
      type: "game.snapshot",
      payload: {
        appId: match.appId,
        matchId: match.matchId,
        revision,
        serverTick,
        ackInputSeq,
        full: Boolean(flags & 1),
        payload,
      },
    });
  }

  sendChat(text) {
    return this.send("chat.send", { text });
  }

  setOpenApp(appId) {
    if (appId !== null && (typeof appId !== "string" || !appId)) {
      return false;
    }
    return this.send("presence.app", { appId });
  }

  joinGame(appId, matchId = null) {
    if (typeof appId !== "string" || !appId) return false;
    return this.send("game.join", {
      appId,
      ...(matchId ? { matchId } : {}),
    });
  }

  leaveGame(matchId) {
    return this.send("game.leave", { matchId });
  }

  readyGame(matchId) {
    return this.send("game.ready", { matchId });
  }

  sendGameCommand(matchId, action, data = {}) {
    const match = this.gameMatches.get(matchId);
    if (!match || typeof action !== "string" || !action) return false;
    const inputSeq = (this.gameInputSequences.get(matchId) || 0) + 1;
    const sent = this.send("game.command", {
      appId: match.appId,
      matchId,
      action,
      inputSeq,
      data,
    });
    if (sent) this.gameInputSequences.set(matchId, inputSeq);
    return sent;
  }

  claimGameControl(matchId) {
    return this.send("game.control.claim", { matchId });
  }

  requestGameSnapshot(matchId) {
    return this.send("game.snapshot.request", { matchId });
  }

  createAppFacade(scopedAppId, shellDisplay = null) {
    const belongsToApp = (payload) => payload?.appId === scopedAppId;
    const ownsMatch = (matchId) =>
      this.gameMatches.get(matchId)?.appId === scopedAppId;
    const subscribe = (event, callback) => this.on(event, (payload) => {
      if (belongsToApp(payload)) callback(payload);
    });
    const findMatch = () => {
      const matches = [...this.gameMatches.values()]
        .filter((match) => match.appId === scopedAppId)
        .reverse();
      return matches.find((match) =>
        match.state !== "finished" && match.you?.role !== "none"
      ) || matches.find((match) => match.state !== "finished")
        || matches[0] || null;
    };
    const facadeGame = Object.freeze({
      join: (appId = scopedAppId) =>
        appId === scopedAppId && this.joinGame(scopedAppId),
      leave: (matchId) => ownsMatch(matchId) && this.leaveGame(matchId),
      ready: (matchId) => ownsMatch(matchId) && this.readyGame(matchId),
      send: (matchId, action, data) =>
        ownsMatch(matchId) && this.sendGameCommand(matchId, action, data),
      claimControl: (matchId) =>
        ownsMatch(matchId) && this.claimGameControl(matchId),
      requestSnapshot: (matchId) =>
        ownsMatch(matchId) && this.requestGameSnapshot(matchId),
      onMatch: (callback) => subscribe("game.match", callback),
      onSnapshot: (callback) => subscribe("game.snapshot", callback),
      onEvent: (callback) => subscribe("game.event", callback),
      onResult: (callback) => subscribe("game.result", callback),
      onError: (callback) => subscribe("game.error", callback),
      currentMatch: findMatch,
      currentSnapshot: () => {
        const match = findMatch();
        return match ? this.gameSnapshots.get(match.matchId) || null : null;
      },
    });
    const facadeDisplay = Object.freeze({
      requestFullscreen: () =>
        Boolean(shellDisplay?.requestFullscreen?.()),
      exitFullscreen: () =>
        Boolean(shellDisplay?.exitFullscreen?.()),
      get fullscreen() {
        return Boolean(shellDisplay?.isFullscreen?.());
      },
      onFullscreenChange: (callback) => {
        if (typeof callback !== "function") {
          throw new TypeError("Fullscreen callback must be a function.");
        }
        return shellDisplay?.onFullscreenChange?.(callback) || (() => {});
      },
    });
    const client = this;
    return Object.freeze({
      get profile() {
        return client.profile
          ? Object.freeze({
              id: client.profile.id,
              nickname: client.profile.nickname,
              avatarUrl: client.profile.avatarUrl || null,
              colour: client.profile.colour || null,
              wins: client.profile.wins || 0,
            })
          : null;
      },
      get connectionStatus() {
        return client.connectionStatus;
      },
      onConnection(callback) {
        return client.on("connection.changed", callback);
      },
      display: facadeDisplay,
      game: facadeGame,
    });
  }

  async refreshApps() {
    try {
      const catalogue = await this.request("/api/v1/apps");
      this.apps = Array.isArray(catalogue.apps) ? catalogue.apps : [];
      this.emit("apps.changed", this.apps);
    } catch { /* A removed card is already represented by storage state. */ }
  }

  async refreshStorage() {
    const storage = await this.request("/api/v1/storage");
    this.storage = storage;
    this.emit("storage.changed", storage);
    return storage;
  }

  async refreshDeviceStats() {
    const [health, storage] = await Promise.all([
      this.request("/api/v1/health"),
      this.request("/api/v1/storage"),
    ]);
    this.health = health;
    this.storage = storage;
    this.emit("storage.changed", storage);
    return { health, storage };
  }

  async waitForStorage(predicate, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let last = this.storage;
    while (Date.now() < deadline) {
      last = await this.refreshStorage();
      if (predicate(last)) {
        await this.refreshApps();
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const error = new Error("The SD operation did not finish in time.");
    error.code = "storage_timeout";
    throw error;
  }

  async ejectStorage() {
    await this.request("/api/v1/storage/eject", {
      method: "POST",
      headers: { "X-PocketArcade-Token": this.token },
    });
    return this.waitForStorage(
      (storage) => !storage.mounted && storage.safeToRemove);
  }

  async mountStorage() {
    await this.request("/api/v1/storage/mount", {
      method: "POST",
      headers: { "X-PocketArcade-Token": this.token },
    });
    return this.waitForStorage((storage) => storage.mounted);
  }

  sanitizeGameProfile(profile) {
    if (!profile || typeof profile !== "object") return null;
    const wins = Number(profile.wins);
    return {
      profileId: typeof profile.profileId === "string"
        ? profile.profileId : "",
      nickname: typeof profile.nickname === "string"
        ? profile.nickname : "",
      wins: Number.isFinite(wins) ? wins : 0,
      avatarUrl: typeof profile.avatarUrl === "string" && profile.avatarUrl
        ? profile.avatarUrl : null,
    };
  }

  sanitizeGameMatch(payload) {
    const seats = Array.isArray(payload?.seats)
      ? payload.seats.map((seat) => ({
          ...(seat && typeof seat === "object" ? seat : {}),
          player: seat?.player
            ? this.sanitizeGameProfile(seat.player) : null,
        }))
      : [];
    const spectators = Array.isArray(payload?.spectators)
      ? payload.spectators
          .map((profile) => this.sanitizeGameProfile(profile))
          .filter(Boolean)
      : [];
    return { ...payload, seats, spectators };
  }

  handleMessage(message) {
    const player = message.payload.player;
    if (message.type === "presence.snapshot") {
      this.replacePlayers(message.payload.players || []);
    } else if (message.type === "presence.joined" ||
               message.type === "presence.updated") {
      if (player?.id) this.players.set(player.id, player);
      if (player?.id && player.id === this.profile?.id) {
        this.profile = { ...this.profile, ...player };
        this.emit("profile.changed", this.profile);
      }
      this.publishPlayers();
    } else if (message.type === "presence.left") {
      if (player?.id) this.players.delete(player.id);
      this.publishPlayers();
    } else if (message.type.startsWith("storage.")) {
      this.storage = { ...this.storage, ...message.payload };
      if (message.type === "storage.unmounted" ||
          message.type === "storage.error") this.storage.mounted = false;
      if (message.type === "storage.mounted") this.storage.mounted = true;
      this.emit("storage.changed", this.storage);
      this.refreshApps();
    } else if (message.type === "chat.snapshot") {
      this.chatMessages = Array.isArray(message.payload.messages)
        ? message.payload.messages.slice(-50) : [];
      this.emit("chat.changed", this.chatMessages);
    } else if (message.type === "chat.message") {
      if (message.payload.message) {
        this.chatMessages.push(message.payload.message);
        this.chatMessages = this.chatMessages.slice(-50);
        this.emit("chat.changed", this.chatMessages);
      }
    } else if (message.type === "error.chat") {
      this.emit("chat.error", message.payload);
    } else if (message.type === "game.match") {
      if (message.payload?.matchId && message.payload?.appId) {
        const payload = this.sanitizeGameMatch(message.payload);
        this.gameMatches.set(payload.matchId, payload);
        message = { ...message, payload };
      } else return;
    } else if (message.type === "game.snapshot") {
      if (message.payload?.matchId && message.payload?.appId) {
        const previous = this.gameSnapshots.get(message.payload.matchId);
        if (!previous || Number(message.payload.revision) >=
            Number(previous.revision)) {
          this.gameSnapshots.set(message.payload.matchId, message.payload);
          const acknowledged = Number(message.payload.ackInputSeq) || 0;
          this.gameInputSequences.set(
            message.payload.matchId,
            Math.max(
              acknowledged,
              this.gameInputSequences.get(message.payload.matchId) || 0
            )
          );
        }
      } else return;
    } else if (message.type === "game.event" ||
               message.type === "game.result") {
      if (!message.payload?.matchId || !message.payload?.appId) return;
    } else if (message.type === "game.error" ||
               message.type === "error.game") {
      const match = message.payload?.matchId
        ? this.gameMatches.get(message.payload.matchId) : null;
      message = {
        ...message,
        payload: {
          ...message.payload,
          ...(message.payload?.appId || !match ? {} : { appId: match.appId }),
        },
      };
    }
    this.emit(message.type, message.payload);
  }

  replacePlayers(players) {
    this.players.clear();
    for (const player of players) if (player?.id) this.players.set(player.id, player);
    this.publishPlayers();
  }

  publishPlayers() {
    this.emit("presence.changed", [...this.players.values()]);
  }
}

window.PocketArcadeClient = PocketArcadeClient;

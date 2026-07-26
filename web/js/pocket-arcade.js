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
    this.game = null;
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
    this.game = null;
    this.emit("profile.changed", null);
    this.emit("presence.changed", []);
    this.emit("chat.changed", []);
    this.emit("game.changed", null);
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
          clientVersion: "0.1.0",
        });
      };
      socket.onmessage = (event) => {
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

  sendChat(text) {
    return this.send("chat.send", { text });
  }

  joinTicTacToe() {
    return this.send("game.tictactoe.join");
  }

  playTicTacToe(cell) {
    return this.send("game.tictactoe.move", { cell });
  }

  leaveTicTacToe() {
    return this.send("game.tictactoe.leave");
  }

  resetTicTacToe() {
    return this.send("game.tictactoe.reset");
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
    } else if (message.type === "game.tictactoe.snapshot" ||
               message.type === "game.tictactoe.updated") {
      this.game = message.payload;
      this.emit("game.changed", this.game);
    } else if (message.type === "error.game") {
      this.emit("game.error", message.payload);
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

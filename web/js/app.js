"use strict";

const arcade = new PocketArcadeClient();
const byId = (id) => document.getElementById(id);
const views = ["loading-view", "setup-view", "lobby-view", "fatal-view"];
const loadedAppScripts = new Set();
let unmountActiveApp = null;
let activeAppSession = null;
let chatCollapsed = true;
let chatInitialised = false;
let seenChatIds = new Set();
let unreadChatIds = new Set();
let adminStatsTimer = null;
let adminStatsRefreshing = false;
let playerPlacementsInitialised = false;
let previousPlayerPlacements = new Map();
let previousPlayerWins = new Map();
const pendingPlacementCelebrations = new Map();
let playerListVisible = false;
const appViewStorageKey = "pocketarcade.appView";
let appListView = "list";
try {
  appListView = localStorage.getItem(appViewStorageKey) === "grid"
    ? "grid" : "list";
} catch {
  /* Captive-portal browsers may disable local storage. */
}

function showView(id) {
  for (const view of views) byId(view).hidden = view !== id;
}

function setBusy(button, busy, busyText) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.label;
}

function visibleCharacters(value) {
  return Array.from(value.trim()).length;
}

function validateNickname(value) {
  const trimmed = value.trim();
  const length = visibleCharacters(trimmed);
  if (!length) return "Enter a nickname.";
  if (length > 24) return "Use no more than 24 visible characters.";
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(trimmed)) {
    return "Control characters are not allowed.";
  }
  return "";
}

function initials(nickname) {
  const words = nickname.trim().split(/\s+/u).filter(Boolean);
  const last = words[words.length - 1];
  const chars = words.length > 1
    ? [Array.from(words[0])[0], Array.from(last)[0]]
    : Array.from(words[0] || "?").slice(0, 2);
  return chars.join("").toLocaleUpperCase();
}

function renderAvatar(element, profile) {
  element.replaceChildren();
  if (profile.avatarUrl) {
    const image = document.createElement("img");
    const separator = profile.avatarUrl.includes("?") ? "&" : "?";
    image.src = `${profile.avatarUrl}${separator}v=${
      encodeURIComponent(profile.lastSeenAt || Date.now())}`;
    image.alt = "";
    image.decoding = "async";
    element.append(image);
  } else {
    element.textContent = initials(profile.nickname);
  }
}

function renderWinRoundel(element, value) {
  const wins = Math.max(0, Number(value) || 0);
  const tier = wins >= 20 ? 5
    : wins >= 10 ? 4
      : wins >= 5 ? 3
        : wins >= 3 ? 2
          : wins >= 1 ? 1 : 0;
  element.dataset.tier = String(tier);
  element.textContent = wins > 999 ? "999+" : String(wins);
  const label = `${wins} game ${wins === 1 ? "win" : "wins"}`;
  element.setAttribute("aria-label", label);
  element.title = label;
}

function renderConnection(status) {
  const pill = byId("connection-pill");
  pill.className = "status-pill";
  const labels = {
    idle: "Starting",
    checking: "Checking",
    restoring: "Restoring",
    recognising: "Recognising",
    connecting: "Connecting",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    "profile-required": "Ready",
  };
  pill.textContent = labels[status] || status;
  pill.title = status === "reconnecting"
    ? "Live updates were interrupted. PocketArcade is retrying automatically."
    : status === "connected"
      ? "Live updates are connected."
      : "PocketArcade connection status.";
  if (status === "connected") pill.classList.add("connected");
  if (status === "reconnecting") pill.classList.add("reconnecting");
  if (status === "connected") {
    arcade.setOpenApp(activeAppSession?.appId || null);
  }
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[unit]}`;
}

function renderGauge(name, percent, detail, available = true) {
  const gauge = byId(`${name}-gauge`);
  const value = byId(`${name}-gauge-value`);
  const rounded = Math.round(clampPercent(percent));
  gauge.style.setProperty("--gauge-value", available ? String(rounded) : "0");
  gauge.classList.toggle("is-unavailable", !available);
  value.textContent = available ? `${rounded}%` : "—";
  byId(`${name}-gauge-detail`).textContent = detail;
  if (available) {
    gauge.setAttribute("aria-valuenow", String(rounded));
    gauge.setAttribute("aria-valuetext", `${rounded}%; ${detail}`);
  } else {
    gauge.removeAttribute("aria-valuenow");
    gauge.setAttribute("aria-valuetext", detail);
  }
}

function renderAdminMetrics(health, storage) {
  const cpuReady = Boolean(health?.cpuSampleReady);
  renderGauge(
    "cpu",
    health?.cpuUsagePercent,
    cpuReady ? "Current load" : "Sampling…",
    cpuReady
  );

  const ramTotal = Math.max(0, Number(health?.ramTotalBytes) || 0);
  const ramFree = Math.min(
    ramTotal, Math.max(0, Number(health?.ramFreeBytes) || 0));
  const ramUsed = ramTotal - ramFree;
  renderGauge(
    "ram",
    ramTotal ? ramUsed / ramTotal * 100 : 0,
    ramTotal ? `${formatBytes(ramFree)} free` : "Unavailable",
    ramTotal > 0
  );

  const sdMounted = Boolean(storage?.mounted);
  const sdTotal = Math.max(0, Number(storage?.capacityBytes) || 0);
  const sdFree = Math.min(
    sdTotal, Math.max(0, Number(storage?.freeBytes) || 0));
  const sdUsed = sdTotal - sdFree;
  renderGauge(
    "sd",
    sdTotal ? sdUsed / sdTotal * 100 : 0,
    sdMounted && sdTotal ? `${formatBytes(sdFree)} free` : "Not mounted",
    sdMounted && sdTotal > 0
  );
}

function renderStorage(storage) {
  const mounted = Boolean(storage?.mounted);
  const safeToRemove = Boolean(storage?.safeToRemove);
  const action = byId("storage-action");
  byId("storage-notice").hidden = mounted;
  const isAdmin = arcade.profile?.role === "admin";
  action.hidden = !isAdmin;
  action.textContent = mounted ? "Eject SD card" : "Mount SD card";
  delete action.dataset.label;
  action.dataset.mode = mounted ? "eject" : "mount";
  action.disabled = false;
  byId("admin-storage-status").textContent = mounted
    ? `${String(storage.interface || "SD").toUpperCase()} storage is mounted and in use.`
    : safeToRemove
      ? "The SD card is unmounted and safe to remove."
      : "The SD card is not mounted. Insert it before choosing Mount SD card.";
  renderAdminMetrics(arcade.health, storage);
  const photoButton = byId("photo-button");
  if (arcade.profile) {
    photoButton.disabled = !arcade.profile.persistent || !mounted;
    photoButton.title = photoButton.disabled
      ? "Insert and mount the SD card to save a profile photo." : "";
  }
}

function renderProfile(profile) {
  const account = byId("account-pill");
  account.hidden = !profile;
  if (!profile) {
    account.open = false;
    byId("admin-button").hidden = true;
    byId("storage-action").hidden = true;
    if (byId("admin-dialog").open) byId("admin-dialog").close();
    return;
  }
  byId("account-name").textContent = profile.nickname;
  renderAvatar(byId("account-avatar"), profile);
  renderWinRoundel(byId("account-wins"), profile.wins);
  const photoButton = byId("photo-button");
  photoButton.textContent = profile.avatarUrl
    ? "Change profile photo" : "Add profile photo";
  photoButton.disabled = !profile.persistent || !arcade.storage?.mounted;
  photoButton.title = photoButton.disabled
    ? "Insert and mount the SD card to save a profile photo." : "";
  delete photoButton.dataset.label;
  const isAdmin = profile.role === "admin";
  byId("admin-button").hidden = !isAdmin;
  byId("storage-action").hidden = !isAdmin;
  byId("profile-persistence").textContent = profile.persistent
    ? "Saved on this PocketArcade"
    : "Temporary — lost when PocketArcade restarts";
  byId("welcome-text").textContent = `Welcome back ${profile.nickname}`;
}

function playerWins(player) {
  return Math.max(0, Number(player?.wins) || 0);
}

function comparePlayersByScore(a, b) {
  return playerWins(b) - playerWins(a) ||
    a.nickname.localeCompare(
      b.nickname, undefined, { sensitivity: "base" });
}

function playPendingPlacementCelebrations() {
  if (!playerListVisible ||
      document.body.classList.contains("app-fullscreen") ||
      pendingPlacementCelebrations.size === 0) return;
  const items = [...byId("player-list").children];
  for (const [playerId, place] of pendingPlacementCelebrations) {
    const item = items.find((candidate) =>
      candidate.dataset.playerId === playerId &&
      Number(candidate.dataset.place) === place);
    if (!item) continue;
    pendingPlacementCelebrations.delete(playerId);
    item.classList.remove("is-placement-celebrating");
    requestAnimationFrame(() => {
      item.classList.add("is-placement-celebrating");
      setTimeout(
        () => item.classList.remove("is-placement-celebrating"), 1400);
    });
  }
}

function updatePlayerPlacements(sorted) {
  const placements = new Map(
    sorted.slice(0, 3).map((player, index) => [player.id, index + 1]));
  const wins = new Map(
    sorted.map((player) => [player.id, playerWins(player)]));
  const scoreIncreased = sorted.some((player) =>
    previousPlayerWins.has(player.id) &&
    playerWins(player) > previousPlayerWins.get(player.id));

  if (playerPlacementsInitialised && scoreIncreased) {
    for (const [playerId, place] of placements) {
      if (previousPlayerPlacements.get(playerId) !== place) {
        pendingPlacementCelebrations.set(playerId, place);
      }
    }
  }
  previousPlayerPlacements = placements;
  previousPlayerWins = wins;
  playerPlacementsInitialised = true;
  return placements;
}

function createPlayerRosette(place) {
  const rosette = document.createElement("span");
  rosette.className = `player-rosette place-${place}`;
  rosette.setAttribute("aria-label", `${place === 1 ? "First" :
    place === 2 ? "Second" : "Third"} place`);
  rosette.title = rosette.getAttribute("aria-label");
  const rank = document.createElement("span");
  rank.className = "player-rosette-rank";
  rank.textContent = String(place);
  rosette.append(rank);
  return rosette;
}

function renderPlayers(players) {
  const list = byId("player-list");
  list.replaceChildren();
  const sorted = [...players].sort(comparePlayersByScore);
  const placements = updatePlayerPlacements(sorted);
  for (const player of sorted) {
    const place = placements.get(player.id);
    const item = document.createElement("li");
    item.className = "player";
    item.dataset.playerId = player.id;
    if (place) {
      item.dataset.place = String(place);
      item.append(createPlayerRosette(place));
    }
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    renderAvatar(avatar, player);
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.nickname;
    const wins = document.createElement("span");
    wins.className = "win-roundel";
    renderWinRoundel(wins, player.wins);
    const identity = document.createElement("span");
    identity.className = "player-identity";
    identity.append(name, wins);
    if (player.id === arcade.profile?.id) {
      const you = document.createElement("span");
      you.className = "you-label";
      you.textContent = "YOU";
      identity.append(you);
    }
    item.append(avatar, identity);
    const openAppDetails = arcade.apps.find((app) =>
      app.id === player.openAppId);
    if (openAppDetails) {
      const appButton = document.createElement("button");
      appButton.className = "player-app";
      appButton.type = "button";
      appButton.setAttribute(
        "aria-label",
        `Open ${openAppDetails.name}, currently open by ${player.nickname}`
      );
      const icon = document.createElement("img");
      icon.src = openAppDetails.iconUrl ||
        `/apps/${encodeURIComponent(openAppDetails.id)}/assets/icon.svg`;
      icon.alt = "";
      icon.decoding = "async";
      icon.addEventListener("error", () => icon.remove(), { once: true });
      const appName = document.createElement("span");
      appName.className = "player-app-name";
      appName.textContent = openAppDetails.name;
      appButton.append(icon, appName);
      appButton.addEventListener("click", () => openApp(openAppDetails));
      item.append(appButton);
    }
    list.append(item);
  }
  byId("player-count").textContent = String(sorted.length);
  byId("empty-players").hidden = sorted.length > 0;
  playPendingPlacementCelebrations();
}

function updateChatToggle() {
  const count = unreadChatIds.size;
  const unread = byId("chat-unread");
  unread.hidden = count === 0;
  unread.textContent = count > 99 ? "99+" : String(count);
  unread.setAttribute(
    "aria-label",
    `${count} unread chat ${count === 1 ? "message" : "messages"}`
  );
  byId("chat-toggle").setAttribute(
    "aria-expanded", String(!chatCollapsed));
  byId("chat-toggle-label").textContent =
    chatCollapsed ? "Expand" : "Collapse";
}

function setChatCollapsed(collapsed) {
  chatCollapsed = Boolean(collapsed);
  byId("chat-card").classList.toggle("is-collapsed", chatCollapsed);
  byId("chat-body").hidden = chatCollapsed;
  if (!chatCollapsed) {
    seenChatIds = new Set(
      arcade.chatMessages.map((message) => message.id).filter(Boolean));
    unreadChatIds.clear();
  }
  updateChatToggle();
}

function renderChat(messages) {
  const list = byId("chat-messages");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const currentIds = new Set(
    messages.map((message) => message.id).filter(Boolean));
  if (!chatInitialised) {
    chatInitialised = true;
    seenChatIds = currentIds;
    unreadChatIds.clear();
  } else if (chatCollapsed) {
    unreadChatIds = new Set(
      [...unreadChatIds].filter((id) => currentIds.has(id)));
    for (const message of messages) {
      if (message.id && !seenChatIds.has(message.id) &&
          message.playerId !== arcade.profile?.id) {
        unreadChatIds.add(message.id);
      }
    }
  } else {
    seenChatIds = currentIds;
    unreadChatIds.clear();
  }
  list.replaceChildren();
  for (const message of messages.slice(-50)) {
    const item = document.createElement("li");
    item.className = "chat-message";
    if (message.playerId === arcade.profile?.id) item.classList.add("own");
    const author = document.createElement("span");
    author.className = "chat-author";
    author.textContent = message.playerId === arcade.profile?.id
      ? `${message.nickname} · You` : message.nickname;
    const text = document.createElement("p");
    text.className = "chat-text";
    text.textContent = message.text;
    item.append(author, text);
    list.append(item);
  }
  byId("empty-chat").hidden = messages.length > 0;
  if (nearBottom || messages.length <= 1) list.scrollTop = list.scrollHeight;
  updateChatToggle();
}

function setAppFullscreen(session, enabled) {
  if (!session || session !== activeAppSession) return false;
  const fullscreen = Boolean(enabled);
  if (session.fullscreen === fullscreen) return true;
  if (session.changingFullscreen) return false;
  session.changingFullscreen = true;
  try {
    session.fullscreen = fullscreen;
    document.body.classList.toggle("app-fullscreen", fullscreen);
    byId("active-app-panel").classList.toggle("is-fullscreen", fullscreen);
    byId("active-app-host").classList.toggle("is-fullscreen", fullscreen);
    byId("exit-app-fullscreen").hidden = !fullscreen;
    for (const callback of [...session.fullscreenListeners]) {
      try {
        callback(fullscreen);
      } catch (error) {
        console.error("Game fullscreen callback failed.", error);
      }
    }
    if (!fullscreen) requestAnimationFrame(playPendingPlacementCelebrations);
  } finally {
    session.changingFullscreen = false;
  }
  return true;
}

function appDisplayCapability(session) {
  return Object.freeze({
    requestFullscreen: () => setAppFullscreen(session, true),
    exitFullscreen: () => setAppFullscreen(session, false),
    isFullscreen: () =>
      session === activeAppSession && session.fullscreen,
    onFullscreenChange: (callback) => {
      if (session !== activeAppSession) return () => {};
      session.fullscreenListeners.add(callback);
      return () => session.fullscreenListeners.delete(callback);
    },
  });
}

function closeApp(clearPresence = true) {
  const session = activeAppSession;
  if (session) setAppFullscreen(session, false);
  if (session && clearPresence) arcade.setOpenApp(null);
  activeAppSession = null;
  document.body.classList.remove("app-fullscreen");
  byId("active-app-panel").classList.remove("is-fullscreen");
  byId("active-app-host").classList.remove("is-fullscreen");
  byId("exit-app-fullscreen").hidden = true;
  const cleanup = unmountActiveApp;
  unmountActiveApp = null;
  if (typeof cleanup === "function") {
    try {
      cleanup();
    } catch (error) {
      console.error("Game cleanup failed.", error);
    }
  }
  byId("active-app-host").replaceChildren();
  byId("active-app-panel").hidden = true;
  byId("app-error").textContent = "";
  document.getElementById("active-app-style")?.remove();
}

function loadScript(url) {
  if (loadedAppScripts.has(url)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      loadedAppScripts.add(url);
      resolve();
    };
    script.onerror = () => reject(new Error("The game could not be loaded."));
    document.head.append(script);
  });
}

function scrollToFullGameView(session) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (activeAppSession !== session || session.fullscreen) return;
    byId("active-app-panel").scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }));
}

async function openApp(app) {
  closeApp(false);
  const session = {
    appId: app.id,
    fullscreen: false,
    changingFullscreen: false,
    fullscreenListeners: new Set(),
  };
  activeAppSession = session;
  arcade.setOpenApp(app.id);
  const panel = byId("active-app-panel");
  panel.hidden = false;
  byId("active-app-title").textContent = app.name;
  byId("app-error").textContent = "Loading game…";
  try {
    if (app.stylesheetUrl) {
      const style = document.createElement("link");
      style.id = "active-app-style";
      style.rel = "stylesheet";
      style.href = app.stylesheetUrl;
      document.head.append(style);
    }
    await loadScript(app.entrypointUrl);
    if (activeAppSession !== session) return;
    const module = window.PocketArcadeApps?.[app.id];
    if (!module || typeof module.mount !== "function") {
      throw new Error("This application has an invalid entrypoint.");
    }
    byId("app-error").textContent = "";
    const appFacade = arcade.createAppFacade(
      app.id, appDisplayCapability(session));
    const cleanup = module.mount(byId("active-app-host"), appFacade);
    if (activeAppSession === session) {
      unmountActiveApp = typeof cleanup === "function" ? cleanup : null;
      scrollToFullGameView(session);
    } else if (typeof cleanup === "function") {
      cleanup();
    }
  } catch (error) {
    if (activeAppSession !== session) return;
    setAppFullscreen(session, false);
    activeAppSession = null;
    arcade.setOpenApp(null);
    byId("app-error").textContent = error.message;
    panel.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}

function setAppListView(view, persist = true) {
  appListView = view === "grid" ? "grid" : "list";
  byId("app-list").classList.toggle("is-grid", appListView === "grid");
  byId("app-view-list").setAttribute(
    "aria-pressed", String(appListView === "list"));
  byId("app-view-grid").setAttribute(
    "aria-pressed", String(appListView === "grid"));
  if (!persist) return;
  try {
    localStorage.setItem(appViewStorageKey, appListView);
  } catch {
    /* The selected view still applies for this page session. */
  }
}

function renderApps(apps) {
  const list = byId("app-list");
  list.replaceChildren();
  for (const app of apps) {
    const card = document.createElement("article");
    card.className = "app-card";
    const launch = document.createElement("button");
    launch.className = "app-launch";
    launch.type = "button";
    launch.setAttribute(
      "aria-label",
      `Open ${app.name}${app.description ? `: ${app.description}` : ""}`);
    const iconFrame = document.createElement("span");
    iconFrame.className = "app-card-icon";
    const icon = document.createElement("img");
    icon.src = app.iconUrl ||
      `/apps/${encodeURIComponent(app.id)}/assets/icon.svg`;
    icon.alt = "";
    icon.decoding = "async";
    icon.addEventListener("error", () => iconFrame.classList.add("is-empty"), {
      once: true,
    });
    iconFrame.append(icon);
    const title = document.createElement("span");
    title.className = "app-card-title";
    title.textContent = app.name;
    launch.append(iconFrame, title);
    launch.addEventListener("click", () => openApp(app));
    card.append(launch);
    list.append(card);
  }
  byId("empty-apps").hidden = apps.length > 0;
  if (!apps.length) closeApp();
  renderPlayers([...arcade.players.values()]);
}

function showLobby() {
  showView("lobby-view");
  renderProfile(arcade.profile);
  renderStorage(arcade.storage);
}

async function start() {
  showView("loading-view");
  byId("loading-message").textContent = "Checking this PocketArcade…";
  try {
    const result = await arcade.initialise();
    if (result.authenticated) showLobby();
    else showView("setup-view");
  } catch (error) {
    byId("fatal-message").textContent = error.message;
    showView("fatal-view");
  }
}

arcade.on("connection.changed", renderConnection);
arcade.on("storage.changed", renderStorage);
arcade.on("profile.changed", renderProfile);
arcade.on("presence.changed", renderPlayers);
arcade.on("chat.changed", renderChat);
arcade.on("chat.error", (error) => {
  byId("chat-error").textContent = error?.message || "Message not sent.";
});
arcade.on("apps.changed", renderApps);
arcade.on("profile.required", () => {
  closeApp();
  chatInitialised = false;
  seenChatIds.clear();
  unreadChatIds.clear();
  updateChatToggle();
  byId("nickname").value = "";
  byId("nickname-error").textContent = "";
  showView("setup-view");
  byId("nickname").focus();
});

byId("nickname").addEventListener("input", (event) => {
  byId("nickname-count").textContent =
    `${visibleCharacters(event.target.value)} / 24`;
  byId("nickname-error").textContent = "";
});

byId("nickname-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = byId("nickname");
  const error = validateNickname(input.value);
  byId("nickname-error").textContent = error;
  if (error) return input.focus();
  const button = byId("continue-button");
  setBusy(button, true, "Creating player…");
  try {
    await arcade.createProfile(input.value);
    showLobby();
  } catch (requestError) {
    if (requestError.code === "device_already_linked") {
      const confirmed = await confirmAction(
        "Replace device link?",
        "This device is linked to another player. Create this new player and replace that device link?",
        "Create player");
      if (confirmed) {
        try {
          await arcade.createProfile(input.value, true);
          showLobby();
        } catch (secondError) {
          byId("nickname-error").textContent = secondError.message;
        }
      }
    } else {
      byId("nickname-error").textContent = requestError.message;
    }
  } finally {
    setBusy(button, false);
  }
});

byId("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("chat-input");
  const text = input.value.trim();
  byId("chat-error").textContent = "";
  if (!text) {
    byId("chat-error").textContent = "Write a message first.";
    return input.focus();
  }
  if (!arcade.sendChat(text)) {
    byId("chat-error").textContent =
      "Live updates are reconnecting. Try again in a moment.";
    return;
  }
  input.value = "";
  input.focus();
});

byId("chat-toggle").addEventListener("click", () => {
  setChatCollapsed(!chatCollapsed);
  if (!chatCollapsed) byId("chat-input").focus();
});

byId("app-view-list").addEventListener(
  "click", () => setAppListView("list"));
byId("app-view-grid").addEventListener(
  "click", () => setAppListView("grid"));

document.addEventListener("pointerdown", (event) => {
  const account = byId("account-pill");
  if (account.open && !account.contains(event.target)) {
    account.open = false;
  }
});

byId("storage-action").addEventListener("click", async () => {
  const button = byId("storage-action");
  const ejecting = button.dataset.mode === "eject";
  setBusy(button, true, ejecting ? "Ejecting…" : "Mounting…");
  try {
    if (ejecting) await arcade.ejectStorage();
    else await arcade.mountStorage();
  } catch (error) {
    window.alert(error.message);
    setBusy(button, false);
  }
});

function stopAdminStats() {
  if (adminStatsTimer !== null) clearTimeout(adminStatsTimer);
  adminStatsTimer = null;
}

async function refreshAdminStats() {
  if (adminStatsRefreshing || !byId("admin-dialog").open) return;
  adminStatsRefreshing = true;
  try {
    const { health, storage } = await arcade.refreshDeviceStats();
    renderAdminMetrics(health, storage);
  } catch (error) {
    console.warn("Could not refresh administrator metrics.", error);
  } finally {
    adminStatsRefreshing = false;
    if (byId("admin-dialog").open) {
      adminStatsTimer = setTimeout(refreshAdminStats, 2000);
    }
  }
}

byId("admin-button").addEventListener("click", () => {
  byId("account-pill").open = false;
  renderStorage(arcade.storage);
  byId("admin-dialog").showModal();
  stopAdminStats();
  void refreshAdminStats();
});
byId("admin-dialog").addEventListener("close", stopAdminStats);

function canvasJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) :
        reject(new Error("This browser could not process the photo.")),
      "image/jpeg",
      quality
    );
  });
}

function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("The processed photo could not be read."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("The processed photo could not be read."));
    reader.readAsDataURL(blob);
  });
}

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Choose a photo that this browser can read."));
    };
    image.src = url;
  });
}

async function prepareAvatar(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Choose an image or take a new photo.");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("That original photo is too large to process.");
  }
  const source = await loadPhoto(file);
  const edge = Math.min(source.naturalWidth, source.naturalHeight);
  if (edge < 32) throw new Error("Choose a photo at least 32 pixels wide.");
  const sourceX = Math.floor((source.naturalWidth - edge) / 2);
  const sourceY = Math.floor((source.naturalHeight - edge) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not resize the photo.");
  context.fillStyle = "#211b3b";
  context.fillRect(0, 0, 96, 96);
  context.drawImage(source, sourceX, sourceY, edge, edge, 0, 0, 96, 96);
  let result;
  for (const quality of [0.76, 0.66, 0.56, 0.46]) {
    result = await canvasJpeg(canvas, quality);
    if (result.size <= 10 * 1024) break;
  }
  if (!result || result.size > 12 * 1024) {
    throw new Error("The photo could not be compressed enough.");
  }
  return blobBase64(result);
}

byId("photo-button").addEventListener("click", () => {
  byId("photo-error").textContent = "";
  byId("photo-input").click();
});

byId("photo-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const button = byId("photo-button");
  byId("photo-error").textContent = "";
  setBusy(button, true, "Processing photo…");
  try {
    const imageBase64 = await prepareAvatar(file);
    setBusy(button, true, "Saving photo…");
    await arcade.updateAvatar(imageBase64);
    byId("photo-error").textContent = "Profile photo saved.";
  } catch (error) {
    byId("photo-error").textContent = error.message;
  } finally {
    renderProfile(arcade.profile);
  }
});

byId("edit-button").addEventListener("click", () => {
  byId("account-pill").open = false;
  byId("edit-nickname").value = arcade.profile?.nickname || "";
  byId("edit-error").textContent = "";
  byId("edit-dialog").showModal();
  byId("edit-nickname").focus();
});

byId("edit-form").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const value = byId("edit-nickname").value;
  const error = validateNickname(value);
  byId("edit-error").textContent = error;
  if (error) return;
  const button = byId("save-nickname");
  setBusy(button, true, "Saving…");
  try {
    await arcade.updateProfile(value);
    byId("edit-dialog").close();
  } catch (requestError) {
    byId("edit-error").textContent = requestError.message;
  } finally {
    setBusy(button, false);
  }
});

function confirmAction(title, message, action) {
  const dialog = byId("confirm-dialog");
  byId("confirm-title").textContent = title;
  byId("confirm-message").textContent = message;
  byId("confirm-action").textContent = action;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true }
    );
  });
}

byId("switch-button").addEventListener("click", async () => {
  byId("account-pill").open = false;
  const confirmed = await confirmAction(
    "Switch player?",
    "This removes the current Wi-Fi device link but keeps the player profile saved.",
    "Switch player");
  if (!confirmed) return;
  try { await arcade.switchPlayer(); }
  catch (error) { window.alert(error.message); }
});

byId("delete-button").addEventListener("click", async () => {
  byId("account-pill").open = false;
  const confirmed = await confirmAction(
    "Delete your profile?",
    "This permanently removes the profile, every device binding, and its active sessions. This cannot be undone.",
    "Delete profile");
  if (!confirmed) return;
  try { await arcade.deleteProfile(); }
  catch (error) { window.alert(error.message); }
});

byId("close-app").addEventListener("click", closeApp);
byId("exit-app-fullscreen").addEventListener("click", () => {
  const session = activeAppSession;
  if (!session || !setAppFullscreen(session, false)) return;
  byId("close-app").focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !activeAppSession?.fullscreen) return;
  event.preventDefault();
  setAppFullscreen(activeAppSession, false);
});
byId("retry-button").addEventListener("click", start);

if ("IntersectionObserver" in window) {
  const playerListObserver = new IntersectionObserver(
    (entries) => {
      playerListVisible = entries.some(
        (entry) => entry.isIntersecting && entry.intersectionRatio >= .25);
      if (playerListVisible) playPendingPlacementCelebrations();
    },
    { threshold: [.25] }
  );
  playerListObserver.observe(byId("player-list"));
} else {
  playerListVisible = true;
}

setAppListView(appListView, false);
start();

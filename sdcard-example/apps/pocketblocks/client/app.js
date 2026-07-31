"use strict";

(() => {
  const APP_ID = "pocketblocks";
  const APP_VERSION = "2.6.0";
  const BOARD_W = 10;
  const BOARD_H = 20;
  const FIELD_ASPECT = BOARD_W / BOARD_H;
  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;
  const startScreenUrl = new URL("../assets/start-screen.jpg", assetBase).href;

  const COLORS = [
    "#090712", "#55d8ee", "#f5b83d", "#8067ed", "#21b88c",
    "#ef5d67", "#6b9dff", "#ff9d58", "#7f7a8d"
  ];

  const SHAPES = [null,
    [
      [[0,1],[1,1],[2,1],[3,1]], [[2,0],[2,1],[2,2],[2,3]],
      [[0,2],[1,2],[2,2],[3,2]], [[1,0],[1,1],[1,2],[1,3]]
    ],
    [
      [[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]]
    ],
    [
      [[1,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[2,1],[1,2]], [[1,0],[0,1],[1,1],[1,2]]
    ],
    [
      [[1,0],[2,0],[0,1],[1,1]], [[1,0],[1,1],[2,1],[2,2]],
      [[1,1],[2,1],[0,2],[1,2]], [[0,0],[0,1],[1,1],[1,2]]
    ],
    [
      [[0,0],[1,0],[1,1],[2,1]], [[2,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[1,2],[2,2]], [[1,0],[0,1],[1,1],[0,2]]
    ],
    [
      [[0,0],[0,1],[1,1],[2,1]], [[1,0],[2,0],[1,1],[1,2]],
      [[0,1],[1,1],[2,1],[2,2]], [[1,0],[1,1],[0,2],[1,2]]
    ],
    [
      [[2,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,1],[0,2]], [[0,0],[1,0],[1,1],[1,2]]
    ]
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className) {
    const node = element("button", className, text);
    node.type = "button";
    return node;
  }

  function decodeCells(encoded) {
    const cells = new Uint8Array(BOARD_W * BOARD_H);
    if (typeof encoded !== "string") return cells;
    const limit = Math.min(cells.length, encoded.length);
    for (let i = 0; i < limit; i += 1) {
      const value = Number.parseInt(encoded[i], 16);
      cells[i] = Number.isFinite(value) ? value : 0;
    }
    return cells;
  }

  function drawBoard(canvas, player) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(90, Math.round(rect.width || 300));
    const height = Math.max(180, Math.round(rect.height || 600));
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const cellW = width / BOARD_W;
    const cellH = height / BOARD_H;
    const boardGradient = context.createLinearGradient(0, 0, 0, height);
    boardGradient.addColorStop(0, "#1d1734");
    boardGradient.addColorStop(0.56, "#100c20");
    boardGradient.addColorStop(1, COLORS[0]);
    context.fillStyle = boardGradient;
    context.fillRect(0, 0, width, height);

    const paintCell = (x, y, color) => {
      const inset = Math.max(0.7, Math.min(1.5, cellW * 0.055));
      const px = x * cellW + inset;
      const py = y * cellH + inset;
      const blockW = Math.max(1, cellW - inset * 2);
      const blockH = Math.max(1, cellH - inset * 2);
      const radius = Math.max(1, Math.min(4, blockW * 0.14));

      const roundedPath = (x, y, w, h, r) => {
        context.beginPath();
        if (typeof context.roundRect === "function") {
          context.roundRect(x, y, w, h, r);
        } else {
          context.rect(x, y, w, h);
        }
      };

      context.fillStyle = "rgba(0,0,0,.38)";
      roundedPath(px + 1.2, py + 2, blockW, blockH, radius);
      context.fill();

      context.fillStyle = color;
      roundedPath(px, py, blockW, blockH, radius);
      context.fill();

      context.fillStyle = "rgba(255,255,255,.25)";
      roundedPath(
        px + 1,
        py + 1,
        Math.max(1, blockW - 2),
        Math.max(1, blockH * 0.18),
        Math.max(1, radius - 1)
      );
      context.fill();

      context.fillStyle = "rgba(0,0,0,.20)";
      context.fillRect(
        px + 1,
        py + blockH * 0.82,
        Math.max(1, blockW - 2),
        Math.max(1, blockH * 0.13)
      );
    };

    const cells = decodeCells(player && player.cells);
    for (let y = 0; y < BOARD_H; y += 1) {
      for (let x = 0; x < BOARD_W; x += 1) {
        const value = cells[y * BOARD_W + x];
        if (value) paintCell(x, y, COLORS[value] || COLORS[8]);
      }
    }

    if (player && player.active && player.alive !== false) {
      const active = player.active;
      const rotations = SHAPES[active.type];
      const shape = rotations && rotations[active.rotation & 3];
      if (shape) {
        const activeColor = COLORS[active.type] || COLORS[8];
        for (const [shapeX, shapeY] of shape) {
          const x = active.x + shapeX;
          const y = active.y + shapeY;
          if (x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H) {
            paintCell(x, y, activeColor);
          }
        }
      }
    }

    context.strokeStyle = "rgba(255,255,255,.065)";
    context.lineWidth = 1;
    for (let x = 1; x < BOARD_W; x += 1) {
      context.beginPath();
      context.moveTo(x * cellW, 0);
      context.lineTo(x * cellW, height);
      context.stroke();
    }
    for (let y = 1; y < BOARD_H; y += 1) {
      context.beginPath();
      context.moveTo(0, y * cellH);
      context.lineTo(width, y * cellH);
      context.stroke();
    }
  }

  window.PocketArcadeApps = window.PocketArcadeApps || {};
  window.PocketArcadeApps[APP_ID] = {
    mount(container, arcade) {
      const cachedMatch = arcade.game.currentMatch();
      let matchState = cachedMatch && cachedMatch.you && cachedMatch.you.role !== "none"
        ? cachedMatch
        : null;
      const cachedSnapshot = arcade.game.currentSnapshot();
      let snapshotEnvelope = matchState && cachedSnapshot &&
        cachedSnapshot.matchId === matchState.matchId ? cachedSnapshot : null;
      let resultEnvelope = null;
      let latestSnapshotRevision = snapshotEnvelope &&
        Number.isFinite(snapshotEnvelope.revision) ? snapshotEnvelope.revision : -1;
      let connectionState = arcade.connectionStatus || "connecting";
      let disposed = false;
      let joinPending = false;
      let splashAssetReady = false;
      let runtimeFailed = false;
      let runtimeFailureMessage = "";
      const stops = [];
      const held = new Set();
      const timers = new Set();
      const pendingActions = [];
      const activePointers = new Map();
      const lastOneShotAt = new Map();
      const lastRepeatPressAt = new Map();
      const retiredMatchIds = new Set();
      const retiredMatchOrder = [];
      const COMMAND_INTERVAL_MS = 70;
      const REPEAT_PRESS_DEBOUNCE_MS = 90;
      const ONE_SHOT_DEBOUNCE_MS = 140;
      const HARD_DROP_DEBOUNCE_MS = 240;
      const MAX_PENDING_ACTIONS = 3;
      const MAX_RETIRED_MATCHES = 8;
      let inputTimer = null;
      let lastCommandSentAt = -COMMAND_INTERVAL_MS;
      let heldCursor = 0;
      let layoutFrame = 0;
      let layoutObserver = null;
      let toastTimer = null;
      let lastViewportWidth = -1;
      let lastViewportHeight = -1;
      let lastAvailableHeight = -1;
      let lastBoardWidth = -1;
      let lastBoardHeight = -1;

      const root = element("section", "pocketblocks");
      root.dataset.phase = "waiting";

      const topbar = element("header", "pb-topbar");
      const brand = element("div", "pb-brand");
      const icon = document.createElement("img");
      icon.className = "pb-icon";
      icon.src = iconUrl;
      icon.alt = "";
      icon.width = 42;
      icon.height = 42;
      icon.decoding = "async";
      icon.draggable = false;
      const brandCopy = element("div", "pb-brand-copy");
      const title = element("div", "pb-title", "PocketBlocks");
      const subtitle = element("div", "pb-subtitle", "Multiplayer puzzle battle");
      brandCopy.append(title, subtitle);
      const connectionBadge = element("div", "pb-connection");
      const connectionDot = element("span", "pb-connection-dot");
      connectionDot.setAttribute("aria-hidden", "true");
      const connectionLabel = element("span", "pb-connection-label", "Connecting");
      connectionBadge.append(connectionDot, connectionLabel);
      brand.append(icon, brandCopy, connectionBadge);

      const topbarTools = element("div", "pb-topbar-tools");
      const status = element("div", "pb-status", "Choose Join game to play.");
      status.setAttribute("aria-live", "polite");
      const fullscreenButton = button("Full screen", "pb-button pb-button--secondary pb-fullscreen-button");
      fullscreenButton.setAttribute("aria-label", "Enter PocketBlocks fullscreen");
      topbarTools.append(status, fullscreenButton);
      topbar.append(brand, topbarTools);

      const toast = element("div", "pb-toast");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.hidden = true;

      const splash = element("section", "pb-splash");
      splash.setAttribute("aria-labelledby", "pb-splash-title");
      const splashHeading = element("h2", "pb-sr-only", "PocketBlocks");
      splashHeading.id = "pb-splash-title";
      const splashArtWrap = element("figure", "pb-splash-art-wrap");
      const splashArt = document.createElement("img");
      splashArt.className = "pb-splash-art";
      splashArt.alt = "Colourful falling blocks stacking in a neon PocketArcade puzzle arena.";
      splashArt.width = 960;
      splashArt.height = 720;
      splashArt.loading = "eager";
      splashArt.decoding = "async";
      splashArt.draggable = false;
      if ("fetchPriority" in splashArt) splashArt.fetchPriority = "high";
      splashArt.addEventListener("load", () => {
        splashAssetReady = true;
        render();
      }, { once: true });
      splashArt.addEventListener("error", () => {
        splashAssetReady = true;
        showToast("The start artwork could not be loaded, but the game is ready.", "error", 2600);
        render();
      }, { once: true });
      splashArt.src = startScreenUrl;
      splashArtWrap.append(splashArt);

      const splashPanel = element("div", "pb-splash-body");
      const splashDetails = element("div", "pb-splash-panel-details");
      const splashPrompt = element("strong", "pb-splash-prompt", "Ready to clear the board?");
      const splashMeta = element("div", "pb-splash-meta");
      splashMeta.setAttribute("aria-label", "Game details");
      splashMeta.append(
        element("span", "pb-chip", "2–4 players"),
        element("span", "pb-chip", "Spectators welcome"),
        element("span", "pb-chip", `v${APP_VERSION}`)
      );
      splashDetails.append(splashPrompt, splashMeta);
      const splashJoinButton = button("Join game", "pb-button pb-button--primary pb-splash-join");
      splashPanel.append(splashDetails, splashJoinButton);
      splash.append(splashHeading, splashArtWrap, splashPanel);

      const gameView = element("section", "pb-game-view");
      gameView.setAttribute("aria-label", "PocketBlocks match");

      const layout = element("div", "pb-layout");
      const playersPanel = element("section", "pb-players-panel");
      playersPanel.setAttribute("aria-labelledby", "pb-players-title");
      const playersHeading = element("div", "pb-players-heading");
      const playersTitle = element("div", "pb-section-title", "Players");
      playersTitle.id = "pb-players-title";
      const playerCount = element("div", "pb-player-count", "Waiting for players");
      playersHeading.append(playersTitle, playerCount);
      const opponents = element("div", "pb-opponents");
      playersPanel.append(playersHeading, opponents);

      const playColumn = element("div", "pb-play-column");
      const stage = element("section", "pb-stage");
      stage.setAttribute("aria-label", "PocketBlocks game arena");
      const stats = element("div", "pb-stats");
      const score = element("span", "pb-stat", "Score 0");
      const lines = element("span", "pb-stat", "Lines 0");
      const garbage = element("span", "pb-stat", "Garbage 0");
      stats.append(score, lines, garbage);

      const boardViewport = element("div", "pb-board-viewport");
      const boardWrap = element("div", "pb-board-wrap");
      const board = element("canvas", "pb-board");
      board.setAttribute("aria-label", "Your PocketBlocks board");
      const boardOverlay = element("div", "pb-board-overlay");
      const overlaySymbol = element("div", "pb-overlay-symbol", "◆");
      overlaySymbol.setAttribute("aria-hidden", "true");
      const overlayKicker = element("div", "pb-overlay-kicker", "POCKETBLOCKS");
      const overlayTitle = element("div", "pb-overlay-title", "Waiting for players");
      const overlayText = element("div", "pb-overlay-text", "Take a seat, ready up and outlast your rivals.");
      const resultPlacements = element("div", "pb-result-placements");
      const resultActions = element("div", "pb-result-actions");
      const resultAgainButton = button("Play another match", "pb-button pb-button--primary");
      const resultExitButton = button("Exit fullscreen", "pb-button pb-button--secondary");
      resultActions.append(resultAgainButton, resultExitButton);
      boardOverlay.append(
        overlaySymbol,
        overlayKicker,
        overlayTitle,
        overlayText,
        resultPlacements,
        resultActions
      );
      boardWrap.append(board, boardOverlay);
      boardViewport.append(boardWrap);
      stage.append(stats, boardViewport);

      const controls = element("div", "pb-controls");
      const leftButton = button("◀", "pb-button pb-control");
      const rotateButton = button("↻", "pb-button pb-control");
      const rightButton = button("▶", "pb-button pb-control");
      const downButton = button("▼", "pb-button pb-control");
      const dropButton = button("DROP", "pb-button pb-control pb-control--drop");
      leftButton.setAttribute("aria-label", "Move left");
      rotateButton.setAttribute("aria-label", "Rotate clockwise");
      rightButton.setAttribute("aria-label", "Move right");
      downButton.setAttribute("aria-label", "Soft drop");
      dropButton.setAttribute("aria-label", "Hard drop");
      controls.append(leftButton, rotateButton, rightButton, downButton, dropButton);

      const controlPanel = element("section", "pb-control-panel");
      const controlCopy = element("div", "pb-control-copy");
      const controlKicker = element("div", "pb-control-kicker", "NEXT STEP");
      const controlTitle = element("div", "pb-control-title", "Ready up");
      const controlHint = element("div", "pb-control-hint", "The round begins when every occupied seat is ready.");
      controlCopy.append(controlKicker, controlTitle, controlHint);
      controlPanel.append(controlCopy, controls);
      playColumn.append(stage, controlPanel);
      layout.append(playersPanel, playColumn);

      const actions = element("div", "pb-actions");
      actions.setAttribute("aria-label", "Match actions");
      const readyButton = button("Ready", "pb-button pb-button--primary");
      const claimButton = button("Take control", "pb-button pb-button--secondary pb-claim");
      const leaveButton = button("Leave match", "pb-button pb-button--danger");
      actions.append(readyButton, claimButton, leaveButton);

      const help = element(
        "p",
        "pb-help",
        "Keyboard: arrows move, Z/X rotate and Space hard-drops. Clearing three or four lines attacks every rival."
      );
      gameView.append(layout, actions, help);
      root.append(topbar, splash, gameView, toast);
      container.replaceChildren(root);

      if (splashArt.complete) {
        splashAssetReady = splashArt.naturalWidth > 0 || splashArt.naturalHeight > 0;
      }

      function payload() {
        return snapshotEnvelope && snapshotEnvelope.payload && typeof snapshotEnvelope.payload === "object"
          ? snapshotEnvelope.payload
          : null;
      }

      function ownSeat() {
        return matchState && matchState.you && matchState.you.role === "player"
          ? matchState.you.seat
          : null;
      }

      function playerBySeat(seat) {
        const state = payload();
        if (!state || !Array.isArray(state.players)) return null;
        return state.players.find((player) => player.seat === seat) || null;
      }

      function ownPlayer() {
        return playerBySeat(ownSeat());
      }

      function displayName(player) {
        return player && typeof player.nickname === "string" && player.nickname
          ? player.nickname
          : "Player";
      }

      function profileForSeat(seat) {
        if (!matchState || !Array.isArray(matchState.seats)) return null;
        const matchSeat = matchState.seats.find((entry) => entry.seat === seat);
        return matchSeat && matchSeat.player ? matchSeat.player : null;
      }

      function avatarUrlFor(player) {
        const matchProfile = player ? profileForSeat(player.seat) : null;
        const ownProfile = player && player.seat === ownSeat() && arcade.profile
          ? arcade.profile
          : null;
        for (const profile of [matchProfile, ownProfile, player]) {
          if (profile && typeof profile.avatarUrl === "string" && profile.avatarUrl) {
            return profile.avatarUrl;
          }
        }
        return "";
      }

      function makeAvatar(player) {
        const wrapper = element("div", "pb-avatar");
        const avatarUrl = avatarUrlFor(player);
        const name = displayName(player);
        if (avatarUrl) {
          const image = document.createElement("img");
          image.src = avatarUrl;
          image.alt = `${name} profile avatar`;
          image.addEventListener("error", () => {
            image.remove();
            wrapper.textContent = name.trim().slice(0, 1).toUpperCase() || "?";
          }, { once: true });
          wrapper.append(image);
        } else {
          wrapper.textContent = name.trim().slice(0, 1).toUpperCase() || "?";
          wrapper.setAttribute("aria-label", `${name} profile avatar`);
        }
        return wrapper;
      }

      function isFinished() {
        return Boolean(
          runtimeFailed || resultEnvelope ||
          (matchState && matchState.state === "finished")
        );
      }

      function canControl() {
        const state = payload();
        const me = ownPlayer();
        return Boolean(
          !runtimeFailed &&
          matchState &&
          matchState.you &&
          matchState.you.role === "player" &&
          matchState.you.controller &&
          state &&
          state.phase === "playing" &&
          me &&
          me.alive !== false
        );
      }

      function setStatus(message, kind) {
        status.textContent = message;
        status.dataset.state = kind || "";
      }

      function showToast(message, kind, durationMs) {
        if (toastTimer !== null) {
          window.clearTimeout(toastTimer);
          timers.delete(toastTimer);
          toastTimer = null;
        }
        toast.textContent = message;
        toast.dataset.state = kind || "";
        toast.hidden = false;
        if (durationMs !== 0) {
          toastTimer = window.setTimeout(() => {
            timers.delete(toastTimer);
            toastTimer = null;
            toast.hidden = true;
          }, Math.max(1200, durationMs || 2000));
          timers.add(toastTimer);
        }
      }

      function syncConnection(nextState) {
        connectionState = typeof nextState === "string" ? nextState : "connecting";
        const normalised = connectionState.toLowerCase();
        let label = "Connecting";
        let state = "connecting";
        if (normalised === "connected") {
          label = "Connected";
          state = "connected";
        } else if (normalised === "disconnected" || normalised === "closed") {
          label = "Disconnected";
          state = "disconnected";
        } else if (normalised === "reconnecting") {
          label = "Reconnecting";
          state = "connecting";
        }
        connectionBadge.dataset.state = state;
        connectionLabel.textContent = label;
        connectionBadge.setAttribute("aria-label", `PocketArcade connection: ${label}`);
      }

      function setFullscreenState(fullscreen) {
        const active = Boolean(fullscreen);
        root.classList.toggle("is-fullscreen", active);
        fullscreenButton.hidden = active;
        resultExitButton.hidden = !active;
        scheduleLayoutSync();
      }

      function visibleViewportSize() {
        const viewport = window.visualViewport;
        return {
          width: Math.max(1, Math.round(
            (viewport && viewport.width) ||
            window.innerWidth ||
            document.documentElement.clientWidth ||
            1
          )),
          height: Math.max(1, Math.round(
            (viewport && viewport.height) ||
            window.innerHeight ||
            document.documentElement.clientHeight ||
            1
          ))
        };
      }

      function syncLayout() {
        if (disposed) return;
        const viewport = visibleViewportSize();
        if (viewport.width !== lastViewportWidth) {
          lastViewportWidth = viewport.width;
          root.style.setProperty("--pa-visible-width", `${viewport.width}px`);
        }
        if (viewport.height !== lastViewportHeight) {
          lastViewportHeight = viewport.height;
          root.style.setProperty("--pa-visible-height", `${viewport.height}px`);
        }

        const rootRect = root.getBoundingClientRect();
        const availableHeight = root.classList.contains("is-fullscreen")
          ? viewport.height
          : Math.max(320, Math.floor(viewport.height - Math.max(0, rootRect.top)));
        if (availableHeight !== lastAvailableHeight) {
          lastAvailableHeight = availableHeight;
          root.style.setProperty("--pb-available-height", `${availableHeight}px`);
        }

        if (gameView.hidden || stage.hidden) return;
        const rect = boardViewport.getBoundingClientRect();
        const gutter = root.classList.contains("is-height-very-tight") ? 8 : 16;
        const availableWidth = Math.max(0, Math.floor(rect.width - gutter));
        const availableBoardHeight = Math.max(0, Math.floor(rect.height - gutter));
        if (!availableWidth || !availableBoardHeight) return;

        const boardWidth = Math.max(70, Math.floor(Math.min(
          360,
          availableWidth,
          availableBoardHeight * FIELD_ASPECT
        )));
        const boardHeight = Math.max(140, Math.floor(Math.min(
          720,
          boardWidth / FIELD_ASPECT,
          availableBoardHeight
        )));
        const correctedWidth = Math.floor(boardHeight * FIELD_ASPECT);
        if (correctedWidth !== lastBoardWidth || boardHeight !== lastBoardHeight) {
          lastBoardWidth = correctedWidth;
          lastBoardHeight = boardHeight;
          boardWrap.style.setProperty("--pb-board-width", `${correctedWidth}px`);
          boardWrap.style.setProperty("--pb-board-height", `${boardHeight}px`);
        }
        drawBoard(board, ownPlayer() || { cells: "" });
      }

      function scheduleLayoutSync() {
        if (disposed || layoutFrame) return;
        layoutFrame = window.requestAnimationFrame(() => {
          layoutFrame = 0;
          syncLayout();
        });
      }

      function updateResponsiveStates() {
        const viewport = visibleViewportSize();
        root.classList.toggle("is-height-tight", viewport.height < 720);
        root.classList.toggle("is-height-very-tight", viewport.height < 600);
        root.classList.toggle("is-height-ultra-tight", viewport.height < 430);
        root.classList.toggle("is-width-tight", viewport.width < 430);
        root.classList.toggle(
          "is-short-landscape",
          viewport.width > viewport.height && viewport.height < 560
        );
      }

      function onLayoutChange() {
        updateResponsiveStates();
        scheduleLayoutSync();
      }

      window.addEventListener("resize", onLayoutChange, { passive: true });
      window.addEventListener("orientationchange", onLayoutChange, { passive: true });
      const visualViewport = window.visualViewport;
      if (visualViewport) {
        visualViewport.addEventListener("resize", onLayoutChange, { passive: true });
        visualViewport.addEventListener("scroll", onLayoutChange, { passive: true });
      }
      if (typeof ResizeObserver === "function") {
        layoutObserver = new ResizeObserver(scheduleLayoutSync);
        layoutObserver.observe(root);
        layoutObserver.observe(boardViewport);
      }
      updateResponsiveStates();
      scheduleLayoutSync();

      function sendActionNow(action, data) {
        if (!matchState || !matchState.matchId || !canControl() || disposed) return false;
        const sent = arcade.game.send(matchState.matchId, action, data || {});
        if (!sent) showToast("Unable to send that control.", "error", 2000);
        return sent;
      }

      function clearInputState() {
        held.clear();
        pendingActions.length = 0;
        activePointers.clear();
        heldCursor = 0;
        if (inputTimer !== null) {
          window.clearTimeout(inputTimer);
          timers.delete(inputTimer);
          inputTimer = null;
        }
      }

      function scheduleInputPump(delayMs) {
        if (inputTimer !== null || disposed) return;
        inputTimer = window.setTimeout(runInputPump, Math.max(0, delayMs));
        timers.add(inputTimer);
      }

      function runInputPump() {
        if (inputTimer !== null) {
          timers.delete(inputTimer);
          inputTimer = null;
        }
        if (!canControl() || disposed) {
          clearInputState();
          return;
        }

        const now = window.performance && typeof window.performance.now === "function"
          ? window.performance.now()
          : Date.now();
        const remaining = COMMAND_INTERVAL_MS - (now - lastCommandSentAt);
        if (remaining > 0) {
          scheduleInputPump(remaining);
          return;
        }

        let next = pendingActions.shift() || null;
        if (!next && held.size) {
          const actions = [...held];
          const action = actions[heldCursor % actions.length];
          heldCursor = (heldCursor + 1) % actions.length;
          next = { action, data: {} };
        }
        if (next && sendActionNow(next.action, next.data)) {
          lastCommandSentAt = now;
        }
        if (pendingActions.length || held.size) {
          scheduleInputPump(COMMAND_INTERVAL_MS);
        }
      }

      function sendAction(action, data) {
        if (!canControl() || disposed) return false;
        if (pendingActions.length >= MAX_PENDING_ACTIONS) return false;
        pendingActions.push({ action, data: data || {} });
        scheduleInputPump(0);
        return true;
      }

      function sendOneShot(action, data) {
        const now = window.performance && typeof window.performance.now === "function"
          ? window.performance.now()
          : Date.now();
        const interval = action === "hard-drop"
          ? HARD_DROP_DEBOUNCE_MS
          : ONE_SHOT_DEBOUNCE_MS;
        const previous = lastOneShotAt.get(action);
        if (Number.isFinite(previous) && now - previous < interval) return false;
        if (pendingActions.some((entry) => entry.action === action)) return false;
        if (!sendAction(action, data)) return false;
        lastOneShotAt.set(action, now);
        return true;
      }

      function retireMatch(matchId) {
        if (!matchId || retiredMatchIds.has(matchId)) return;
        retiredMatchIds.add(matchId);
        retiredMatchOrder.push(matchId);
        while (retiredMatchOrder.length > MAX_RETIRED_MATCHES) {
          retiredMatchIds.delete(retiredMatchOrder.shift());
        }
      }

      function clearMatchState(retireCurrent) {
        if (retireCurrent && matchState && matchState.matchId) {
          retireMatch(matchState.matchId);
        }
        matchState = null;
        snapshotEnvelope = null;
        resultEnvelope = null;
        latestSnapshotRevision = -1;
        runtimeFailed = false;
        runtimeFailureMessage = "";
        clearInputState();
      }

      function renderPlayers() {
        opponents.replaceChildren();
        const state = payload();
        const gamePlayers = state && Array.isArray(state.players) ? state.players : [];
        const gamePlayersBySeat = new Map(gamePlayers.map((player) => [player.seat, player]));
        const seats = matchState && Array.isArray(matchState.seats) ? matchState.seats : [];
        const localSeat = ownSeat();
        const platformWaiting = Boolean(matchState && matchState.state === "waiting");

        const occupied = seats
          .filter((seat) => seat && seat.player)
          .map((seat) => {
            const gamePlayer = gamePlayersBySeat.get(seat.seat);
            return {
              seat: seat.seat,
              ready: Boolean(seat.ready),
              connected: seat.connected !== false,
              player: gamePlayer || {
                seat: seat.seat,
                nickname: seat.player.nickname || "Player",
                avatarUrl: seat.player.avatarUrl || "",
                alive: true,
                score: 0,
                lines: 0,
                pendingGarbage: 0
              }
            };
          });

        for (const gamePlayer of gamePlayers) {
          if (!occupied.some((entry) => entry.seat === gamePlayer.seat)) {
            occupied.push({
              seat: gamePlayer.seat,
              ready: false,
              connected: gamePlayer.connected !== false,
              player: gamePlayer
            });
          }
        }

        occupied.sort((a, b) => {
          if (a.seat === localSeat) return -1;
          if (b.seat === localSeat) return 1;
          return a.seat - b.seat;
        });

        for (const entry of occupied) {
          const player = entry.player;
          const item = element("div", `pb-opponent seat-${entry.seat}`);
          if (entry.seat === localSeat) item.classList.add("is-self");
          if (entry.connected === false) item.classList.add("is-disconnected");
          const info = element("div", "pb-player-info");
          const nameRow = element("div", "pb-player-name-row");
          nameRow.append(element("div", "pb-player-name", displayName(player)));
          nameRow.append(element(
            "span",
            "pb-player-badge",
            entry.seat === localSeat ? "YOU" : `P${entry.seat}`
          ));
          const knockedOut = player.alive === false &&
            (state && (state.phase === "playing" || state.phase === "finished"));
          let metaText;
          if (knockedOut) {
            metaText = "Knocked out";
          } else if (state && (state.phase === "playing" || state.phase === "finished")) {
            metaText = `${player.lines || 0} lines · ${player.score || 0} pts`;
          } else if (entry.connected === false) {
            metaText = "Reconnecting";
          } else {
            metaText = entry.ready ? "Ready ✓" : "Getting ready";
          }
          const meta = element("div", "pb-player-meta", metaText);
          if (knockedOut) meta.classList.add("is-out");
          info.append(nameRow, meta);
          item.append(makeAvatar(player), info);
          opponents.append(item);
        }

        if (platformWaiting) {
          for (const seat of seats) {
            if (!seat || seat.player) continue;
            const item = element("div", `pb-open-seat seat-${seat.seat}`);
            const seatMark = element("div", "pb-open-seat-mark", "+");
            const info = element("div", "pb-player-info");
            info.append(
              element("div", "pb-player-name", "Open Seat"),
              element("div", "pb-player-meta", "Waiting for a player")
            );
            item.append(seatMark, info);
            opponents.append(item);
          }
        }

        const spectators = matchState && Array.isArray(matchState.spectators)
          ? matchState.spectators
          : [];
        if (!platformWaiting) {
          for (const spectator of spectators) {
            const spectatorPlayer = {
              nickname: spectator.nickname || "Spectator",
              avatarUrl: spectator.avatarUrl || ""
            };
            const item = element("div", "pb-spectator");
            const info = element("div", "pb-player-info");
            info.append(element("div", "pb-player-name", displayName(spectatorPlayer)));
            item.append(makeAvatar(spectatorPlayer), info);
            opponents.append(item);
          }
        }

        if (!opponents.children.length) {
          opponents.append(element("div", "pb-empty-players", "Waiting for the first player."));
        }
      }

      function resultPayload() {
        return resultEnvelope && resultEnvelope.payload &&
          typeof resultEnvelope.payload === "object"
          ? resultEnvelope.payload
          : null;
      }

      function resultWinnerName() {
        const result = resultPayload();
        const placements = result && Array.isArray(result.placements) ? result.placements : [];
        const winner = placements.find((placement) => placement.place === 1);
        return winner && winner.nickname ? winner.nickname : null;
      }

      function renderResultPlacements() {
        resultPlacements.replaceChildren();
        const result = resultPayload();
        const placements = result && Array.isArray(result.placements)
          ? [...result.placements].sort((a, b) => a.place - b.place || a.seat - b.seat)
          : [];
        for (const placement of placements) {
          const row = element("div", "pb-result-row");
          const place = placement.place === 1 ? "★" : String(placement.place);
          const placeNode = element("span", "pb-result-place", place);
          const nameNode = element("span", "pb-result-name", placement.nickname || "Player");
          const wins = Number.isFinite(placement.wins) ? placement.wins : 0;
          const winsNode = element("span", "pb-result-wins", `${wins} win${wins === 1 ? "" : "s"}`);
          row.append(placeNode, nameNode, winsNode);
          resultPlacements.append(row);
        }
      }

      function render() {
        const state = payload();
        const me = ownPlayer();
        const role = matchState && matchState.you ? matchState.you.role : "none";
        const platformPhase = matchState ? matchState.state : "none";
        const gamePhase = state ? state.phase : "waiting";
        const finished = isFinished();
        const controller = Boolean(matchState && matchState.you && matchState.you.controller);
        const isStartScreen = !matchState;
        const isActivePlay = Boolean(
          matchState && !finished && platformPhase === "playing" &&
          (gamePhase === "countdown" || gamePhase === "playing")
        );

        splash.hidden = !isStartScreen;
        gameView.hidden = isStartScreen;
        root.classList.toggle("is-start-screen", isStartScreen);
        root.classList.toggle("is-match-view", !isStartScreen);
        root.classList.toggle("is-lobby", Boolean(matchState && !isActivePlay && !finished));
        root.classList.toggle("is-active-play", isActivePlay);
        root.classList.toggle("is-finished", finished);
        root.classList.toggle("is-spectator", role === "spectator");
        root.classList.toggle("is-observer", role === "player" && !controller);
        root.classList.toggle("is-actionable", canControl());
        root.classList.toggle("needs-control-claim", Boolean(
          matchState && !finished && gamePhase === "playing" &&
          role === "player" && !controller
        ));
        root.dataset.phase = finished ? "finished" : gamePhase;

        splashJoinButton.disabled = joinPending || !splashAssetReady;
        splashJoinButton.textContent = joinPending
          ? "Joining…"
          : splashAssetReady ? "Join game" : "Loading artwork…";

        const ownMatchSeat = matchState && Array.isArray(matchState.seats)
          ? matchState.seats.find((seat) => seat.seat === ownSeat())
          : null;
        const alreadyReady = Boolean(ownMatchSeat && ownMatchSeat.ready);
        readyButton.hidden = !matchState || role !== "player" || platformPhase !== "waiting";
        readyButton.disabled = alreadyReady;
        readyButton.textContent = alreadyReady ? "Ready ✓" : "Ready";
        claimButton.hidden = !matchState || role !== "player" || controller || finished;
        leaveButton.hidden = !matchState || finished;
        actions.hidden = finished ||
          (readyButton.hidden && claimButton.hidden && leaveButton.hidden);

        const enabled = canControl();
        const showGameControls = Boolean(
          matchState && role === "player" && !finished &&
          gamePhase === "playing" && me && me.alive !== false
        );
        controls.hidden = !showGameControls;
        for (const control of [leftButton, rotateButton, rightButton, downButton, dropButton]) {
          control.disabled = !enabled;
          control.setAttribute("aria-disabled", enabled ? "false" : "true");
        }

        boardOverlay.hidden = false;
        resultPlacements.hidden = true;
        resultActions.hidden = true;
        overlaySymbol.textContent = "◆";
        overlayKicker.textContent = "POCKETBLOCKS";

        if (!matchState) {
          setStatus("Choose Join game to play.", "");
        } else if (runtimeFailed) {
          setStatus("Game runtime stopped", "error");
          controlKicker.textContent = "GAME STOPPED";
          controlTitle.textContent = "Start a fresh match";
          controlHint.textContent = "PocketArcade contained the rules error safely.";
          overlaySymbol.textContent = "!";
          overlayKicker.textContent = "RUNTIME STOPPED";
          overlayTitle.textContent = "PocketBlocks stopped safely";
          overlayText.textContent = runtimeFailureMessage || "Check the device log, then start a new match.";
          resultActions.hidden = false;
        } else if (finished) {
          const winner = resultWinnerName();
          setStatus(winner ? `${winner} wins` : "Battle finished", "ok");
          controlKicker.textContent = "RESULT";
          controlTitle.textContent = winner ? `${winner} wins` : "Round complete";
          controlHint.textContent = "The validated placements are shown on the board.";
          overlaySymbol.textContent = "★";
          overlayKicker.textContent = "ROUND COMPLETE";
          overlayTitle.textContent = winner ? `${winner} wins!` : "Battle finished";
          overlayText.textContent = "Final placements and recorded wins";
          renderResultPlacements();
          resultPlacements.hidden = false;
          resultActions.hidden = false;
        } else if (role === "spectator") {
          setStatus("Spectating battle", "");
          controlKicker.textContent = "SPECTATING";
          controlTitle.textContent = "Watch the stack rise";
          controlHint.textContent = "Spectators can follow the action but cannot send controls.";
          if (gamePhase === "playing") {
            boardOverlay.hidden = true;
          } else {
            overlayTitle.textContent = "Battle starting soon";
            overlayText.textContent = "The players are getting ready.";
          }
        } else if (!controller) {
          setStatus("Controls active in another tab", "");
          controlKicker.textContent = "CONTROL";
          controlTitle.textContent = "Watching your seat";
          controlHint.textContent = "Use Take control to play from this screen.";
          if (gamePhase === "playing") {
            boardOverlay.hidden = true;
          } else {
            overlayTitle.textContent = "Ready on another screen";
            overlayText.textContent = "Take control here when you want to play.";
          }
        } else if (platformPhase === "waiting") {
          const occupied = Array.isArray(matchState.seats)
            ? matchState.seats.filter((seat) => seat.player).length
            : 0;
          setStatus(
            occupied < 2 ? "Waiting for another player" :
              alreadyReady ? "Ready — waiting for rivals" : "Ready up when prepared",
            alreadyReady ? "ok" : ""
          );
          controlKicker.textContent = alreadyReady ? "READY" : "NEXT STEP";
          controlTitle.textContent = alreadyReady ? "Waiting for rivals" : "Ready up";
          controlHint.textContent = alreadyReady
            ? "The round begins when every occupied seat is ready."
            : "Press Ready below when you are set to play.";
          overlaySymbol.textContent = occupied < 2 ? "2+" : "✓";
          overlayKicker.textContent = "MATCH LOBBY";
          overlayTitle.textContent = occupied < 2 ? "Waiting for rivals" : "Ready when you are";
          overlayText.textContent = occupied < 2
            ? "At least two players are needed to begin."
            : "Every occupied seat must be ready.";
        } else if (gamePhase === "countdown") {
          const count = Math.max(1, Math.ceil((state.countdownMs || 0) / 1000));
          setStatus(`Starting in ${count}`, "ok");
          controlKicker.textContent = "GET READY";
          controlTitle.textContent = `Starting in ${count}`;
          controlHint.textContent = "Your controls unlock when the countdown ends.";
          overlaySymbol.textContent = String(count);
          overlayKicker.textContent = "GET READY";
          overlayTitle.textContent = "Build fast";
          overlayText.textContent = "Keep the stack low and attack with big clears.";
        } else if (gamePhase === "playing") {
          const knockedOut = me && me.alive === false;
          setStatus(knockedOut ? "Knocked out — spectating" : "Battle in progress", knockedOut ? "" : "ok");
          if (knockedOut) {
            controlKicker.textContent = "KNOCKED OUT";
            controlTitle.textContent = "Watch the finish";
            controlHint.textContent = "Your board is locked while the remaining players battle.";
            overlaySymbol.textContent = "×";
            overlayKicker.textContent = "BATTLE OVER";
            overlayTitle.textContent = "Knocked out";
            overlayText.textContent = "Stay to see the final result.";
          } else {
            controlKicker.textContent = enabled ? "YOUR CONTROLS" : "WAITING";
            controlTitle.textContent = enabled ? "Build fast" : "Controls unavailable";
            controlHint.textContent = enabled
              ? "Move, rotate and drop. Big clears send garbage to every rival."
              : "Take control from the active tab to continue.";
            boardOverlay.hidden = true;
          }
        } else {
          setStatus("Preparing battle", "");
          controlKicker.textContent = "PREPARING";
          controlTitle.textContent = "Setting the board";
          controlHint.textContent = "The next authoritative state will start the round.";
          overlayTitle.textContent = "Preparing battle";
          overlayText.textContent = "Setting every board for the round.";
        }

        resultExitButton.hidden = !Boolean(arcade.display && arcade.display.fullscreen);
        if (matchState) {
          drawBoard(board, me || { cells: "" });
          score.textContent = `Score ${me ? me.score || 0 : 0}`;
          lines.textContent = `Lines ${me ? me.lines || 0 : 0}`;
          garbage.textContent = `Garbage ${me ? me.pendingGarbage || 0 : 0}`;
          renderPlayers();
        }

        const visiblePlayers = state && Array.isArray(state.players)
          ? state.players.length
          : matchState && Array.isArray(matchState.seats)
            ? matchState.seats.filter((seat) => seat.player).length
            : 0;
        playerCount.textContent = visiblePlayers
          ? `${visiblePlayers} of 4 joined`
          : "Waiting for players";
        updateResponsiveStates();
        scheduleLayoutSync();
      }

      function beginHeld(action) {
        if (held.has(action) || !canControl()) return;
        held.add(action);
        scheduleInputPump(0);
      }

      function endHeld(action) {
        held.delete(action);
        if (!held.size && !pendingActions.length && inputTimer !== null) {
          window.clearTimeout(inputTimer);
          timers.delete(inputTimer);
          inputTimer = null;
        }
      }

      function bindPress(control, action, repeat) {
        const down = (event) => {
          event.preventDefault();
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (activePointers.has(action)) return;
          if (repeat) {
            const now = window.performance && typeof window.performance.now === "function"
              ? window.performance.now()
              : Date.now();
            const previous = lastRepeatPressAt.get(action);
            if (Number.isFinite(previous) && now - previous < REPEAT_PRESS_DEBOUNCE_MS) return;
            lastRepeatPressAt.set(action, now);
          }
          activePointers.set(action, event.pointerId);
          try {
            control.setPointerCapture(event.pointerId);
          } catch (_) {
            // Pointer capture is optional on older embedded browsers.
          }
          if (repeat) beginHeld(action);
          else sendOneShot(action, {});
        };
        const up = (event) => {
          const pointerId = activePointers.get(action);
          if (pointerId !== event.pointerId) return;
          event.preventDefault();
          activePointers.delete(action);
          endHeld(action);
          try {
            if (control.hasPointerCapture(event.pointerId)) {
              control.releasePointerCapture(event.pointerId);
            }
          } catch (_) {
            // Ignore browsers without complete pointer-capture support.
          }
        };
        control.addEventListener("pointerdown", down);
        control.addEventListener("pointerup", up);
        control.addEventListener("pointercancel", up);
        control.addEventListener("lostpointercapture", up);
        return () => {
          control.removeEventListener("pointerdown", down);
          control.removeEventListener("pointerup", up);
          control.removeEventListener("pointercancel", up);
          control.removeEventListener("lostpointercapture", up);
        };
      }

      const unbindControls = [
        bindPress(leftButton, "left", true),
        bindPress(rightButton, "right", true),
        bindPress(downButton, "soft-drop", true),
        bindPress(rotateButton, "rotate-cw", false),
        bindPress(dropButton, "hard-drop", false)
      ];

      const repeatedKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowDown"]);
      const onKeyDown = (event) => {
        const actionsByKey = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowDown: "soft-drop",
          ArrowUp: "rotate-cw",
          x: "rotate-cw",
          X: "rotate-cw",
          z: "rotate-ccw",
          Z: "rotate-ccw",
          " ": "hard-drop"
        };
        const action = actionsByKey[event.key];
        if (!action) return;
        event.preventDefault();
        if (repeatedKeys.has(event.key)) {
          if (!event.repeat) beginHeld(action);
        } else if (!event.repeat) {
          sendOneShot(action, {});
        }
      };
      const onKeyUp = (event) => {
        if (!repeatedKeys.has(event.key)) return;
        event.preventDefault();
        const actionsByKey = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowDown: "soft-drop"
        };
        endHeld(actionsByKey[event.key]);
      };
      const onVisibilityChange = () => {
        if (document.hidden) clearInputState();
      };
      const onWindowBlur = () => clearInputState();
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", onWindowBlur);

      function requestJoin(errorMessage) {
        clearMatchState(true);
        lastCommandSentAt = -COMMAND_INTERVAL_MS;
        lastOneShotAt.clear();
        lastRepeatPressAt.clear();
        joinPending = true;
        if (!arcade.game.join(APP_ID)) {
          joinPending = false;
          showToast(errorMessage, "error", 2400);
        }
        render();
      }

      fullscreenButton.addEventListener("click", () => {
        if (!arcade.display || typeof arcade.display.requestFullscreen !== "function") return;
        if (!arcade.display.fullscreen) arcade.display.requestFullscreen();
      });

      splashJoinButton.addEventListener("click", () => {
        requestJoin("Unable to request a match.");
      });

      resultAgainButton.addEventListener("click", () => {
        if (arcade.display && typeof arcade.display.exitFullscreen === "function") {
          arcade.display.exitFullscreen();
        }
        requestJoin("Unable to request a new match.");
      });

      resultExitButton.addEventListener("click", () => {
        if (arcade.display && typeof arcade.display.exitFullscreen === "function") {
          arcade.display.exitFullscreen();
        }
      });

      readyButton.addEventListener("click", () => {
        if (!matchState) return;
        const sent = arcade.game.ready(matchState.matchId);
        if (!sent) {
          showToast("Unable to mark ready.", "error", 2200);
          return;
        }
        if (arcade.display && typeof arcade.display.requestFullscreen === "function" &&
            !arcade.display.fullscreen) {
          arcade.display.requestFullscreen();
        }
      });

      claimButton.addEventListener("click", () => {
        if (!matchState || !arcade.game.claimControl(matchState.matchId)) {
          showToast("Unable to take control.", "error", 2200);
        }
      });

      leaveButton.addEventListener("click", () => {
        if (!matchState || !arcade.game.leave(matchState.matchId)) {
          showToast("Unable to leave the match.", "error", 2200);
          return;
        }
        if (arcade.display && typeof arcade.display.exitFullscreen === "function") {
          arcade.display.exitFullscreen();
        }
      });

      stops.push(arcade.game.onMatch((nextMatch) => {
        if (!nextMatch || !nextMatch.matchId) return;
        if (retiredMatchIds.has(nextMatch.matchId)) return;
        const role = nextMatch.you && nextMatch.you.role;
        const previousMatchId = matchState && matchState.matchId;
        const previouslyController = Boolean(
          matchState && matchState.you && matchState.you.controller
        );
        if (role === "none") {
          if (!matchState || nextMatch.matchId === matchState.matchId) {
            retireMatch(nextMatch.matchId);
            clearMatchState(false);
            joinPending = false;
            render();
          }
          return;
        }
        if (matchState && nextMatch.matchId !== matchState.matchId) {
          if (!joinPending) return;
          clearMatchState(true);
        }
        if (!matchState) {
          snapshotEnvelope = null;
          resultEnvelope = null;
          latestSnapshotRevision = -1;
        }
        matchState = nextMatch;
        joinPending = false;
        runtimeFailed = false;
        runtimeFailureMessage = "";
        if (role !== "player" || !nextMatch.you.controller ||
            nextMatch.state !== "playing") {
          clearInputState();
        }
        if (nextMatch.state !== "finished" &&
            nextMatch.you && nextMatch.you.controller &&
            (nextMatch.matchId !== previousMatchId || !previouslyController)) {
          arcade.game.requestSnapshot(nextMatch.matchId);
        }
        render();
      }));

      stops.push(arcade.game.onSnapshot((nextSnapshot) => {
        if (!nextSnapshot || nextSnapshot.appId !== APP_ID ||
            !matchState || nextSnapshot.matchId !== matchState.matchId) return;
        if (Number.isFinite(nextSnapshot.revision) &&
            nextSnapshot.revision < latestSnapshotRevision) return;
        if (Number.isFinite(nextSnapshot.revision)) {
          latestSnapshotRevision = nextSnapshot.revision;
        }
        snapshotEnvelope = nextSnapshot;
        render();
      }));

      stops.push(arcade.game.onEvent((event) => {
        if (!event || !matchState || event.matchId !== matchState.matchId) return;
        if (event.name) {
          const text = String(event.name).replace(/[_-]+/g, " ");
          showToast(text.charAt(0).toUpperCase() + text.slice(1), "ok", 1600);
        }
      }));

      stops.push(arcade.game.onResult((result) => {
        if (!result || !matchState || result.matchId !== matchState.matchId) return;
        resultEnvelope = result;
        clearInputState();
        render();
      }));

      stops.push(arcade.game.onError((error) => {
        if (error && error.matchId &&
            (!matchState || error.matchId !== matchState.matchId)) return;
        if (!error || !error.matchId) joinPending = false;
        if (error && (error.code === "rate_limited" || error.code === "queue_full")) {
          clearInputState();
        }
        if (error && error.code === "match_not_found") {
          if (matchState) retireMatch(matchState.matchId);
          clearMatchState(false);
          joinPending = false;
          showToast("That match has closed. Join a fresh match.", "error", 2800);
          render();
          return;
        }
        if (error && error.code === "runtime_failed") {
          runtimeFailed = true;
          runtimeFailureMessage = error.message
            ? String(error.message)
            : "Check the PocketArcade device log, then start a new match.";
          clearInputState();
          showToast("PocketBlocks stopped safely.", "error", 2600);
          render();
          return;
        }
        showToast(
          error && error.message ? String(error.message) : "Game operation rejected.",
          "error",
          2400
        );
        render();
      }));

      stops.push(arcade.onConnection((connection) => {
        syncConnection(connection);
        if (connection !== "connected") clearInputState();
      }));

      if (arcade.display && typeof arcade.display.onFullscreenChange === "function") {
        stops.push(arcade.display.onFullscreenChange(setFullscreenState));
        setFullscreenState(arcade.display.fullscreen);
      } else {
        fullscreenButton.hidden = true;
        resultExitButton.hidden = true;
      }

      syncConnection(connectionState);
      if (matchState && matchState.matchId && matchState.state !== "finished") {
        arcade.game.requestSnapshot(matchState.matchId);
      }
      render();

      return () => {
        disposed = true;
        for (const stop of stops) stop();
        for (const unbind of unbindControls) unbind();
        clearInputState();
        for (const timer of timers) window.clearTimeout(timer);
        timers.clear();
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("resize", onLayoutChange);
        window.removeEventListener("orientationchange", onLayoutChange);
        if (visualViewport) {
          visualViewport.removeEventListener("resize", onLayoutChange);
          visualViewport.removeEventListener("scroll", onLayoutChange);
        }
        if (layoutObserver) layoutObserver.disconnect();
        layoutObserver = null;
        if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
        layoutFrame = 0;
        if (arcade.display && typeof arcade.display.exitFullscreen === "function") {
          arcade.display.exitFullscreen();
        }
        container.replaceChildren();
      };
    }
  };
})();

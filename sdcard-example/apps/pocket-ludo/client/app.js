"use strict";

(() => {
  const APP_ID = "pocket-ludo";
  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;

  const TRACK = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
    [0, 7],
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
    [7, 14],
    [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
    [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
    [14, 7],
    [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
    [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    [7, 0],
    [6, 0],
  ];

  const HOME_LANES = {
    1: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    2: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    3: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    4: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
  };

  const START_OFFSET = {1: 0, 2: 13, 3: 26, 4: 39};
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const SEAT_NAMES = {1: "Coral", 2: "Emerald", 3: "Gold", 4: "Violet"};
  const SEAT_THEME = {
    1: {base: "#ef5d67", dark: "#b62f49", soft: "#ffd3d0", softStroke: "#f3a4a9", innerStroke: "#efb6ba", slotFill: "#ffe8ea", slotStroke: "#e98e96", trackFill: "#f49aa4", trackStroke: "#c84659", arrowStroke: "#9f293e", pawnShadow: "rgba(182, 47, 73, 0.35)"},
    2: {base: "#21b88c", dark: "#08775f", soft: "#c8f6df", softStroke: "#62cea6", innerStroke: "#8cdab9", slotFill: "#e6fff3", slotStroke: "#74d3b0", trackFill: "#75dec0", trackStroke: "#0d8c6f", arrowStroke: "#06614f", pawnShadow: "rgba(8, 119, 95, 0.35)"},
    3: {base: "#f5b83d", dark: "#b66d08", soft: "#fff0ae", softStroke: "#f1c649", innerStroke: "#f0d778", slotFill: "#fff8d6", slotStroke: "#e9c16a", trackFill: "#ffd970", trackStroke: "#c58411", arrowStroke: "#926009", pawnShadow: "rgba(182, 109, 8, 0.35)"},
    4: {base: "#8067ed", dark: "#5136b6", soft: "#ded6ff", softStroke: "#9b86f3", innerStroke: "#beb2fb", slotFill: "#f1edff", slotStroke: "#baa8fa", trackFill: "#b3a0ff", trackStroke: "#694ed8", arrowStroke: "#4d34aa", pawnShadow: "rgba(81, 54, 182, 0.35)"},
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CELL = 60;
  const MARGIN = 50;

  function html(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
      node.setAttribute(key, String(value));
    });
    return node;
  }

  function cellCentre(row, col) {
    return {
      x: MARGIN + (col + 0.5) * CELL,
      y: MARGIN + (row + 0.5) * CELL,
    };
  }

  function yardSlotCentres(seat) {
    const quadrant = {
      1: {x: MARGIN, y: MARGIN},
      2: {x: MARGIN + 9 * CELL, y: MARGIN},
      3: {x: MARGIN + 9 * CELL, y: MARGIN + 9 * CELL},
      4: {x: MARGIN, y: MARGIN + 9 * CELL},
    }[seat] || {x: MARGIN, y: MARGIN};
    const innerX = quadrant.x + 62;
    const innerY = quadrant.y + 62;
    const innerSize = 6 * CELL - 124;
    const inset = 68;
    const x1 = innerX + inset;
    const x2 = innerX + innerSize - inset;
    const y1 = innerY + inset;
    const y2 = innerY + innerSize - inset;
    return [
      {x: x1, y: y1},
      {x: x2, y: y1},
      {x: x1, y: y2},
      {x: x2, y: y2},
    ];
  }

  function initials(name) {
    const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return (words.slice(0, 2).map((word) => word[0]).join("") || "?").toUpperCase();
  }

  function clonePlayers(players) {
    const result = {};
    (players || []).forEach((player) => {
      result[player.seat] = {
        ...player,
        pawns: Array.isArray(player.pawns) ? player.pawns.slice(0, 4) : [-1, -1, -1, -1],
      };
    });
    return result;
  }

  function normaliseSnapshot(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    return {
      version: Number(source.version) || 1,
      status: String(source.status || "waiting"),
      turnSeat: Number(source.turnSeat) || null,
      turnNumber: Number(source.turnNumber) || 0,
      phase: String(source.phase || "waiting"),
      dice: Number(source.dice) || 0,
      legalMoves: Array.isArray(source.legalMoves) ? source.legalMoves.map(Number) : [],
      winnerSeat: Number(source.winnerSeat) || null,
      eventSeq: Number(source.eventSeq) || 0,
      players: Array.isArray(source.players) ? source.players : [],
      rules: source.rules || {},
    };
  }

  window.PocketArcadeApps = window.PocketArcadeApps || {};

  window.PocketArcadeApps[APP_ID] = {
    mount(container, arcade) {
      let activeMatch = null;
      let latestSnapshotRevision = -1;
      let authoritative = null;
      let displayPlayers = {};
      let result = null;
      let destroyed = false;
      let animating = false;
      let latestEventSeq = 0;
      let eventQueue = [];
      let lastMatchState = null;
      let toastTimer = null;
      let diceFaceInterval = null;
      let diceAnimating = false;
      let celebrationTimer = null;
      const animations = new Set();
      const timers = new Set();
      const pendingWaits = new Map();
      const unsubscribers = [];

      const root = html("section", "pocket-ludo");
      root.style.setProperty("--ludo-icon", `url(${JSON.stringify(iconUrl).slice(1, -1)})`);

      const topbar = html("header", "pocket-ludo__topbar");
      const brand = html("div", "pocket-ludo__brand");
      const brandIcon = document.createElement("img");
      brandIcon.className = "pocket-ludo__brand-icon";
      brandIcon.src = iconUrl;
      brandIcon.alt = "";
      const brandText = html("div", "pocket-ludo__brand-copy");
      brandText.append(
        html("strong", "pocket-ludo__title", "Pocket Ludo"),
        html("span", "pocket-ludo__subtitle", "Race. Bounce. Bring everyone home.")
      );
      brand.append(brandIcon, brandText);

      const topActions = html("div", "pocket-ludo__top-actions");
      const connectionBadge = html("span", "pocket-ludo__connection", arcade.connectionStatus || "connecting");
      const fullscreenButton = html("button", "pocket-ludo__icon-button", "⛶");
      fullscreenButton.type = "button";
      fullscreenButton.title = "Toggle fullscreen";
      fullscreenButton.setAttribute("aria-label", "Toggle fullscreen");
      topActions.append(connectionBadge, fullscreenButton);
      topbar.append(brand, topActions);

      const layout = html("div", "pocket-ludo__layout");
      const playerRail = html("aside", "pocket-ludo__players");
      playerRail.setAttribute("aria-label", "Players");

      const arena = html("main", "pocket-ludo__arena");
      const boardShell = html("div", "pocket-ludo__board-shell");
      const boardSvg = svg("svg", {
        class: "pocket-ludo__board",
        viewBox: "0 0 1000 1000",
        role: "img",
        "aria-label": "Pocket Ludo game board",
      });
      const pawnLayer = svg("g", {class: "pocket-ludo__pawn-layer"});
      buildBoard(boardSvg, pawnLayer);

      const toast = html("div", "pocket-ludo__toast");
      toast.setAttribute("aria-live", "polite");

      const waitingOverlay = html("div", "pocket-ludo__overlay pocket-ludo__overlay--waiting");
      const waitingCard = html("div", "pocket-ludo__overlay-card");
      const waitingIcon = document.createElement("img");
      waitingIcon.src = iconUrl;
      waitingIcon.alt = "";
      waitingIcon.className = "pocket-ludo__overlay-icon";
      const waitingTitle = html("h2", "pocket-ludo__overlay-title", "Gather your rivals");
      const waitingText = html("p", "pocket-ludo__overlay-text", "Join with 2–4 players, then everyone presses Ready.");
      waitingCard.append(waitingIcon, waitingTitle, waitingText);
      waitingOverlay.append(waitingCard);

      const victoryOverlay = html("div", "pocket-ludo__overlay pocket-ludo__overlay--victory");
      const victoryCard = html("div", "pocket-ludo__overlay-card pocket-ludo__victory-card");
      const trophy = html("div", "pocket-ludo__trophy", "♛");
      const victoryTitle = html("h2", "pocket-ludo__overlay-title", "Home champion!");
      const victoryText = html("p", "pocket-ludo__overlay-text", "A flawless trip around the board.");
      const newGameButton = html("button", "pocket-ludo__primary-button", "Play another match");
      newGameButton.type = "button";
      victoryCard.append(trophy, victoryTitle, victoryText, newGameButton);
      victoryOverlay.append(victoryCard);

      boardShell.append(boardSvg, toast, waitingOverlay, victoryOverlay);
      arena.append(boardShell);

      const controlPanel = html("section", "pocket-ludo__controls");
      const diceWrap = html("div", "pocket-ludo__dice-wrap");
      const diceButton = html("button", "pocket-ludo__dice");
      diceButton.type = "button";
      diceButton.setAttribute("aria-label", "Roll dice");
      const diceFace = svg("svg", {class: "pocket-ludo__dice-face", viewBox: "0 0 100 100", "aria-hidden": "true"});
      const dicePlaceholder = svg("circle", {class: "pocket-ludo__dice-placeholder", cx: 50, cy: 50, r: 19});
      diceFace.append(dicePlaceholder);
      const diceDots = [];
      [
        [22, 22], [50, 22], [78, 22],
        [22, 50], [50, 50], [78, 50],
        [22, 78], [50, 78], [78, 78],
      ].forEach(([cx, cy], index) => {
        const pip = svg("circle", {class: `pocket-ludo__dice-dot dot-${index + 1}`, cx, cy, r: 8});
        diceFace.append(pip);
        diceDots.push(pip);
      });
      diceButton.append(diceFace);
      const diceCaption = html("span", "pocket-ludo__dice-caption", "Roll the dice");
      const diceRule = html("span", "pocket-ludo__dice-rule", "Roll a 6 to release a pawn");
      diceWrap.append(diceButton, diceCaption, diceRule);

      const instruction = html("div", "pocket-ludo__instruction");
      const instructionTitle = html("strong", "pocket-ludo__instruction-title", "Join a match to play");
      const instructionText = html("span", "pocket-ludo__instruction-text", "Four pawns. One colourful race home.");
      instruction.append(instructionTitle, instructionText);

      const pawnButtons = html("div", "pocket-ludo__pawn-buttons");
      for (let pawn = 1; pawn <= 4; pawn += 1) {
        const button = html("button", "pocket-ludo__pawn-button", String(pawn));
        button.type = "button";
        button.dataset.pawnChoice = String(pawn);
        button.setAttribute("aria-label", `Move pawn ${pawn}`);
        pawnButtons.append(button);
      }
      controlPanel.append(diceWrap, instruction, pawnButtons);

      const lobbyBar = html("footer", "pocket-ludo__lobby-bar");
      const joinButton = html("button", "pocket-ludo__primary-button", "Join game");
      joinButton.type = "button";
      const readyButton = html("button", "pocket-ludo__primary-button", "Ready up");
      readyButton.type = "button";
      const claimButton = html("button", "pocket-ludo__secondary-button", "Take control");
      claimButton.type = "button";
      const leaveButton = html("button", "pocket-ludo__secondary-button", "Leave match");
      leaveButton.type = "button";
      const roleStatus = html("span", "pocket-ludo__role-status", "Not in a match");
      lobbyBar.append(roleStatus, joinButton, readyButton, claimButton, leaveButton);

      layout.append(playerRail, arena);
      root.append(topbar, layout, controlPanel, lobbyBar);
      container.replaceChildren(root);

      function registerTimer(callback, delayMs) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          callback();
        }, delayMs);
        timers.add(timer);
        return timer;
      }

      function wait(delayMs) {
        return new Promise((resolve) => {
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            pendingWaits.delete(timer);
            resolve();
          }, delayMs);
          timers.add(timer);
          pendingWaits.set(timer, resolve);
        });
      }

      function cancelVisualWork() {
        timers.forEach((timer) => {
          window.clearTimeout(timer);
          const resolve = pendingWaits.get(timer);
          if (resolve) resolve();
        });
        timers.clear();
        pendingWaits.clear();
        animations.forEach((animation) => {
          try { animation.cancel(); } catch (_) { /* no-op */ }
        });
        animations.clear();
        if (toastTimer) window.clearTimeout(toastTimer);
        if (diceFaceInterval) window.clearInterval(diceFaceInterval);
        if (celebrationTimer) window.clearTimeout(celebrationTimer);
        toastTimer = null;
        diceFaceInterval = null;
        diceAnimating = false;
        diceWrap.classList.remove("is-rolling");
        celebrationTimer = null;
        eventQueue = [];
        animating = false;
      }

      function showToast(message, kind = "normal", duration = 1700) {
        toast.textContent = message;
        toast.dataset.kind = kind;
        toast.classList.add("is-visible");
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
          toast.classList.remove("is-visible");
          toastTimer = null;
        }, duration);
      }

      function playerName(seat) {
        const matchSeat = activeMatch?.seats?.find((entry) => entry.seat === seat);
        return matchSeat?.player?.nickname || displayPlayers[seat]?.nickname || `${SEAT_NAMES[seat] || "Player"} player`;
      }

      function currentSeatReady() {
        const seat = Number(activeMatch?.you?.seat);
        return Boolean(activeMatch?.seats?.find((entry) => entry.seat === seat)?.ready);
      }

      function canAct() {
        return Boolean(
          activeMatch &&
          activeMatch.state === "playing" &&
          activeMatch.you?.role === "player" &&
          activeMatch.you?.controller &&
          authoritative &&
          !animating &&
          !result
        );
      }

      function isMyTurn() {
        return canAct() && Number(activeMatch.you.seat) === authoritative.turnSeat;
      }

      function sendMove(pawn) {
        if (!isMyTurn() || authoritative.phase !== "move" || !authoritative.legalMoves.includes(pawn)) return;
        arcade.game.send(activeMatch.matchId, "move", {pawn});
      }

      function updateConnection(status) {
        const next = String(status || "unknown");
        connectionBadge.textContent = next;
        connectionBadge.dataset.status = next;
      }

      function renderPlayers() {
        playerRail.replaceChildren();
        const seats = activeMatch?.seats || [];
        const state = String(activeMatch?.state || "waiting");
        const showOpenSeats = state === "waiting" || state === "countdown";

        const entries = [];
        for (let seatNumber = 1; seatNumber <= 4; seatNumber += 1) {
          const seat = seats.find((entry) => entry.seat === seatNumber) || null;
          if (seat?.player || showOpenSeats) {
            entries.push({kind: "seat", seatNumber, seat});
          }
        }
        if (!showOpenSeats) {
          (activeMatch?.spectators || []).forEach((spectator, index) => {
            entries.push({kind: "spectator", spectator, spectatorIndex: index});
          });
        }

        entries.forEach((entry) => {
          if (entry.kind === "spectator") {
            const spectator = entry.spectator;
            const card = html("article", "pocket-ludo__player-card is-spectator");
            const avatar = html("div", "pocket-ludo__avatar");
            if (spectator?.avatarUrl) {
              const image = document.createElement("img");
              image.src = spectator.avatarUrl;
              image.alt = "";
              image.addEventListener("error", () => image.remove(), {once: true});
              avatar.append(image);
            }
            avatar.append(html("span", "pocket-ludo__avatar-fallback", initials(spectator?.nickname || `S${entry.spectatorIndex + 1}`)));
            const copy = html("div", "pocket-ludo__player-copy");
            copy.append(
              html("strong", "pocket-ludo__player-name", spectator?.nickname || "Spectator"),
              html("span", "pocket-ludo__player-details", "Spectator")
            );
            const marker = html("span", "pocket-ludo__seat-marker", "👁");
            card.append(avatar, copy, marker);
            playerRail.append(card);
            return;
          }

          const seatNumber = entry.seatNumber;
          const seat = entry.seat;
          const card = html("article", `pocket-ludo__player-card seat-${seatNumber}`);
          if (authoritative?.turnSeat === seatNumber && activeMatch?.state === "playing") {
            card.classList.add("is-current");
          }
          if (!seat?.player) card.classList.add("is-empty");

          const avatar = html("div", "pocket-ludo__avatar");
          if (seat?.player?.avatarUrl) {
            const image = document.createElement("img");
            image.src = seat.player.avatarUrl;
            image.alt = "";
            image.addEventListener("error", () => image.remove(), {once: true});
            avatar.append(image);
          }
          avatar.append(html("span", "pocket-ludo__avatar-fallback", initials(seat?.player?.nickname || "Open Seat")));

          const copy = html("div", "pocket-ludo__player-copy");
          const name = html("strong", "pocket-ludo__player-name", seat?.player?.nickname || "Open Seat");
          const details = html("span", "pocket-ludo__player-details");
          if (seat?.player) {
            const homes = displayPlayers[seatNumber]?.pawns?.filter((value) => value === 57).length || 0;
            details.textContent = activeMatch.state === "waiting"
              ? (seat.ready ? "Ready to race" : "Getting ready")
              : `${homes}/4 home${seat.connected === false ? " · reconnecting" : ""}`;
          } else {
            details.textContent = "Waiting for a player";
          }
          copy.append(name, details);

          const marker = html("span", "pocket-ludo__seat-marker", String(seatNumber));
          if (seat?.ready && activeMatch?.state === "waiting") marker.textContent = "✓";
          if (!seat?.player) marker.textContent = "+";
          card.append(avatar, copy, marker);
          playerRail.append(card);
        });
      }

      function yardPosition(seat, pawn) {
        const centres = yardSlotCentres(seat);
        return centres[pawn - 1] || {x: 500, y: 500};
      }

      function homePosition(seat, pawn) {
        const centres = {
          1: [[447, 452], [499, 452], [447, 503], [499, 503]],
          2: [[548, 447], [548, 499], [497, 447], [497, 499]],
          3: [[553, 548], [501, 548], [553, 497], [501, 497]],
          4: [[452, 553], [452, 501], [503, 553], [503, 501]],
        };
        const point = centres[seat]?.[pawn - 1] || [500, 500];
        return {x: point[0], y: point[1]};
      }

      function rawPosition(seat, pawn, progress) {
        if (progress === -1 || !Number.isFinite(progress)) return yardPosition(seat, pawn);
        if (progress >= 0 && progress <= 51) {
          const global = (START_OFFSET[seat] + progress) % 52;
          const cell = TRACK[global];
          return cellCentre(cell[0], cell[1]);
        }
        if (progress >= 52 && progress <= 56) {
          const cell = HOME_LANES[seat][progress - 52];
          return cellCentre(cell[0], cell[1]);
        }
        return homePosition(seat, pawn);
      }

      function stackOffsets() {
        const groups = new Map();
        Object.values(displayPlayers).forEach((player) => {
          player.pawns.forEach((progress, index) => {
            if (progress === -1 || progress === 57) return;
            const position = rawPosition(player.seat, index + 1, progress);
            const key = `${Math.round(position.x)}:${Math.round(position.y)}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(`${player.seat}:${index + 1}`);
          });
        });

        const offsets = {};
        groups.forEach((members) => {
          const radius = members.length > 1 ? Math.min(17, 7 + members.length * 2) : 0;
          members.forEach((member, index) => {
            const angle = (Math.PI * 2 * index) / members.length - Math.PI / 2;
            offsets[member] = {
              x: Math.cos(angle) * radius,
              y: Math.sin(angle) * radius,
            };
          });
        });
        return offsets;
      }

      function pawnPosition(seat, pawn, progress, offsets = null) {
        const base = rawPosition(seat, pawn, progress);
        const offset = offsets?.[`${seat}:${pawn}`] || {x: 0, y: 0};
        return {x: base.x + offset.x, y: base.y + offset.y};
      }

      function createPawn(seat, pawn, progress, position) {
        const group = svg("g", {
          class: `pocket-ludo__pawn seat-${seat}`,
          transform: `translate(${position.x} ${position.y})`,
          "data-seat": seat,
          "data-pawn": pawn,
          role: "button",
          "aria-label": `${playerName(seat)} pawn ${pawn}`,
        });

        const visual = svg("g", {class: "pocket-ludo__pawn-visual"});
        const shadow = svg("ellipse", {class: "pocket-ludo__pawn-shadow", cx: 0, cy: 19, rx: 22, ry: 8});
        const body = svg("path", {
          class: "pocket-ludo__pawn-body",
          d: "M-23 17 C-22 5 -17 -4 -9 -10 C-14 -15 -15 -22 -12 -28 C-9 -35 -3 -39 5 -38 C13 -37 18 -31 18 -23 C18 -17 15 -12 10 -9 C19 -3 23 7 24 17 C24 23 18 27 11 27 H-10 C-18 27 -23 23 -23 17 Z",
        });
        const highlight = svg("path", {
          class: "pocket-ludo__pawn-highlight",
          d: "M-5 -29 C-2 -33 4 -34 8 -31 C3 -31 0 -27 -1 -22 C-3 -17 -7 -14 -11 -13 C-8 -18 -8 -24 -5 -29 Z",
        });
        const label = svg("text", {class: "pocket-ludo__pawn-label", x: 1, y: 17, "text-anchor": "middle"});
        label.textContent = String(pawn);
        visual.append(shadow, body, highlight, label);
        group.append(visual);

        const legal = isMyTurn() && authoritative?.phase === "move" && authoritative.legalMoves.includes(pawn) && Number(activeMatch.you.seat) === seat;
        if (legal) group.classList.add("is-legal");
        if (progress === 57) group.classList.add("is-home");
        return group;
      }

      function renderPawns() {
        pawnLayer.replaceChildren();
        const offsets = stackOffsets();
        Object.values(displayPlayers)
          .sort((a, b) => a.seat - b.seat)
          .forEach((player) => {
            player.pawns.forEach((progress, index) => {
              const pawn = index + 1;
              const position = pawnPosition(player.seat, pawn, progress, offsets);
              pawnLayer.append(createPawn(player.seat, pawn, progress, position));
            });
          });
      }

      function paintDice(value) {
        const numeric = Number(value);
        const valid = numeric >= 1 && numeric <= 6;
        const pattern = valid ? ({
          1: [5],
          2: [1, 9],
          3: [1, 5, 9],
          4: [1, 3, 7, 9],
          5: [1, 3, 5, 7, 9],
          6: [1, 3, 4, 6, 7, 9],
        }[numeric] || []) : [];
        dicePlaceholder.classList.toggle("is-visible", !valid);
        diceDots.forEach((dot, index) => {
          dot.classList.toggle("is-on", valid && pattern.includes(index + 1));
        });
        diceButton.dataset.value = valid ? String(numeric) : "pending";
        diceButton.setAttribute("aria-label", valid
          ? `Dice showing ${numeric}`
          : "Dice not yet rolled");
      }

      function setDice(value) {
        if (!diceAnimating) paintDice(value);
      }

      async function animateDice(value) {
        const finalValue = Math.max(1, Math.min(6, Number(value) || 1));
        if (diceFaceInterval) window.clearInterval(diceFaceInterval);
        diceFaceInterval = null;
        diceAnimating = true;
        diceWrap.classList.add("is-rolling");

        let frame = 0;
        paintDice(((finalValue + 2) % 6) + 1);
        diceFaceInterval = window.setInterval(() => {
          frame += 1;
          paintDice(((finalValue + frame * 5) % 6) + 1);
        }, 72);

        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        try {
          await animateElement(diceFace, reducedMotion ? [
            {transform: "scale(1)"},
            {transform: "scale(1.12)"},
            {transform: "scale(1)"},
          ] : [
            {transform: "rotate(0deg) scale(1)"},
            {transform: "rotate(92deg) scale(1.2)", offset: 0.22},
            {transform: "rotate(205deg) scale(.88)", offset: 0.5},
            {transform: "rotate(315deg) scale(1.14)", offset: 0.78},
            {transform: "rotate(360deg) scale(1)"},
          ], {
            duration: reducedMotion ? 180 : 620,
            easing: "cubic-bezier(.2,.82,.2,1)",
          });
        } finally {
          if (diceFaceInterval) window.clearInterval(diceFaceInterval);
          diceFaceInterval = null;
          diceAnimating = false;
          diceWrap.classList.remove("is-rolling");
          paintDice(finalValue);
        }
      }

      function renderControls() {
        const joined = Boolean(activeMatch && activeMatch.you?.role !== "none");
        const player = activeMatch?.you?.role === "player";
        const waiting = activeMatch?.state === "waiting";
        const playing = activeMatch?.state === "playing";
        const finished = activeMatch?.state === "finished" || Boolean(result);
        const controller = Boolean(activeMatch?.you?.controller);
        const myTurn = isMyTurn();
        const mySeat = Number(activeMatch?.you?.seat);
        const turnPlayer = authoritative?.turnSeat ? playerName(authoritative.turnSeat) : null;
        const myPlayerState = authoritative?.players?.find((entry) => Number(entry.seat) === mySeat);
        const allMyPawnsInYard = Boolean(
          player &&
          Array.isArray(myPlayerState?.pawns) &&
          myPlayerState.pawns.every((progress) => Number(progress) === -1)
        );
        const needsStartingSix = Boolean(
          playing && myTurn && authoritative?.phase === "roll" && allMyPawnsInYard
        );

        joinButton.hidden = joined;
        readyButton.hidden = !joined || !player || !waiting || currentSeatReady();
        claimButton.hidden = !joined || !player || controller || finished;
        leaveButton.hidden = !joined;

        if (!joined) {
          roleStatus.textContent = "Choose Join to enter the next match";
        } else if (activeMatch.you.role === "spectator") {
          roleStatus.textContent = "Watching as spectator";
        } else if (!controller) {
          roleStatus.textContent = "Another tab controls your seat";
        } else if (waiting) {
          roleStatus.textContent = currentSeatReady() ? "Ready — waiting for rivals" : "Joined — ready when you are";
        } else if (finished) {
          roleStatus.textContent = "Match complete";
        } else {
          roleStatus.textContent = `Playing as ${SEAT_NAMES[mySeat] || `seat ${mySeat}`}`;
        }

        waitingOverlay.classList.toggle("is-visible", !playing && !finished);
        victoryOverlay.classList.toggle("is-visible", finished && Boolean(result || authoritative?.winnerSeat));

        if (!joined) {
          waitingTitle.textContent = "Gather your rivals";
          waitingText.textContent = "Join with 2–4 players, then everyone presses Ready.";
        } else if (activeMatch.you.role === "spectator") {
          waitingTitle.textContent = "Spectator seat";
          waitingText.textContent = "The next match begins when the players are ready.";
        } else if (waiting) {
          waitingTitle.textContent = currentSeatReady() ? "You’re ready" : "Ready to race?";
          waitingText.textContent = currentSeatReady()
            ? "Waiting for every occupied seat to press Ready."
            : "Press Ready when your rivals have joined.";
        }

        const canRoll = Boolean(myTurn && authoritative?.phase === "roll");
        diceButton.disabled = false;
        diceButton.classList.toggle("is-disabled", !canRoll);
        diceButton.setAttribute("aria-disabled", canRoll ? "false" : "true");
        controlPanel.classList.toggle("is-active-turn", Boolean(myTurn && controller && player && playing));
        diceWrap.classList.toggle("needs-six", needsStartingSix);
        if (needsStartingSix) {
          diceCaption.textContent = "ROLL A 6 TO START";
          diceRule.textContent = "A six releases your first pawn from the yard";
        } else if (myTurn && authoritative?.phase === "roll") {
          diceCaption.textContent = "Your roll";
          diceRule.textContent = "Roll a 6 to release another pawn";
        } else {
          diceCaption.textContent = authoritative?.dice ? `Rolled ${authoritative.dice}` : "Roll the dice";
          diceRule.textContent = "A 6 releases a pawn from the yard";
        }
        setDice(authoritative?.dice || 0);

        const choiceButtons = pawnButtons.querySelectorAll("button[data-pawn-choice]");
        choiceButtons.forEach((button) => {
          const pawn = Number(button.dataset.pawnChoice);
          const legal = myTurn && authoritative?.phase === "move" && authoritative.legalMoves.includes(pawn);
          button.disabled = !legal;
          button.classList.toggle("is-legal", legal);
        });

        if (!joined) {
          instructionTitle.textContent = "Join a match to play";
          instructionText.textContent = "Four pawns. One colourful race home.";
        } else if (!playing) {
          instructionTitle.textContent = currentSeatReady() ? "Ready and waiting" : "Bring in your rivals";
          instructionText.textContent = "The match starts when all occupied seats are ready.";
        } else if (authoritative) {
          if (!controller && player) {
            instructionTitle.textContent = "Control is open in another tab";
            instructionText.textContent = "Take control here to roll and move.";
          } else if (!myTurn) {
            instructionTitle.textContent = `${turnPlayer || "Another player"} is moving`;
            instructionText.textContent = "Watch the board — your turn is coming.";
          } else if (authoritative.phase === "roll") {
            instructionTitle.textContent = allMyPawnsInYard ? "Roll a 6 to start" : "Roll the dice";
            instructionText.textContent = allMyPawnsInYard
              ? "Your pawns stay in the yard until you roll a six."
              : "A six releases another pawn and earns another turn.";
          } else if (authoritative.phase === "move") {
            const choices = authoritative.legalMoves.length;
            instructionTitle.textContent = choices > 1 ? "Choose a glowing pawn" : "Moving your only available pawn";
            instructionText.textContent = choices > 1
              ? "Tap a glowing pawn on the board to choose your move."
              : "This move is automatic when there is no decision to make.";
          } else {
            instructionTitle.textContent = "Race in progress";
            instructionText.textContent = "First to bring all four pawns home wins.";
          }
        }

        renderPlayers();
        if (!animating) renderPawns();
      }

      function applyAuthoritativeDisplay() {
        if (!authoritative) {
          displayPlayers = {};
        } else {
          displayPlayers = clonePlayers(authoritative.players);
        }
        renderControls();
      }

      async function animateElement(element, keyframes, options) {
        if (!element || destroyed) return;
        if (typeof element.animate !== "function") {
          const finalFrame = keyframes[keyframes.length - 1];
          if (finalFrame.transform) element.setAttribute("transform", finalFrame.transform.replace(/translate\(([^,]+),?\s*([^\)]+)\)/, "translate($1 $2)"));
          await wait(options.duration || 0);
          return;
        }
        const animation = element.animate(keyframes, options);
        animations.add(animation);
        try {
          await animation.finished;
        } catch (_) {
          // Animation cancellation is expected during cleanup or match changes.
        } finally {
          animations.delete(animation);
        }
      }

      function pawnElement(seat, pawn) {
        return pawnLayer.querySelector(`[data-seat="${seat}"][data-pawn="${pawn}"]`);
      }

      async function animateMove(payload) {
        const seat = Number(payload.seat);
        const pawn = Number(payload.pawn);
        const path = Array.isArray(payload.path) ? payload.path.map(Number) : [];
        if (!displayPlayers[seat]) return;

        displayPlayers[seat].pawns[pawn - 1] = Number(payload.from);
        renderPawns();
        let element = pawnElement(seat, pawn);
        let current = pawnPosition(seat, pawn, Number(payload.from));

        for (let index = 0; index < path.length; index += 1) {
          const progress = path[index];
          const target = pawnPosition(seat, pawn, progress);
          const midX = (current.x + target.x) / 2;
          const midY = Math.min(current.y, target.y) - 24;
          await animateElement(element, [
            {transform: `translate(${current.x}px, ${current.y}px) scale(1)`},
            {transform: `translate(${midX}px, ${midY}px) scale(1.18)`, offset: 0.52},
            {transform: `translate(${target.x}px, ${target.y}px) scale(1)`},
          ], {
            duration: 165,
            easing: "cubic-bezier(.2,.82,.25,1)",
            fill: "forwards",
          });
          current = target;
          if (element) element.setAttribute("transform", `translate(${target.x} ${target.y})`);
          displayPlayers[seat].pawns[pawn - 1] = progress;
          if (destroyed) return;
        }
        renderPawns();
      }

      async function animateCapture(payload) {
        const victimSeat = Number(payload.victimSeat);
        const victimPawn = Number(payload.victimPawn);
        const attackerSeat = Number(payload.attackerSeat);
        if (!displayPlayers[victimSeat]) return;

        const reportedFrom = Number(payload.victimFrom);
        if (Number.isFinite(reportedFrom)) {
          displayPlayers[victimSeat].pawns[victimPawn - 1] = reportedFrom;
          renderPawns();
        }
        const element = pawnElement(victimSeat, victimPawn);
        const fromProgress = displayPlayers[victimSeat].pawns[victimPawn - 1];
        const from = pawnPosition(victimSeat, victimPawn, fromProgress);
        const target = yardPosition(victimSeat, victimPawn);
        showToast(`${playerName(attackerSeat)} sends ${playerName(victimSeat)} home!`, "capture", 2200);
        boardShell.classList.add("is-impacting");

        await animateElement(element, [
          {transform: `translate(${from.x}px, ${from.y}px) rotate(0deg) scale(1)`, opacity: 1},
          {transform: `translate(${from.x}px, ${from.y - 55}px) rotate(160deg) scale(1.35)`, opacity: 1, offset: 0.35},
          {transform: `translate(${target.x}px, ${target.y}px) rotate(720deg) scale(.7)`, opacity: 0.35},
          {transform: `translate(${target.x}px, ${target.y}px) rotate(720deg) scale(1)`, opacity: 1},
        ], {
          duration: 720,
          easing: "cubic-bezier(.16,.78,.25,1)",
          fill: "forwards",
        });

        boardShell.classList.remove("is-impacting");
        displayPlayers[victimSeat].pawns[victimPawn - 1] = -1;
        renderPawns();
      }

      function burstAt(position, seat, count = 14) {
        const burst = html("div", `pocket-ludo__burst seat-${seat}`);
        burst.style.left = `${(position.x / 1000) * 100}%`;
        burst.style.top = `${(position.y / 1000) * 100}%`;
        for (let index = 0; index < count; index += 1) {
          const piece = html("i", "pocket-ludo__burst-piece");
          const angle = (Math.PI * 2 * index) / count;
          const distance = 55 + (index % 4) * 14;
          piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
          piece.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
          piece.style.setProperty("--delay", `${(index % 5) * 18}ms`);
          burst.append(piece);
        }
        boardShell.append(burst);
        registerTimer(() => burst.remove(), 1050);
      }

      async function animateSafeLanding(payload) {
        const seat = Number(payload.seat);
        const pawn = Number(payload.pawn);
        const square = Number(payload.square);
        const cell = TRACK[square];
        if (!cell || !SAFE.has(square)) return;

        const position = cellCentre(cell[0], cell[1]);
        const tile = boardSvg.querySelector(`[data-square="${square}"]`);
        if (tile) tile.classList.add("is-safe-landing");

        const effect = svg("g", {
          class: `pocket-ludo__safe-effect seat-${seat}`,
          transform: `translate(${position.x} ${position.y})`,
          "aria-hidden": "true",
        });
        const visual = svg("g", {class: "pocket-ludo__safe-effect-visual"});
        visual.append(
          svg("circle", {class: "pocket-ludo__safe-effect-ring ring-outer", cx: 0, cy: 0, r: 31}),
          svg("circle", {class: "pocket-ludo__safe-effect-ring ring-inner", cx: 0, cy: 0, r: 20}),
          svg("path", {class: "pocket-ludo__safe-shield", d: "M0 -25 C11 -20 19 -18 26 -17 V-1 C26 17 15 30 0 37 C-15 30 -26 17 -26 -1 V-17 C-19 -18 -11 -20 0 -25 Z"}),
          svg("path", {class: "pocket-ludo__safe-shield-star", d: "M0 -13 L5 -3 L16 -2 L8 6 L10 17 L0 12 L-10 17 L-8 6 L-16 -2 L-5 -3 Z"})
        );
        effect.append(visual);
        boardSvg.append(effect);

        showToast(`${playerName(seat)} is safe!`, "safe", 1350);
        const element = pawnElement(seat, pawn);
        if (element) element.classList.add("is-safe-celebrating");

        await wait(920);
        if (tile) tile.classList.remove("is-safe-landing");
        if (element) element.classList.remove("is-safe-celebrating");
        effect.remove();
      }

      async function animateHome(payload) {
        const seat = Number(payload.seat);
        const pawn = Number(payload.pawn);
        const position = homePosition(seat, pawn);
        showToast(`${playerName(seat)} brings pawn ${pawn} home!`, "home", 2200);
        burstAt(position, seat, 18);
        const element = pawnElement(seat, pawn);
        if (element) {
          await animateElement(element, [
            {transform: `translate(${position.x}px, ${position.y}px) scale(1)`},
            {transform: `translate(${position.x}px, ${position.y - 16}px) scale(1.45)`, offset: 0.42},
            {transform: `translate(${position.x}px, ${position.y}px) scale(1)`},
          ], {duration: 620, easing: "cubic-bezier(.22,.9,.26,1)", fill: "forwards"});
        } else {
          await wait(620);
        }
      }

      function launchConfetti(seat) {
        root.querySelectorAll(".pocket-ludo__confetti").forEach((node) => node.remove());
        const layer = html("div", `pocket-ludo__confetti seat-${seat}`);
        for (let index = 0; index < 56; index += 1) {
          const piece = html("i", "pocket-ludo__confetti-piece");
          piece.style.left = `${(index * 37) % 100}%`;
          piece.style.setProperty("--delay", `${(index % 12) * 70}ms`);
          piece.style.setProperty("--drift", `${((index % 9) - 4) * 18}px`);
          piece.style.setProperty("--spin", `${180 + (index % 7) * 90}deg`);
          layer.append(piece);
        }
        root.append(layer);
        if (celebrationTimer) window.clearTimeout(celebrationTimer);
        celebrationTimer = window.setTimeout(() => {
          layer.remove();
          celebrationTimer = null;
        }, 5200);
      }

      async function handleGameEvent(event) {
        const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
        switch (event.name) {
          case "dice":
            showToast(`${playerName(Number(payload.seat))} rolls ${Number(payload.value)}`, "dice", 1200);
            await animateDice(Number(payload.value));
            break;
          case "move":
            await animateMove(payload);
            break;
          case "safe":
            await animateSafeLanding(payload);
            break;
          case "capture":
            await animateCapture(payload);
            break;
          case "home":
            await animateHome(payload);
            break;
          case "no_move":
            showToast(`No legal move for ${playerName(Number(payload.seat))}`, "normal", 1500);
            boardShell.classList.add("is-no-move");
            await wait(430);
            boardShell.classList.remove("is-no-move");
            break;
          case "turn":
            if (payload.extra) showToast(`${playerName(Number(payload.seat))} gets another turn`, "extra", 1400);
            await wait(payload.extra ? 260 : 80);
            break;
          case "player_left":
            showToast("A player left — their pawns return to the box", "normal", 1800);
            await wait(250);
            break;
          case "victory":
            launchConfetti(Number(payload.seat));
            showToast(`${playerName(Number(payload.seat))} wins!`, "home", 2800);
            await wait(520);
            break;
          default:
            break;
        }
      }

      async function processEventQueue() {
        if (animating || destroyed) return;
        animating = true;
        renderControls();
        while (eventQueue.length && !destroyed) {
          const event = eventQueue.shift();
          const seq = Number(event.payload?.seq) || 0;
          if (seq && seq <= latestEventSeq) continue;
          await handleGameEvent(event);
          if (seq) latestEventSeq = seq;
        }
        animating = false;
        if (!destroyed) applyAuthoritativeDisplay();
      }

      function clearMatchState() {
        cancelVisualWork();
        activeMatch = null;
        latestSnapshotRevision = -1;
        authoritative = null;
        displayPlayers = {};
        result = null;
        latestEventSeq = 0;
        lastMatchState = null;
        victoryOverlay.classList.remove("is-visible");
        root.querySelectorAll(".pocket-ludo__confetti").forEach((node) => node.remove());
        renderControls();
      }

      function acceptMatch(match) {
        if (match.you?.role === "none") {
          if (!activeMatch || match.matchId === activeMatch.matchId) clearMatchState();
          return;
        }

        if (!activeMatch || match.matchId !== activeMatch.matchId) {
          clearMatchState();
          activeMatch = match;
        } else {
          activeMatch = match;
        }

        if (match.state === "playing" && lastMatchState !== "playing") {
          arcade.game.requestSnapshot(match.matchId);
        }
        lastMatchState = match.state;
        renderControls();
      }

      function showResult(nextResult) {
        result = nextResult;
        const placements = Array.isArray(nextResult.payload?.placements) ? nextResult.payload.placements : [];
        const winner = placements.find((placement) => placement.place === 1);
        const winnerSeat = Number(winner?.seat) || authoritative?.winnerSeat || 0;
        victoryTitle.textContent = winnerSeat ? `${playerName(winnerSeat)} wins!` : "Match complete!";
        victoryText.textContent = winnerSeat
          ? `All four ${SEAT_NAMES[winnerSeat] || "winning"} pawns made it home.`
          : "The final result has been recorded.";
        victoryOverlay.classList.add("is-visible");
        if (winnerSeat) launchConfetti(winnerSeat);
        renderControls();
      }

      joinButton.addEventListener("click", () => arcade.game.join(APP_ID));
      readyButton.addEventListener("click", () => {
        if (!activeMatch) return;
        arcade.display.requestFullscreen();
        arcade.game.ready(activeMatch.matchId);
      });
      claimButton.addEventListener("click", () => {
        if (activeMatch) arcade.game.claimControl(activeMatch.matchId);
      });
      leaveButton.addEventListener("click", () => {
        if (activeMatch) arcade.game.leave(activeMatch.matchId);
        arcade.display.exitFullscreen();
      });
      newGameButton.addEventListener("click", () => arcade.game.join(APP_ID));
      fullscreenButton.addEventListener("click", () => {
        if (arcade.display.fullscreen) arcade.display.exitFullscreen();
        else arcade.display.requestFullscreen();
      });
      diceButton.addEventListener("click", () => {
        if (isMyTurn() && authoritative?.phase === "roll") {
          arcade.game.send(activeMatch.matchId, "roll", {});
        }
      });
      pawnButtons.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-pawn-choice]");
        if (button) sendMove(Number(button.dataset.pawnChoice));
      });
      boardSvg.addEventListener("click", (event) => {
        const pawn = event.target.closest("[data-pawn]");
        if (!pawn) return;
        const seat = Number(pawn.getAttribute("data-seat"));
        if (seat !== Number(activeMatch?.you?.seat)) return;
        sendMove(Number(pawn.getAttribute("data-pawn")));
      });

      function onKeydown(event) {
        if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.code === "Space") {
          if (isMyTurn() && authoritative?.phase === "roll") {
            event.preventDefault();
            arcade.game.send(activeMatch.matchId, "roll", {});
          }
          return;
        }
        if (/^Digit[1-4]$/.test(event.code)) {
          sendMove(Number(event.code.slice(-1)));
        }
      }

      function onVisibilityChange() {
        if (document.hidden) {
          animations.forEach((animation) => {
            try { animation.finish(); } catch (_) { /* no-op */ }
          });
        }
      }

      document.addEventListener("keydown", onKeydown);
      document.addEventListener("visibilitychange", onVisibilityChange);

      unsubscribers.push(
        arcade.onConnection((status) => updateConnection(status)),
        arcade.display.onFullscreenChange((fullscreen) => {
          root.classList.toggle("fullscreen", fullscreen);
          fullscreenButton.textContent = fullscreen ? "↙" : "⛶";
          fullscreenButton.setAttribute("aria-label", fullscreen ? "Exit fullscreen" : "Enter fullscreen");
        }),
        arcade.game.onMatch((match) => acceptMatch(match)),
        arcade.game.onSnapshot((snapshot) => {
          if (!activeMatch || snapshot.matchId !== activeMatch.matchId) return;
          const revision = Number(snapshot.revision);
          if (!Number.isFinite(revision) || revision < latestSnapshotRevision) return;
          latestSnapshotRevision = revision;
          authoritative = normaliseSnapshot(snapshot.payload);
          if (!animating && eventQueue.length === 0) applyAuthoritativeDisplay();
          else renderControls();
        }),
        arcade.game.onEvent((event) => {
          if (!activeMatch || event.matchId !== activeMatch.matchId) return;
          const seq = Number(event.payload?.seq) || 0;
          if (seq && seq <= latestEventSeq) return;
          eventQueue.push(event);
          processEventQueue();
        }),
        arcade.game.onResult((nextResult) => {
          if (!activeMatch || nextResult.matchId !== activeMatch.matchId) return;
          showResult(nextResult);
        }),
        arcade.game.onError((error) => {
          if (error.matchId && (!activeMatch || error.matchId !== activeMatch.matchId)) return;
          if (error.code === "match_not_found") {
            clearMatchState();
            showToast("That match has closed. Join a new one.", "normal", 2400);
            return;
          }
          if (error.code === "runtime_failed") {
            cancelVisualWork();
            showToast("The game runtime stopped. Join a fresh match.", "capture", 3000);
          } else if (error.code === "rate_limited" || error.code === "queue_full") {
            showToast("Input is busy — give it a moment.", "normal", 1700);
          } else {
            showToast(error.message || "Game command rejected", "normal", 2200);
          }
          renderControls();
        })
      );

      updateConnection(arcade.connectionStatus);
      root.classList.toggle("fullscreen", Boolean(arcade.display.fullscreen));
      const cachedMatch = arcade.game.currentMatch();
      if (cachedMatch && cachedMatch.you?.role !== "none") {
        acceptMatch(cachedMatch);
        const cachedSnapshot = arcade.game.currentSnapshot();
        if (cachedSnapshot && cachedSnapshot.matchId === cachedMatch.matchId) {
          latestSnapshotRevision = Number(cachedSnapshot.revision) || -1;
          authoritative = normaliseSnapshot(cachedSnapshot.payload);
          applyAuthoritativeDisplay();
        } else if (cachedMatch.state !== "finished") {
          arcade.game.requestSnapshot(cachedMatch.matchId);
        }
      } else {
        renderControls();
      }

      return () => {
        destroyed = true;
        cancelVisualWork();
        document.removeEventListener("keydown", onKeydown);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        unsubscribers.forEach((unsubscribe) => {
          try { unsubscribe(); } catch (_) { /* no-op */ }
        });
        arcade.display.exitFullscreen();
        activeMatch = null;
        authoritative = null;
        displayPlayers = {};
        result = null;
        container.replaceChildren();
      };
    },
  };

  function buildBoard(board, pawnLayer) {
    const defs = svg("defs");
    const shadow = svg("filter", {id: "pocket-ludo-tile-shadow", x: "-20%", y: "-20%", width: "140%", height: "160%"});
    shadow.append(
      svg("feDropShadow", {dx: 0, dy: 5, stdDeviation: 5, "flood-color": "#0f172a", "flood-opacity": 0.18})
    );
    defs.append(shadow);
    board.append(defs);

    board.append(svg("rect", {class: "pocket-ludo__board-bg", x: 20, y: 20, width: 960, height: 960, rx: 64}));
    board.append(svg("rect", {class: "pocket-ludo__board-inner", x: 38, y: 38, width: 924, height: 924, rx: 50}));

    const quadrants = [
      {seat: 1, x: MARGIN, y: MARGIN},
      {seat: 2, x: MARGIN + 9 * CELL, y: MARGIN},
      {seat: 3, x: MARGIN + 9 * CELL, y: MARGIN + 9 * CELL},
      {seat: 4, x: MARGIN, y: MARGIN + 9 * CELL},
    ];

    quadrants.forEach(({seat, x, y}) => {
      const theme = SEAT_THEME[seat];
      const group = svg("g", {class: `pocket-ludo__yard seat-${seat}`});
      group.append(
        svg("rect", {class: "pocket-ludo__yard-outer", x: x + 6, y: y + 6, width: 6 * CELL - 12, height: 6 * CELL - 12, rx: 54, fill: theme.soft, stroke: theme.base, "stroke-width": 8}),
        svg("rect", {class: "pocket-ludo__yard-inner", x: x + 62, y: y + 62, width: 6 * CELL - 124, height: 6 * CELL - 124, rx: 44, fill: "rgba(255,255,255,0.78)", stroke: theme.innerStroke, "stroke-width": 5})
      );
      yardSlotCentres(seat).forEach((centre) => {
        group.append(svg("circle", {class: "pocket-ludo__yard-slot", cx: centre.x, cy: centre.y, r: 31, fill: theme.slotFill, stroke: theme.slotStroke, "stroke-width": 5, "stroke-dasharray": "6 5"}));
      });
      board.append(group);
    });

    TRACK.forEach(([row, col], global) => {
      const x = MARGIN + col * CELL + 4;
      const y = MARGIN + row * CELL + 4;
      const startSeat = [0, 13, 26, 39].indexOf(global) + 1;
      const theme = startSeat ? SEAT_THEME[startSeat] : null;
      const attrs = {
        class: `pocket-ludo__track-cell${SAFE.has(global) ? " is-safe" : ""}${startSeat ? ` is-start seat-${startSeat}` : ""}`,
        x,
        y,
        width: CELL - 8,
        height: CELL - 8,
        rx: 14,
        "data-square": global,
        fill: startSeat ? theme.trackFill : (SAFE.has(global) ? "#f6eddf" : "#fffdf8"),
        stroke: startSeat ? theme.trackStroke : (SAFE.has(global) ? "#c8b594" : "#d7cbb8"),
        "stroke-width": startSeat ? 5 : 3,
      };
      const cell = svg("rect", attrs);
      board.append(cell);
      if (SAFE.has(global) && !startSeat) {
        const centre = cellCentre(row, col);
        const star = svg("text", {class: "pocket-ludo__safe-star", x: centre.x, y: centre.y + 12, "text-anchor": "middle"});
        star.textContent = "✦";
        board.append(star);
      }
      if (startSeat) {
        const centre = cellCentre(row, col);
        const arrow = svg("text", {class: `pocket-ludo__start-arrow seat-${startSeat}`, x: centre.x, y: centre.y + 10, "text-anchor": "middle", fill: "#ffffff", stroke: theme.arrowStroke, "stroke-width": 4});
        arrow.textContent = ["→", "↓", "←", "↑"][startSeat - 1];
        board.append(arrow);
      }
    });

    Object.entries(HOME_LANES).forEach(([seatKey, lane]) => {
      const seat = Number(seatKey);
      const theme = SEAT_THEME[seat];
      lane.forEach(([row, col], index) => {
        board.append(svg("rect", {
          class: `pocket-ludo__home-cell seat-${seat}`,
          x: MARGIN + col * CELL + 5,
          y: MARGIN + row * CELL + 5,
          width: CELL - 10,
          height: CELL - 10,
          rx: index === lane.length - 1 ? 22 : 13,
          fill: theme.trackFill,
          stroke: theme.trackStroke,
          "stroke-width": 4,
        }));
      });
    });

    const centre = svg("g", {class: "pocket-ludo__home-crown"});
    centre.append(
      svg("polygon", {class: "seat-1", points: "410,410 500,500 410,590"}),
      svg("polygon", {class: "seat-2", points: "410,410 590,410 500,500"}),
      svg("polygon", {class: "seat-3", points: "590,410 590,590 500,500"}),
      svg("polygon", {class: "seat-4", points: "410,590 500,500 590,590"}),
      svg("circle", {class: "pocket-ludo__crown-ring", cx: 500, cy: 500, r: 42}),
      svg("path", {class: "pocket-ludo__crown-mark", d: "M470 516 L475 482 L491 497 L500 472 L509 497 L525 482 L530 516 Z"})
    );
    board.append(centre, pawnLayer);
  }
})();

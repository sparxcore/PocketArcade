"use strict";

(() => {
  const APP_ID = "pocketblocks";
  const BOARD_W = 10;
  const BOARD_H = 20;
  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;

  const COLORS = [
    "#070a11", "#55d7f2", "#f6d365", "#b68cff", "#72df9d",
    "#ff7186", "#6b9dff", "#ffad66", "#596579"
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

  function drawBoard(canvas, player, compact) {
    const width = compact ? 90 : 300;
    const height = compact ? 180 : 600;
    const scale = Math.max(1, window.devicePixelRatio || 1);
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
    context.fillStyle = COLORS[0];
    context.fillRect(0, 0, width, height);

    const cells = decodeCells(player && player.cells);
    for (let y = 0; y < BOARD_H; y += 1) {
      for (let x = 0; x < BOARD_W; x += 1) {
        const value = cells[y * BOARD_W + x];
        if (!value) continue;
        context.fillStyle = COLORS[value] || COLORS[8];
        context.fillRect(x * cellW + 1, y * cellH + 1, Math.max(1, cellW - 2), Math.max(1, cellH - 2));
      }
    }

    if (player && player.active && player.alive !== false) {
      const active = player.active;
      const rotations = SHAPES[active.type];
      const shape = rotations && rotations[active.rotation & 3];
      if (shape) {
        context.fillStyle = COLORS[active.type] || COLORS[8];
        for (const [shapeX, shapeY] of shape) {
          const x = active.x + shapeX;
          const y = active.y + shapeY;
          if (x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H) {
            context.fillRect(x * cellW + 1, y * cellH + 1, Math.max(1, cellW - 2), Math.max(1, cellH - 2));
          }
        }
      }
    }

    context.strokeStyle = "rgba(255,255,255,0.07)";
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
      let disposed = false;
      let joinPending = false;
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

      const root = element("section", "pocketblocks");
      const topbar = element("div", "pb-topbar");
      const brand = element("div", "pb-brand");
      const icon = document.createElement("img");
      icon.className = "pb-icon";
      icon.src = iconUrl;
      icon.alt = "";
      const title = element("div", "pb-title", "PocketBlocks");
      brand.append(icon, title);
      const status = element("div", "pb-status", "Choose Join to play.");
      status.setAttribute("aria-live", "polite");
      topbar.append(brand, status);

      const actions = element("div", "pb-actions");
      const joinButton = button("Join battle", "pb-primary");
      const readyButton = button("Ready", "pb-primary");
      const claimButton = button("Claim controls", "");
      const leaveButton = button("Leave", "pb-danger");
      const againButton = button("Play again", "pb-primary");
      actions.append(joinButton, readyButton, claimButton, leaveButton, againButton);

      const layout = element("div", "pb-layout");
      const stage = element("div", "pb-stage");
      const boardWrap = element("div", "pb-board-wrap");
      const board = element("canvas", "pb-board");
      board.setAttribute("aria-label", "Your PocketBlocks board");
      boardWrap.append(board);

      const stats = element("div", "pb-stats");
      const score = element("span", "", "Score 0");
      const lines = element("span", "", "Lines 0");
      const garbage = element("span", "", "Garbage 0");
      stats.append(score, lines, garbage);
      stage.append(boardWrap, stats);

      const side = element("aside", "pb-side");
      side.append(element("div", "pb-section-title", "Players"));
      const opponents = element("div", "pb-opponents");
      side.append(opponents);
      layout.append(stage, side);

      const controls = element("div", "pb-controls");
      const leftButton = button("◀", "pb-control");
      const rotateButton = button("↻", "pb-control");
      const rightButton = button("▶", "pb-control");
      const downButton = button("▼", "pb-control");
      const dropButton = button("DROP", "pb-control pb-primary");
      leftButton.setAttribute("aria-label", "Move left");
      rotateButton.setAttribute("aria-label", "Rotate clockwise");
      rightButton.setAttribute("aria-label", "Move right");
      downButton.setAttribute("aria-label", "Soft drop");
      dropButton.setAttribute("aria-label", "Hard drop");
      controls.append(leftButton, rotateButton, rightButton, downButton, dropButton);

      const help = element(
        "div",
        "pb-help",
        "Keyboard: arrows move, Z/X rotate, Space drops. Clearing 3 or 4 lines sends cleared lines minus one to every opponent."
      );
      root.append(topbar, actions, layout, controls, help);
      container.replaceChildren(root);

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
        return Boolean(resultEnvelope || (matchState && matchState.state === "finished"));
      }

      function canControl() {
        const state = payload();
        const me = ownPlayer();
        return Boolean(
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

      function sendActionNow(action, data) {
        if (!matchState || !matchState.matchId || !canControl() || disposed) return false;
        const sent = arcade.game.send(matchState.matchId, action, data || {});
        if (!sent) setStatus("Unable to send control.", "error");
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
        if (pendingActions.length >= MAX_PENDING_ACTIONS) {
          return false;
        }
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
        const alreadyQueued = pendingActions.some((entry) => entry.action === action);
        if (alreadyQueued) return false;
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
        clearInputState();
      }

      function renderPlayers(me) {
        opponents.replaceChildren();
        const state = payload();
        const players = state && Array.isArray(state.players) ? state.players : [];
        for (const player of players) {
          const item = element("div", "pb-opponent");
          if (me && player.seat === me.seat) item.dataset.self = "true";
          const info = element("div", "pb-player-info");
          const name = element("div", "pb-player-name", displayName(player));
          const role = me && player.seat === me.seat ? "You · " : "";
          const knockedOut = player.alive === false &&
            (state.phase === "playing" || state.phase === "finished");
          const metaText = knockedOut
            ? `${role}Knocked out`
            : `${role}${player.lines || 0} lines · ${player.score || 0} pts`;
          const meta = element("div", "pb-player-meta", metaText);
          meta.dataset.out = knockedOut ? "true" : "false";
          info.append(name, meta);
          item.append(makeAvatar(player), info);
          opponents.append(item);
        }

        if (!players.length && matchState && Array.isArray(matchState.seats)) {
          for (const seat of matchState.seats) {
            if (!seat.player) continue;
            const waitingPlayer = {
              seat: seat.seat,
              nickname: seat.player.nickname || "Player",
              avatarUrl: seat.player.avatarUrl || ""
            };
            const item = element("div", "pb-waiting-player");
            item.append(
              makeAvatar(waitingPlayer),
              element("div", "pb-player-info")
            );
            item.lastChild.append(
              element("div", "pb-player-name", waitingPlayer.nickname),
              element("div", "pb-player-meta", seat.ready ? "Ready" : "Not ready")
            );
            opponents.append(item);
          }
        }

        if (!opponents.children.length) {
          opponents.append(element("div", "pb-player-meta", "Waiting for players…"));
        }
      }

      function resultWinnerName() {
        const result = resultEnvelope && resultEnvelope.payload;
        const placements = result && Array.isArray(result.placements) ? result.placements : [];
        const winner = placements.find((placement) => placement.place === 1);
        return winner && winner.nickname ? winner.nickname : null;
      }

      function render() {
        const state = payload();
        const me = ownPlayer();
        const role = matchState && matchState.you ? matchState.you.role : "none";
        const platformPhase = matchState ? matchState.state : "none";
        const gamePhase = state ? state.phase : "waiting";
        const finished = isFinished();
        const controller = Boolean(matchState && matchState.you && matchState.you.controller);

        joinButton.classList.toggle("pb-hidden", Boolean(matchState));
        readyButton.classList.toggle("pb-hidden", !matchState || role !== "player" || platformPhase !== "waiting");
        claimButton.classList.toggle("pb-hidden", !matchState || role !== "player" || controller || finished);
        leaveButton.classList.toggle("pb-hidden", !matchState || finished);
        againButton.classList.toggle("pb-hidden", !finished);

        const ownMatchSeat = matchState && Array.isArray(matchState.seats)
          ? matchState.seats.find((seat) => seat.seat === ownSeat())
          : null;
        readyButton.disabled = Boolean(ownMatchSeat && ownMatchSeat.ready);
        readyButton.textContent = ownMatchSeat && ownMatchSeat.ready ? "Ready ✓" : "Ready";

        const enabled = canControl();
        for (const control of [leftButton, rotateButton, rightButton, downButton, dropButton]) {
          control.disabled = !enabled;
        }

        if (!matchState) {
          setStatus("Choose Join to play.", "");
        } else if (finished) {
          const winner = resultWinnerName();
          setStatus(winner ? `${winner} wins!` : "Battle finished", "ok");
        } else if (role === "spectator") {
          setStatus("Spectating battle", "");
        } else if (!controller) {
          setStatus("This tab is observing your seat", "");
        } else if (platformPhase === "waiting") {
          const occupied = Array.isArray(matchState.seats)
            ? matchState.seats.filter((seat) => seat.player).length
            : 0;
          setStatus(occupied < 2 ? "Waiting for another player…" : "Press Ready when prepared", "");
        } else if (gamePhase === "countdown") {
          setStatus(`Starting in ${Math.max(1, Math.ceil((state.countdownMs || 0) / 1000))}…`, "ok");
        } else if (gamePhase === "playing") {
          setStatus(me && me.alive === false ? "Knocked out — spectating" : "Battle in progress", me && me.alive !== false ? "ok" : "");
        } else {
          setStatus("Preparing battle…", "");
        }

        drawBoard(board, me || { cells: "" }, false);
        score.textContent = `Score ${me ? me.score || 0 : 0}`;
        lines.textContent = `Lines ${me ? me.lines || 0 : 0}`;
        garbage.textContent = `Garbage ${me ? me.pendingGarbage || 0 : 0}`;
        renderPlayers(me);
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
        const actions = {
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
        const action = actions[event.key];
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
        const actions = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowDown: "soft-drop"
        };
        endHeld(actions[event.key]);
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
          setStatus(errorMessage, "error");
        }
        render();
      }

      joinButton.addEventListener("click", () => {
        requestJoin("Unable to request a match.");
      });
      againButton.addEventListener("click", () => {
        requestJoin("Unable to request a new match.");
      });
      readyButton.addEventListener("click", () => {
        if (matchState && !arcade.game.ready(matchState.matchId)) setStatus("Unable to mark ready.", "error");
      });
      claimButton.addEventListener("click", () => {
        if (!matchState || !arcade.game.claimControl(matchState.matchId)) {
          setStatus("Unable to claim controls.", "error");
        }
      });
      leaveButton.addEventListener("click", () => {
        if (matchState && !arcade.game.leave(matchState.matchId)) setStatus("Unable to leave match.", "error");
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
        if (Number.isFinite(nextSnapshot.revision) && nextSnapshot.revision < latestSnapshotRevision) return;
        if (Number.isFinite(nextSnapshot.revision)) latestSnapshotRevision = nextSnapshot.revision;
        snapshotEnvelope = nextSnapshot;
        render();
      }));

      stops.push(arcade.game.onEvent((event) => {
        if (!event || !matchState || event.matchId !== matchState.matchId) return;
        if (event.name) setStatus(String(event.name), "ok");
      }));

      stops.push(arcade.game.onResult((result) => {
        if (!result || !matchState || result.matchId !== matchState.matchId) return;
        resultEnvelope = result;
        render();
      }));

      stops.push(arcade.game.onError((error) => {
        if (error && error.matchId &&
            (!matchState || error.matchId !== matchState.matchId)) return;
        if (!error || !error.matchId) joinPending = false;
        if (error && (error.code === "rate_limited" ||
            error.code === "queue_full")) {
          clearInputState();
        }
        setStatus(error && error.message ? String(error.message) : "Game operation rejected.", "error");
      }));

      stops.push(arcade.onConnection((connection) => {
        if (connection !== "connected") clearInputState();
      }));

      if (matchState && matchState.matchId &&
          matchState.state !== "finished") {
        arcade.game.requestSnapshot(matchState.matchId);
      }
      render();

      return () => {
        disposed = true;
        for (const stop of stops) stop();
        for (const unbind of unbindControls) unbind();
        clearInputState();
        for (const timer of timers) {
          window.clearTimeout(timer);
        }
        timers.clear();
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        container.replaceChildren();
      };
    }
  };
})();

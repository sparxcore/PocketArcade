"use strict";

(() => {
  const appId = "tic-tac-toe";
  const appVersion = "1.2.2";
  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;
  const startScreenUrl = new URL("../assets/start-screen.jpg", assetBase).href;
  const winningLines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  window.PocketArcadeApps = window.PocketArcadeApps || {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text) {
    const node = element("button", className, text);
    node.type = "button";
    return node;
  }

  function initials(name) {
    const words = String(name || "Player").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
  }

  function winningCells(game) {
    if (!game || game.status !== "won" || !game.winner) return new Set();
    const board = Array.isArray(game.board) ? game.board : [];
    const line = winningLines.find((cells) =>
      cells.every((index) => board[index] === game.winner));
    return new Set(line || []);
  }

  window.PocketArcadeApps[appId] = {
    mount(container, arcade) {
      container.replaceChildren();

      let activeMatch = null;
      let gameState = null;
      let result = null;
      let latestSnapshotRevision = -1;
      let previousBoard = Array(9).fill(false);
      let connectionValue = arcade.connectionStatus;
      let pendingJoin = false;
      let pendingReady = false;
      let runtimeFailed = false;
      let restarting = false;
      let restartFromMatchId = null;
      let toastTimer = 0;
      let errorTimer = 0;
      let layoutFrame = 0;
      let lastViewportHeight = -1;
      let lastViewportWidth = -1;
      let lastBoardSize = -1;
      let arenaObserver = null;
      let disposed = false;
      const activeAnimations = new Set();

      const root = element("section", "pocket-tic-tac-toe");
      const topbar = element("header", "pocket-tic-tac-toe__topbar");
      const brand = element("div", "pocket-tic-tac-toe__brand");
      const brandIcon = element("img", "pocket-tic-tac-toe__brand-icon");
      brandIcon.src = iconUrl;
      brandIcon.alt = "";
      const brandCopy = element("div", "pocket-tic-tac-toe__brand-copy");
      const title = element("strong", "pocket-tic-tac-toe__title", "Tic-Tac-Toe");
      const subtitle = element(
        "span",
        "pocket-tic-tac-toe__subtitle",
        `PocketArcade · v${appVersion}`
      );
      brandCopy.append(title, subtitle);
      const connection = element("div", "pocket-tic-tac-toe__connection");
      const connectionDot = element("span", "pocket-tic-tac-toe__connection-dot");
      connectionDot.setAttribute("aria-hidden", "true");
      const connectionText = element("span", "pocket-tic-tac-toe__connection-text", "Connecting");
      connection.append(connectionDot, connectionText);
      brand.append(brandIcon, brandCopy, connection);

      const topbarActions = element("div", "pocket-tic-tac-toe__topbar-actions");
      const fullscreen = button(
        "pocket-tic-tac-toe__icon-button",
        "Full screen"
      );
      fullscreen.setAttribute("aria-label", "Enter full screen");
      topbarActions.append(fullscreen);
      topbar.append(brand, topbarActions);

      const splash = element("section", "pocket-tic-tac-toe__splash");
      splash.setAttribute("aria-labelledby", "pocket-tic-tac-toe-splash-title");

      const splashTitle = element(
        "h2",
        "pocket-tic-tac-toe__sr-only",
        "Tic-Tac-Toe"
      );
      splashTitle.id = "pocket-tic-tac-toe-splash-title";

      const splashVisual = element("figure", "pocket-tic-tac-toe__splash-visual");
      const splashImage = element("img", "pocket-tic-tac-toe__splash-image");
      splashImage.src = startScreenUrl;
      splashImage.alt = "PocketArcade Tic-Tac-Toe quick multiplayer showdown with a toy-like X and O board";
      splashImage.loading = "eager";
      splashImage.decoding = "async";
      splashImage.draggable = false;
      if ("fetchPriority" in splashImage) splashImage.fetchPriority = "high";
      splashVisual.append(splashImage);

      const splashPanel = element("div", "pocket-tic-tac-toe__splash-panel");
      const splashDetails = element("div", "pocket-tic-tac-toe__splash-details");
      const splashPrompt = element(
        "strong",
        "pocket-tic-tac-toe__splash-prompt",
        "Ready for a quick showdown?"
      );
      const splashChips = element("div", "pocket-tic-tac-toe__splash-chips");
      splashChips.append(
        element("span", "pocket-tic-tac-toe__chip", "2 players"),
        element("span", "pocket-tic-tac-toe__chip", "Spectators welcome"),
        element("span", "pocket-tic-tac-toe__chip", `v${appVersion}`)
      );
      splashDetails.append(splashPrompt, splashChips);

      const splashJoin = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--primary pocket-tic-tac-toe__splash-join",
        "Join game"
      );
      splashPanel.append(splashDetails, splashJoin);
      splash.append(splashTitle, splashVisual, splashPanel);

      const gameView = element("div", "pocket-tic-tac-toe__game-view");
      const main = element("div", "pocket-tic-tac-toe__main");
      const playerRail = element("aside", "pocket-tic-tac-toe__player-rail");
      playerRail.setAttribute("aria-label", "Players and spectators");

      const playColumn = element("div", "pocket-tic-tac-toe__play-column");
      const arena = element("section", "pocket-tic-tac-toe__arena");
      const board = element("div", "pocket-tic-tac-toe__board");
      board.setAttribute("role", "grid");
      board.setAttribute("aria-label", "Tic-Tac-Toe board");
      const cells = [];
      const marks = [];
      for (let index = 0; index < 9; index += 1) {
        const cell = button("pocket-tic-tac-toe__cell", "");
        cell.dataset.cell = String(index);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `Square ${index + 1}, empty`);
        const mark = element("span", "pocket-tic-tac-toe__mark");
        mark.setAttribute("aria-hidden", "true");
        cell.append(mark);
        cell.addEventListener("click", () => sendMove(index));
        cells.push(cell);
        marks.push(mark);
        board.append(cell);
      }

      const arenaOverlay = element("div", "pocket-tic-tac-toe__arena-overlay");
      const overlayIcon = element("img", "pocket-tic-tac-toe__overlay-icon");
      overlayIcon.src = iconUrl;
      overlayIcon.alt = "";
      const overlayTitle = element("strong", "pocket-tic-tac-toe__overlay-title", "Waiting for players");
      const overlayText = element(
        "span",
        "pocket-tic-tac-toe__overlay-text",
        "Join a seat and ready up to begin."
      );
      arenaOverlay.append(overlayIcon, overlayTitle, overlayText);

      const resultOverlay = element("div", "pocket-tic-tac-toe__result-overlay");
      resultOverlay.setAttribute("aria-live", "polite");
      const resultSymbol = element("div", "pocket-tic-tac-toe__result-symbol");
      resultSymbol.setAttribute("aria-hidden", "true");
      const resultTitle = element("strong", "pocket-tic-tac-toe__result-title", "Match finished");
      const resultText = element("p", "pocket-tic-tac-toe__result-text", "");
      const resultActions = element("div", "pocket-tic-tac-toe__result-actions");
      const playAnother = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--primary",
        "Play another match"
      );
      const resultExit = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--secondary",
        "Exit full screen"
      );
      resultActions.append(playAnother, resultExit);
      resultOverlay.append(resultSymbol, resultTitle, resultText, resultActions);

      const toast = element("div", "pocket-tic-tac-toe__toast", "");
      toast.setAttribute("aria-live", "polite");
      arena.append(board, arenaOverlay, resultOverlay, toast);

      const controls = element("section", "pocket-tic-tac-toe__controls");
      const controlKicker = element("span", "pocket-tic-tac-toe__control-kicker", "MATCH STATUS");
      const controlTitle = element("strong", "pocket-tic-tac-toe__control-title", "Waiting for players");
      const controlText = element(
        "span",
        "pocket-tic-tac-toe__control-text",
        "Join a seat and ready up to begin."
      );
      controls.append(controlKicker, controlTitle, controlText);
      playColumn.append(arena, controls);
      main.append(playerRail, playColumn);

      const membership = element("footer", "pocket-tic-tac-toe__membership");
      const membershipStatus = element("div", "pocket-tic-tac-toe__membership-status");
      const membershipLabel = element("strong", "pocket-tic-tac-toe__membership-label", "Not joined");
      const membershipText = element(
        "span",
        "pocket-tic-tac-toe__membership-text",
        "Join to take the next open seat."
      );
      membershipStatus.append(membershipLabel, membershipText);
      const membershipActions = element("div", "pocket-tic-tac-toe__membership-actions");
      const ready = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--primary",
        "Ready up"
      );
      const takeControl = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--primary",
        "Take control"
      );
      const leave = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--secondary",
        "Leave match"
      );
      const newMatch = button(
        "pocket-tic-tac-toe__button pocket-tic-tac-toe__button--primary",
        "Join a new match"
      );
      membershipActions.append(ready, takeControl, leave, newMatch);
      membership.append(membershipStatus, membershipActions);
      gameView.append(main, membership);

      const error = element("p", "pocket-tic-tac-toe__error", "");
      error.setAttribute("role", "alert");
      root.append(topbar, splash, gameView, error);
      container.append(root);

      function syncVisibleViewport() {
        const viewport = window.visualViewport;
        const viewportHeight = Math.max(
          1,
          Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1)
        );
        const viewportWidth = Math.max(
          1,
          Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1)
        );
        if (viewportHeight !== lastViewportHeight) {
          lastViewportHeight = viewportHeight;
          root.style.setProperty("--pa-visible-height", `${viewportHeight}px`);
        }
        if (viewportWidth !== lastViewportWidth) {
          lastViewportWidth = viewportWidth;
          root.style.setProperty("--pa-visible-width", `${viewportWidth}px`);
        }
      }

      function syncBoardSize() {
        if (gameView.hidden) return;
        const rect = arena.getBoundingClientRect();
        const available = Math.floor(Math.min(rect.width, rect.height) - 20);
        if (available <= 0) return;
        const boardSize = Math.min(464, available);
        if (boardSize !== lastBoardSize) {
          lastBoardSize = boardSize;
          board.style.setProperty("--pa-board-size", `${boardSize}px`);
        }
      }

      function scheduleLayoutSync() {
        if (disposed || layoutFrame) return;
        layoutFrame = window.requestAnimationFrame(() => {
          layoutFrame = 0;
          syncVisibleViewport();
          syncBoardSize();
        });
      }

      function normalizedConnection() {
        const value = connectionValue;
        if (value === true) return "connected";
        if (value === false || value == null) return "reconnecting";
        if (typeof value === "object") {
          if (value.connected === true) return "connected";
          if (value.connected === false) return "reconnecting";
          if (value.status) return String(value.status).toLowerCase();
          if (value.state) return String(value.state).toLowerCase();
        }
        return String(value).toLowerCase();
      }

      function isConnected() {
        return ["connected", "open", "online", "ready"].includes(
          normalizedConnection()
        );
      }

      function ownSeat() {
        if (!activeMatch || activeMatch.you?.role !== "player") return null;
        return activeMatch.seats?.find(
          (seat) => seat.seat === activeMatch.you.seat
        ) || null;
      }

      function ownMark() {
        const profileId = arcade.profile?.id;
        if (!profileId || !gameState?.players) return null;
        if (gameState.players.X?.id === profileId) return "X";
        if (gameState.players.O?.id === profileId) return "O";
        return null;
      }

      function canSendCommands() {
        return Boolean(
          activeMatch &&
          activeMatch.you?.role === "player" &&
          activeMatch.you?.controller &&
          activeMatch.state === "playing" &&
          isConnected() &&
          !runtimeFailed
        );
      }

      function isLegalMove(index) {
        return Boolean(
          canSendCommands() &&
          gameState?.status === "playing" &&
          gameState.turn === ownMark() &&
          !gameState.board?.[index]
        );
      }

      function showToast(message, tone = "neutral") {
        window.clearTimeout(toastTimer);
        toast.textContent = message;
        toast.dataset.tone = tone;
        toast.classList.add("is-visible");
        toastTimer = window.setTimeout(() => {
          toast.classList.remove("is-visible");
        }, 1800);
      }

      function showError(message) {
        window.clearTimeout(errorTimer);
        error.textContent = message;
        errorTimer = window.setTimeout(() => {
          error.textContent = "";
        }, 5000);
      }

      function animatePlacement(index) {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
          return;
        }
        const animation = marks[index].animate(
          [
            { transform: "scale(.25) rotate(-14deg)", opacity: 0 },
            { transform: "scale(1.14) rotate(4deg)", opacity: 1, offset: 0.72 },
            { transform: "scale(1) rotate(0deg)", opacity: 1 },
          ],
          { duration: 320, easing: "cubic-bezier(.2,.82,.2,1)" }
        );
        activeAnimations.add(animation);
        animation.addEventListener("finish", () => activeAnimations.delete(animation), { once: true });
        animation.addEventListener("cancel", () => activeAnimations.delete(animation), { once: true });
      }

      function sendMove(index) {
        if (!isLegalMove(index) || !activeMatch) return;
        const sent = arcade.game.send(activeMatch.matchId, "move", { cell: index });
        if (!sent) showToast("Move not sent — reconnecting.", "danger");
      }

      function joinGame(options = {}) {
        restarting = Boolean(options.inPlace);
        pendingJoin = true;
        runtimeFailed = false;
        result = null;
        render();
        const sent = arcade.game.join(appId);
        if (!sent) {
          pendingJoin = false;
          restarting = false;
          restartFromMatchId = null;
          showError("Could not join yet. Check the connection and try again.");
          render();
        }
      }

      function readyUp() {
        if (!activeMatch || activeMatch.you?.role !== "player") return;
        pendingReady = true;
        render();
        const sent = arcade.game.ready(activeMatch.matchId);
        if (!sent) {
          pendingReady = false;
          showError("Ready was not sent. Check the connection and try again.");
          render();
          return;
        }
        arcade.display?.requestFullscreen?.();
      }

      function claimControl() {
        if (!activeMatch) return;
        const sent = arcade.game.claimControl(activeMatch.matchId);
        if (!sent) showError("Control could not be moved to this screen.");
      }

      function leaveMatch() {
        if (!activeMatch) return;
        arcade.game.leave(activeMatch.matchId);
      }

      function captureViewportPosition() {
        const positions = [];
        let node = container;
        while (node instanceof HTMLElement) {
          positions.push({
            node,
            left: node.scrollLeft,
            top: node.scrollTop,
          });
          node = node.parentElement;
        }
        const windowLeft = window.scrollX;
        const windowTop = window.scrollY;
        return () => {
          positions.forEach((position) => {
            position.node.scrollLeft = position.left;
            position.node.scrollTop = position.top;
          });
          window.scrollTo(windowLeft, windowTop);
        };
      }

      function startAnotherMatch() {
        const restoreViewport = captureViewportPosition();
        restartFromMatchId = activeMatch?.matchId || null;
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        activeMatch = null;
        gameState = null;
        result = null;
        latestSnapshotRevision = -1;
        previousBoard = Array(9).fill(false);
        pendingJoin = false;
        pendingReady = false;
        runtimeFailed = false;
        joinGame({ inPlace: true });

        window.requestAnimationFrame(() => {
          restoreViewport();
          window.requestAnimationFrame(restoreViewport);
        });
      }

      function clearMatchState() {
        activeMatch = null;
        gameState = null;
        result = null;
        latestSnapshotRevision = -1;
        previousBoard = Array(9).fill(false);
        pendingJoin = false;
        pendingReady = false;
        runtimeFailed = false;
        restarting = false;
        restartFromMatchId = null;
        render();
      }

      function avatarNode(player, neutral = false) {
        const avatar = element(
          "span",
          `pocket-tic-tac-toe__avatar${neutral ? " is-neutral" : ""}`,
          initials(player?.nickname)
        );
        if (player?.avatarUrl) {
          const image = element("img", "pocket-tic-tac-toe__avatar-image");
          image.src = player.avatarUrl;
          image.alt = "";
          image.addEventListener("load", () => avatar.classList.add("has-image"));
          image.addEventListener("error", () => image.remove());
          avatar.append(image);
        }
        return avatar;
      }

      function playerCard(seat) {
        const occupied = Boolean(seat.player);
        const mark = seat.seat === 1 ? "X" : "O";
        const card = element(
          "div",
          `pocket-tic-tac-toe__player-card seat-${seat.seat}${
            occupied ? "" : " is-open"
          }${seat.seat === activeMatch?.you?.seat ? " is-you" : ""}`
        );
        const avatar = avatarNode(seat.player || { nickname: mark });
        const copy = element("span", "pocket-tic-tac-toe__player-copy");
        const name = element(
          "strong",
          "pocket-tic-tac-toe__player-name",
          occupied ? seat.player.nickname : "Open Seat"
        );
        const state = element(
          "span",
          "pocket-tic-tac-toe__player-state",
          occupied
            ? `${mark} · ${seat.ready ? "Ready" : "Not ready"}${
                seat.connected === false ? " · Reconnecting" : ""
              }`
            : `${mark} seat`
        );
        copy.append(name, state);
        const badge = element("span", "pocket-tic-tac-toe__mark-badge", mark);
        badge.setAttribute("aria-label", `Plays ${mark}`);
        card.append(avatar, copy, badge);
        return card;
      }

      function spectatorCard(player) {
        const card = element("div", "pocket-tic-tac-toe__spectator-card");
        const avatar = avatarNode(player, true);
        const name = element(
          "strong",
          "pocket-tic-tac-toe__spectator-name",
          player.nickname
        );
        card.append(avatar, name);
        return card;
      }

      function renderPlayerRail() {
        if (restarting) return;
        playerRail.replaceChildren();
        if (!activeMatch) return;

        const heading = element("div", "pocket-tic-tac-toe__rail-heading");
        heading.append(
          element("strong", "pocket-tic-tac-toe__rail-title", "Players"),
          element(
            "span",
            "pocket-tic-tac-toe__rail-count",
            `${activeMatch.seats?.filter((seat) => seat.player).length || 0}/2`
          )
        );
        playerRail.append(heading);

        const playing = ["playing", "finished"].includes(activeMatch.state);
        const seats = [...(activeMatch.seats || [])]
          .filter((seat) => seat.player || !playing)
          .sort((a, b) => {
            const aLocal = a.seat === activeMatch.you?.seat ? 0 : 1;
            const bLocal = b.seat === activeMatch.you?.seat ? 0 : 1;
            return aLocal - bLocal || a.seat - b.seat;
          });
        seats.forEach((seat) => playerRail.append(playerCard(seat)));

        const spectators = [...(activeMatch.spectators || [])].sort((a, b) => {
          const profileId = arcade.profile?.id;
          const aLocal = a.profileId === profileId ? 0 : 1;
          const bLocal = b.profileId === profileId ? 0 : 1;
          return aLocal - bLocal || a.nickname.localeCompare(b.nickname);
        });
        if (spectators.length) {
          playerRail.append(
            element("strong", "pocket-tic-tac-toe__spectator-heading", "Spectators")
          );
          spectators.forEach((spectator) =>
            playerRail.append(spectatorCard(spectator))
          );
        }
      }

      function renderConnection() {
        const status = normalizedConnection();
        const connected = isConnected();
        connection.classList.toggle("is-connected", connected);
        connection.classList.toggle("is-reconnecting", !connected);
        connectionText.textContent = connected
          ? "Connected"
          : status === "closed" ? "Offline" : "Reconnecting";
      }

      function renderBoard() {
        const boardState = Array.isArray(gameState?.board)
          ? gameState.board
          : Array(9).fill(false);
        const winners = winningCells(gameState);
        cells.forEach((cell, index) => {
          const mark = boardState[index] || "";
          const oldMark = previousBoard[index] || "";
          marks[index].className = `pocket-tic-tac-toe__mark${
            mark ? ` is-${mark.toLowerCase()}` : ""
          }`;
          cell.classList.toggle("is-filled", Boolean(mark));
          cell.classList.toggle("is-legal", isLegalMove(index));
          cell.classList.toggle("is-winning", winners.has(index));
          cell.disabled = !isLegalMove(index);
          cell.setAttribute("aria-disabled", String(!isLegalMove(index)));
          cell.setAttribute(
            "aria-label",
            `Square ${index + 1}, ${mark || "empty"}${
              isLegalMove(index) ? ", available move" : ""
            }`
          );
          if (mark && !oldMark) animatePlacement(index);
        });
        previousBoard = boardState.slice(0, 9);
        while (previousBoard.length < 9) previousBoard.push(false);
      }

      function renderArenaState() {
        if (restarting) {
          arenaOverlay.classList.add("is-visible");
          resultOverlay.classList.remove("is-visible");
          overlayTitle.textContent = "Starting next match";
          overlayText.textContent = "Keeping this view open while a fresh board is prepared.";
          return;
        }

        const joined = Boolean(activeMatch && activeMatch.you?.role !== "none");
        const playing = activeMatch?.state === "playing" &&
          gameState?.status === "playing";
        const finished = Boolean(result) ||
          ["won", "draw"].includes(gameState?.status) ||
          activeMatch?.state === "finished";

        arenaOverlay.classList.toggle("is-visible", joined && !playing && !finished);
        resultOverlay.classList.toggle("is-visible", joined && finished);

        if (runtimeFailed) {
          arenaOverlay.classList.add("is-visible");
          resultOverlay.classList.remove("is-visible");
          overlayTitle.textContent = "Game stopped";
          overlayText.textContent = "The match runtime closed safely. Join a fresh match to continue.";
        } else if (!gameState) {
          overlayTitle.textContent = "Loading match";
          overlayText.textContent = "Getting the latest board state.";
        } else if (gameState.status === "waiting") {
          overlayTitle.textContent = "Waiting for players";
          overlayText.textContent = activeMatch?.you?.role === "spectator"
            ? "You are watching. Play begins when both players are ready."
            : "Fill both seats and ready up to begin.";
        }

        if (!finished) return;
        const payload = result?.payload;
        const placements = Array.isArray(payload?.placements)
          ? payload.placements
          : [];
        const localProfileId = arcade.profile?.id;
        const localPlacement = placements.find(
          (placement) => placement.profileId === localProfileId
        );
        const winner = placements.find((placement) => placement.place === 1);
        const draw = Boolean(payload?.draw) || gameState?.status === "draw";
        resultSymbol.className = `pocket-tic-tac-toe__result-symbol${
          draw ? " is-draw" : " is-win"
        }`;
        if (draw) {
          resultTitle.textContent = "Draw game";
          resultText.textContent = "A perfect block. Nobody takes the win.";
        } else if (localPlacement?.place === 1) {
          resultTitle.textContent = "You win!";
          resultText.textContent = Number.isFinite(Number(localPlacement.wins))
            ? `Your PocketArcade total is now ${localPlacement.wins} wins.`
            : "Three in a row sealed the match.";
        } else if (winner) {
          resultTitle.textContent = `${winner.nickname} wins!`;
          resultText.textContent = Number.isFinite(Number(winner.wins))
            ? `${winner.nickname} now has ${winner.wins} wins.`
            : "Three in a row sealed the match.";
        } else {
          resultTitle.textContent = "Match finished";
          resultText.textContent = "The final result has been recorded.";
        }
      }

      function renderControls() {
        controls.classList.remove("is-current", "is-neutral", "is-warning");
        controls.classList.add("is-neutral");
        const role = activeMatch?.you?.role;

        if (restarting) {
          controlKicker.textContent = "NEXT MATCH";
          controlTitle.textContent = "Preparing a fresh board";
          controlText.textContent = "You will stay in this view while the next table opens.";
          return;
        }
        const mark = ownMark();

        if (!isConnected()) {
          controls.classList.add("is-warning");
          controlKicker.textContent = "CONNECTION";
          controlTitle.textContent = "Reconnecting";
          controlText.textContent = "The board is paused until the match reconnects.";
          return;
        }
        if (runtimeFailed) {
          controls.classList.add("is-warning");
          controlKicker.textContent = "MATCH STOPPED";
          controlTitle.textContent = "Start a fresh match";
          controlText.textContent = "No more moves can be sent to this match.";
          return;
        }
        if (activeMatch?.you?.role === "player" && !activeMatch.you.controller) {
          controlKicker.textContent = "CONTROL";
          controlTitle.textContent = "Another tab has control";
          controlText.textContent = "Take control here before making a move.";
          return;
        }
        if (!gameState || ["waiting", "countdown"].includes(activeMatch?.state) ||
            gameState.status === "waiting") {
          controlKicker.textContent = "READY CHECK";
          if (role === "spectator") {
            controlTitle.textContent = "Watching the lobby";
            controlText.textContent = "Play begins when both players are ready.";
          } else if (ownSeat()?.ready) {
            controlTitle.textContent = "Ready — waiting for rival";
            controlText.textContent = "The board opens as soon as both seats are ready.";
          } else {
            controlTitle.textContent = "Ready when you are";
            controlText.textContent = "Ready up after both players have joined.";
          }
          return;
        }
        if (gameState.status === "playing") {
          const turnName = gameState.players?.[gameState.turn]?.nickname || gameState.turn;
          if (role === "spectator") {
            controlKicker.textContent = "SPECTATING";
            controlTitle.textContent = `${turnName}'s turn`;
            controlText.textContent = "Watch the board for the next move.";
          } else if (mark === gameState.turn) {
            controls.classList.remove("is-neutral");
            controls.classList.add("is-current");
            controlKicker.textContent = "YOUR TURN";
            controlTitle.textContent = "Choose an empty square";
            controlText.textContent = `Place your ${mark} to build three in a row.`;
          } else {
            controlKicker.textContent = "RIVAL'S TURN";
            controlTitle.textContent = `${turnName} is choosing`;
            controlText.textContent = "Your mark stays ready for the next turn.";
          }
          return;
        }
        controlKicker.textContent = "MATCH COMPLETE";
        controlTitle.textContent = "Result recorded";
        controlText.textContent = "Play another match when you are ready.";
      }

      function renderMembership() {
        const role = activeMatch?.you?.role || "none";
        const seat = ownSeat();
        const finished = Boolean(result) || activeMatch?.state === "finished" ||
          ["won", "draw"].includes(gameState?.status);
        const canReady = role === "player" && !seat?.ready &&
          ["waiting", "countdown"].includes(activeMatch?.state);

        ready.hidden = !canReady;
        ready.disabled = pendingReady || !isConnected();
        ready.textContent = pendingReady ? "Ready sent" : "Ready up";
        takeControl.hidden = !(role === "player" && !activeMatch?.you?.controller && !finished);
        takeControl.disabled = !isConnected();
        leave.hidden = role === "none" || finished;
        leave.disabled = !isConnected();
        newMatch.hidden = !runtimeFailed;
        newMatch.disabled = !isConnected();
        const visibleActionCount = [ready, takeControl, leave, newMatch]
          .filter((action) => !action.hidden).length;
        membershipActions.classList.toggle(
          "has-one-action",
          visibleActionCount === 1
        );

        if (restarting) {
          membershipLabel.textContent = "Starting next match";
          membershipText.textContent = "Opening a fresh table without leaving this view.";
        } else if (runtimeFailed) {
          membershipLabel.textContent = "Match stopped";
          membershipText.textContent = "Join a fresh table to keep playing.";
        } else if (finished) {
          membershipLabel.textContent = "Match complete";
          membershipText.textContent = "The result has been saved.";
        } else if (role === "spectator") {
          membershipLabel.textContent = "Spectating";
          membershipText.textContent = "You can leave this match at any time.";
        } else if (role === "player") {
          membershipLabel.textContent = seat?.ready ? "Ready" : "Player seat claimed";
          membershipText.textContent = activeMatch?.you?.controller
            ? `You are playing ${ownMark() || (activeMatch.you.seat === 1 ? "X" : "O")}.`
            : "This seat is controlled from another tab.";
        } else {
          membershipLabel.textContent = "Not joined";
          membershipText.textContent = "Join to take the next open seat.";
        }
      }

      function render() {
        if (disposed) return;
        renderConnection();
        const joined = Boolean(activeMatch && activeMatch.you?.role !== "none") || restarting;
        splash.hidden = joined;
        gameView.hidden = !joined;
        splashJoin.disabled = pendingJoin || !isConnected();
        splashJoin.textContent = pendingJoin ? "Joining…" : "Join game";
        root.classList.toggle(
          "is-playing",
          activeMatch?.state === "playing" && gameState?.status === "playing"
        );
        root.classList.toggle("is-spectator", activeMatch?.you?.role === "spectator");
        renderPlayerRail();
        renderBoard();
        renderArenaState();
        renderControls();
        renderMembership();
        scheduleLayoutSync();
      }

      function acceptMatch(match) {
        if (!match) return;
        if (restarting && restartFromMatchId && match.matchId === restartFromMatchId) return;
        if (activeMatch && match.matchId !== activeMatch.matchId) return;
        if (match.state === "closed" || match.you?.role === "none") {
          if (!activeMatch || match.matchId === activeMatch.matchId) {
            clearMatchState();
          }
          return;
        }
        if (!activeMatch || activeMatch.matchId !== match.matchId) {
          activeMatch = null;
          gameState = null;
          result = null;
          latestSnapshotRevision = -1;
          previousBoard = Array(9).fill(false);
          runtimeFailed = false;
        }
        activeMatch = match;
        pendingJoin = false;
        restarting = false;
        restartFromMatchId = null;
        if (ownSeat()?.ready) pendingReady = false;
        render();
      }

      splashJoin.addEventListener("click", () => joinGame());
      ready.addEventListener("click", readyUp);
      takeControl.addEventListener("click", claimControl);
      leave.addEventListener("click", leaveMatch);
      newMatch.addEventListener("click", startAnotherMatch);
      playAnother.addEventListener("click", startAnotherMatch);
      resultExit.addEventListener("click", () => arcade.display?.exitFullscreen?.());
      fullscreen.addEventListener("click", () => {
        if (arcade.display?.fullscreen) arcade.display.exitFullscreen();
        else arcade.display?.requestFullscreen?.();
      });

      const stopMatch = arcade.game.onMatch((match) => {
        acceptMatch(match);
      });
      const stopSnapshot = arcade.game.onSnapshot((snapshot) => {
        if (!activeMatch || snapshot.matchId !== activeMatch.matchId) return;
        const revision = Number(snapshot.revision);
        if (!Number.isFinite(revision) || revision < latestSnapshotRevision) return;
        latestSnapshotRevision = revision;
        gameState = snapshot.payload || null;
        render();
      });
      const stopResult = arcade.game.onResult((nextResult) => {
        if (!activeMatch || nextResult.matchId !== activeMatch.matchId) return;
        result = nextResult;
        render();
      });
      const stopError = arcade.game.onError((value) => {
        if (value?.matchId && (!activeMatch || value.matchId !== activeMatch.matchId)) {
          return;
        }
        pendingJoin = false;
        pendingReady = false;
        if (value?.code === "match_not_found") {
          clearMatchState();
          showError("That match has closed. Join another table.");
          return;
        }
        if (value?.code === "runtime_failed") {
          runtimeFailed = true;
          render();
          showError("The game stopped safely. Join a fresh match.");
          return;
        }
        showToast(value?.message || "That action could not be completed.", "danger");
        render();
      });
      const stopConnection = arcade.onConnection((value) => {
        connectionValue = value;
        render();
      });
      function syncFullscreen(value) {
        const isFullscreen = Boolean(value);
        root.classList.toggle("is-fullscreen", isFullscreen);
        fullscreen.textContent = isFullscreen ? "Windowed" : "Full screen";
        fullscreen.setAttribute(
          "aria-label",
          isFullscreen ? "Exit full screen" : "Enter full screen"
        );
        resultExit.hidden = !isFullscreen;
        scheduleLayoutSync();
      }

      const stopFullscreen = arcade.display?.onFullscreenChange?.((value) => {
        syncFullscreen(value);
      }) || (() => {});

      const visualViewport = window.visualViewport;
      window.addEventListener("resize", scheduleLayoutSync, { passive: true });
      window.addEventListener("orientationchange", scheduleLayoutSync, { passive: true });
      visualViewport?.addEventListener("resize", scheduleLayoutSync, { passive: true });
      visualViewport?.addEventListener("scroll", scheduleLayoutSync, { passive: true });
      if (typeof ResizeObserver === "function") {
        arenaObserver = new ResizeObserver(scheduleLayoutSync);
        arenaObserver.observe(root);
        arenaObserver.observe(arena);
      }

      const cachedMatch = arcade.game.currentMatch();
      if (cachedMatch && cachedMatch.you?.role !== "none" && cachedMatch.state !== "closed") {
        acceptMatch(cachedMatch);
        const cachedSnapshot = arcade.game.currentSnapshot();
        if (cachedSnapshot?.matchId === cachedMatch.matchId) {
          latestSnapshotRevision = Number(cachedSnapshot.revision) || -1;
          gameState = cachedSnapshot.payload || null;
        }
        if (cachedMatch.state !== "finished") {
          arcade.game.requestSnapshot(cachedMatch.matchId);
        }
      }
      syncFullscreen(arcade.display?.fullscreen);
      render();

      return () => {
        disposed = true;
        stopMatch();
        stopSnapshot();
        stopResult();
        stopError();
        stopConnection();
        stopFullscreen();
        window.removeEventListener("resize", scheduleLayoutSync);
        window.removeEventListener("orientationchange", scheduleLayoutSync);
        visualViewport?.removeEventListener("resize", scheduleLayoutSync);
        visualViewport?.removeEventListener("scroll", scheduleLayoutSync);
        arenaObserver?.disconnect();
        arenaObserver = null;
        window.cancelAnimationFrame(layoutFrame);
        layoutFrame = 0;
        window.clearTimeout(toastTimer);
        window.clearTimeout(errorTimer);
        activeAnimations.forEach((animation) => animation.cancel());
        activeAnimations.clear();
        activeMatch = null;
        gameState = null;
        result = null;
        container.replaceChildren();
      };
    },
  };
})();

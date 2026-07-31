"use strict";

(() => {
  const APP_ID = "pocket-chomp";
  const WIDTH = 19;
  const HEIGHT = 19;
  const MAP = [
    "###################",
    "#o.....#...#.....o#",
    "#.###.#.#.#.#.###.#",
    "#.....#.....#.....#",
    "###.#.###.###.#.###",
    "#...#...#.#...#...#",
    "#.#####.#.#.#####.#",
    "#.......#.#.......#",
    "#.###.###.###.###.#",
    "......... .........",
    "#.###.#.#####.#.###",
    "#.....#..   ..#...#",
    "###.#.##   ##.#.###",
    "#...#..     ..#...#",
    "#.#####.###.#####.#",
    "#.......#.#.......#",
    "#.###.#.#.#.#.###.#",
    "#o..#.........#..o#",
    "###################",
  ];
  const DIRECTIONS = [
    { label: "Up", symbol: "▲" },
    { label: "Right", symbol: "▶" },
    { label: "Down", symbol: "▼" },
    { label: "Left", symbol: "◀" },
  ];
  const CHOMPER_COLOURS = ["#ffe24a", "#8cff5a"];
  const GHOST_COLOURS = ["#ff5ca8", "#58e5ff"];
  const APP_VERSION = "1.1.0";
  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;
  const splashUrl = new URL("../assets/splash.png", assetBase).href;

  window.PocketArcadeApps = window.PocketArcadeApps || {};

  window.PocketArcadeApps[APP_ID] = {
    mount(container, arcade) {
      let activeMatch = null;
      let latestSnapshotRevision = -1;
      let gameState = null;
      let result = null;
      let connected = arcade.connectionStatus !== "disconnected";
      let frameId = 0;
      let resizeObserver = null;
      let swipeStart = null;
      let enterFullscreenOnPlay = false;
      const renderPlayers = new Map();
      const effects = [];

      const root = document.createElement("section");
      root.className = "pocket-chomp";

      const topbar = document.createElement("header");
      topbar.className = "pc-topbar";
      const topbarBrand = document.createElement("div");
      topbarBrand.className = "pc-topbar-brand";
      const appIcon = document.createElement("img");
      appIcon.className = "pc-app-icon";
      appIcon.src = iconUrl;
      appIcon.alt = "";
      const topbarCopy = document.createElement("div");
      const topbarTitle = document.createElement("strong");
      topbarTitle.textContent = "Pocket Chomp";
      const topbarSubtitle = document.createElement("span");
      topbarSubtitle.textContent = "Multiplayer maze chase";
      topbarCopy.append(topbarTitle, topbarSubtitle);
      topbarBrand.append(appIcon, topbarCopy);

      const topbarActions = document.createElement("div");
      topbarActions.className = "pc-topbar-actions";
      const connectionBadge = document.createElement("span");
      connectionBadge.className = "pc-connection-badge";
      const connectionDot = document.createElement("span");
      connectionDot.className = "pc-connection-dot";
      const connectionText = document.createElement("span");
      connectionBadge.append(connectionDot, connectionText);
      const fullscreenButton = createButton("Full screen", "secondary", () => {
        if (arcade.display.fullscreen) arcade.display.exitFullscreen();
        else arcade.display.requestFullscreen();
      });
      fullscreenButton.classList.add("pc-fullscreen-button");
      topbarActions.append(connectionBadge, fullscreenButton);
      topbar.append(topbarBrand, topbarActions);

      const stage = document.createElement("div");
      stage.className = "pc-stage";

      const toast = document.createElement("div");
      toast.className = "pc-toast";
      toast.setAttribute("aria-live", "polite");

      const splash = document.createElement("section");
      splash.className = "pc-splash";
      const splashArtwork = document.createElement("img");
      splashArtwork.className = "pc-splash-artwork";
      splashArtwork.src = splashUrl;
      splashArtwork.alt = "Pixel art Pocket Chomp cabinet with Chomper and four ghosts in a neon maze";
      splashArtwork.loading = "eager";
      splashArtwork.decoding = "async";
      const splashPanel = document.createElement("div");
      splashPanel.className = "pc-splash-panel";
      const splashTitle = document.createElement("h1");
      splashTitle.textContent = "Chomp the maze or hunt the Chompers";
      const splashCopy = document.createElement("p");
      splashCopy.textContent = "Every character is controlled by a player. Choose a side preference, ready up and race through a two-minute neon maze.";
      const splashMeta = document.createElement("div");
      splashMeta.className = "pc-splash-meta";
      [
        `v${APP_VERSION}`,
        "2–4 players",
        "Chompers vs Ghosts",
      ].forEach((label) => {
        const chip = document.createElement("span");
        chip.textContent = label;
        splashMeta.append(chip);
      });
      const splashJoinButton = createButton("Join Pocket Chomp", "primary", () => {
        arcade.game.join(APP_ID);
      });
      splashJoinButton.classList.add("pc-splash-join");
      splashPanel.append(splashTitle, splashCopy, splashMeta, splashJoinButton);
      splash.append(splashArtwork, splashPanel);

      const lobby = document.createElement("section");
      lobby.className = "pc-lobby";
      const lobbyHeader = document.createElement("header");
      lobbyHeader.className = "pc-lobby-header";
      const lobbyTitle = document.createElement("h1");
      lobbyTitle.textContent = "Match lobby";
      const lobbyIntro = document.createElement("p");
      lobbyIntro.textContent = "Pick a role preference. Teams are balanced when every joined player is ready.";
      lobbyHeader.append(lobbyTitle, lobbyIntro);

      const lobbyStatus = document.createElement("p");
      lobbyStatus.className = "pc-lobby-status";
      lobbyStatus.setAttribute("aria-live", "polite");

      const seatGrid = document.createElement("div");
      seatGrid.className = "pc-seat-grid";

      const setupCard = document.createElement("section");
      setupCard.className = "pc-setup-card";
      const setupTitle = document.createElement("h2");
      setupTitle.textContent = "Choose your preference";
      const setupHint = document.createElement("p");
      setupHint.textContent = "Your final team is assigned automatically when the match begins.";
      const roleChooser = document.createElement("div");
      roleChooser.className = "pc-role-chooser";
      const roleButtons = new Map();
      [
        ["chomper", "Chomper", "◖"],
        ["ghost", "Ghost", "♟"],
        ["flex", "Flex", "↔"],
      ].forEach(([preference, label, glyph]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `pc-role-button pc-role-${preference}`;
        const icon = document.createElement("span");
        icon.className = "pc-role-glyph";
        icon.textContent = glyph;
        const text = document.createElement("span");
        text.textContent = label;
        button.append(icon, text);
        button.addEventListener("click", () => sendRole(preference));
        roleChooser.append(button);
        roleButtons.set(preference, button);
      });
      setupCard.append(setupTitle, setupHint, roleChooser);

      const lobbyActions = document.createElement("div");
      lobbyActions.className = "pc-lobby-actions";
      const readyButton = createButton("Ready", "primary", () => {
        if (!activeMatch) return;
        enterFullscreenOnPlay = true;
        arcade.game.ready(activeMatch.matchId);
      });
      const claimButton = createButton("Take control", "secondary", () => {
        if (activeMatch) arcade.game.claimControl(activeMatch.matchId);
      });
      const leaveButton = createButton("Leave", "quiet", () => {
        if (activeMatch) arcade.game.leave(activeMatch.matchId);
      });
      lobbyActions.append(readyButton, claimButton, leaveButton);

      const spectatorList = document.createElement("div");
      spectatorList.className = "pc-spectators";

      lobby.append(lobbyHeader, lobbyStatus, seatGrid, setupCard, lobbyActions, spectatorList);

      const arena = document.createElement("div");
      arena.className = "pc-arena";

      const hud = document.createElement("header");
      hud.className = "pc-hud";
      const teamScore = document.createElement("div");
      teamScore.className = "pc-team-score";
      const timer = document.createElement("div");
      timer.className = "pc-timer";
      timer.textContent = "2:00";
      const pelletCounter = document.createElement("div");
      pelletCounter.className = "pc-pellet-counter";
      hud.append(teamScore, timer, pelletCounter);

      const playerStrip = document.createElement("div");
      playerStrip.className = "pc-player-strip";

      const boardShell = document.createElement("div");
      boardShell.className = "pc-board-shell";
      const canvas = document.createElement("canvas");
      canvas.className = "pc-canvas";
      canvas.setAttribute("aria-label", "Pocket Chomp maze");
      const phaseOverlay = document.createElement("div");
      phaseOverlay.className = "pc-phase-overlay";
      boardShell.append(canvas, phaseOverlay);

      const controls = document.createElement("section");
      controls.className = "pc-controls";
      const controlCopy = document.createElement("div");
      controlCopy.className = "pc-control-copy";
      const controlLabel = document.createElement("strong");
      controlLabel.className = "pc-control-label";
      const controlHint = document.createElement("span");
      controlHint.className = "pc-control-hint";
      controlCopy.append(controlLabel, controlHint);
      const dpad = document.createElement("div");
      dpad.className = "pc-dpad";
      DIRECTIONS.forEach((direction, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `pc-dir pc-dir-${index}`;
        button.textContent = direction.symbol;
        button.setAttribute("aria-label", direction.label);
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          sendTurn(index);
        });
        dpad.append(button);
      });
      const arenaActions = document.createElement("div");
      arenaActions.className = "pc-arena-actions";
      const arenaClaimButton = createButton("Take control", "secondary", () => {
        if (activeMatch) arcade.game.claimControl(activeMatch.matchId);
      });
      const arenaLeaveButton = createButton("Leave match", "quiet", () => {
        if (activeMatch) arcade.game.leave(activeMatch.matchId);
      });
      arenaActions.append(arenaClaimButton, arenaLeaveButton);
      controls.append(controlCopy, dpad, arenaActions);

      const resultPanel = document.createElement("section");
      resultPanel.className = "pc-result-panel";
      const resultTitle = document.createElement("h2");
      const resultCopy = document.createElement("p");
      const resultPlacements = document.createElement("div");
      resultPlacements.className = "pc-result-placements";
      const playAgainButton = createButton("Play again", "primary", () => {
        arcade.display.exitFullscreen();
        arcade.game.join(APP_ID);
      });
      resultPanel.append(resultTitle, resultCopy, resultPlacements, playAgainButton);

      arena.append(hud, playerStrip, boardShell, controls, resultPanel);
      stage.append(splash, lobby, arena);
      root.append(topbar, stage, toast);
      container.replaceChildren(root);

      const context = canvas.getContext("2d", { alpha: false });

      function createButton(label, style, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `pc-button pc-button-${style}`;
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
      }

      function ownSeat() {
        return activeMatch?.you?.role === "player" ? activeMatch.you.seat : null;
      }

      function ownState() {
        const seat = ownSeat();
        return gameState?.players?.find((player) => player.seat === seat) || null;
      }

      function seatState(seat) {
        return gameState?.players?.find((player) => player.seat === seat) || null;
      }

      function sendRole(preference) {
        if (!activeMatch || activeMatch.state !== "waiting" || activeMatch.you?.role !== "player") return;
        arcade.game.send(activeMatch.matchId, "role", { preference });
      }

      function sendTurn(direction) {
        if (!connected || !activeMatch || !gameState || gameState.phase !== "playing") return;
        if (activeMatch.you?.role !== "player" || !activeMatch.you.controller) return;
        arcade.game.send(activeMatch.matchId, "turn", { direction });
      }

      function clearMatchState() {
        activeMatch = null;
        latestSnapshotRevision = -1;
        gameState = null;
        result = null;
        renderPlayers.clear();
        effects.length = 0;
        enterFullscreenOnPlay = false;
        arcade.display.exitFullscreen();
        renderUI();
      }

      function acceptMatch(match) {
        if (match.you?.role === "none") {
          if (!activeMatch || match.matchId === activeMatch.matchId) clearMatchState();
          return;
        }
        if (!activeMatch || match.matchId !== activeMatch.matchId) {
          latestSnapshotRevision = -1;
          gameState = null;
          result = null;
          renderPlayers.clear();
          effects.length = 0;
          enterFullscreenOnPlay = false;
        }
        activeMatch = match;
        renderUI();
      }

      function updateRenderTargets() {
        if (!gameState?.players) return;
        const seen = new Set();
        gameState.players.forEach((player) => {
          seen.add(player.seat);
          const current = renderPlayers.get(player.seat);
          if (!current) {
            renderPlayers.set(player.seat, {
              x: player.x,
              y: player.y,
              targetX: player.x,
              targetY: player.y,
              player,
            });
          } else {
            current.targetX = player.x;
            current.targetY = player.y;
            current.player = player;
          }
        });
        for (const seat of renderPlayers.keys()) {
          if (!seen.has(seat)) renderPlayers.delete(seat);
        }
      }

      function renderUI() {
        const isMember = Boolean(activeMatch && activeMatch.you?.role !== "none");
        const isPlayer = activeMatch?.you?.role === "player";
        const inArena = Boolean(
          activeMatch &&
          (activeMatch.state === "playing" || gameState?.phase === "countdown" || gameState?.phase === "playing" || gameState?.phase === "finished")
        );

        splash.hidden = isMember;
        lobby.hidden = !isMember || inArena;
        arena.hidden = !inArena;
        root.classList.toggle("is-spectator", activeMatch?.you?.role === "spectator");
        root.classList.toggle("is-disconnected", !connected);
        root.classList.toggle("is-playing", inArena);

        connectionText.textContent = connected ? "Connected" : "Reconnecting";
        connectionBadge.classList.toggle("is-connected", connected);
        splashJoinButton.disabled = !connected;
        fullscreenButton.hidden = !inArena || arcade.display.fullscreen;
        fullscreenButton.textContent = arcade.display.fullscreen ? "Windowed" : "Full screen";

        readyButton.hidden = !isPlayer;
        claimButton.hidden = !isPlayer || Boolean(activeMatch?.you?.controller);
        leaveButton.hidden = !isMember;
        setupCard.hidden = !isPlayer;

        renderLobby();
        renderArena();
      }

      function renderLobby() {
        if (!activeMatch) {
          lobbyStatus.textContent = connected
            ? "Choose Join to enter a match."
            : "Reconnecting to PocketArcade…";
          seatGrid.replaceChildren();
          spectatorList.replaceChildren();
          readyButton.disabled = true;
          return;
        }

        if (activeMatch.you?.role === "spectator") {
          lobbyStatus.textContent = "You are spectating. The next match will open after this one finishes.";
        } else if (activeMatch.state === "waiting") {
          lobbyStatus.textContent = "Choose a role preference, then press Ready.";
        } else {
          lobbyStatus.textContent = "Match starting…";
        }

        const stateBySeat = new Map((gameState?.players || []).map((player) => [player.seat, player]));
        const cards = [];
        const orderedSeats = activeMatch.seats.slice().sort((a, b) => {
          const aOwn = a.seat === ownSeat() ? 0 : 1;
          const bOwn = b.seat === ownSeat() ? 0 : 1;
          if (aOwn !== bOwn) return aOwn - bOwn;
          const aOpen = a.player ? 0 : 1;
          const bOpen = b.player ? 0 : 1;
          return aOpen - bOpen || a.seat - b.seat;
        });
        orderedSeats.forEach((seat) => {
          const card = document.createElement("article");
          card.className = "pc-seat-card";
          card.dataset.seat = String(seat.seat);
          if (!seat.player) card.classList.add("is-open");
          if (seat.seat === ownSeat()) card.classList.add("is-you");

          const avatar = document.createElement("div");
          avatar.className = "pc-avatar";
          if (seat.player?.avatarUrl) {
            const image = document.createElement("img");
            image.src = seat.player.avatarUrl;
            image.alt = "";
            image.addEventListener("error", () => {
              avatar.replaceChildren(initialsNode(seat.player.nickname));
            }, { once: true });
            avatar.append(image);
          } else if (seat.player) {
            avatar.append(initialsNode(seat.player.nickname));
          } else {
            avatar.textContent = "+";
          }

          const copy = document.createElement("div");
          copy.className = "pc-seat-copy";
          const name = document.createElement("strong");
          name.textContent = seat.player?.nickname || "Open Seat";
          const meta = document.createElement("span");
          const playerState = stateBySeat.get(seat.seat);
          if (!seat.player) {
            meta.textContent = "Waiting for player";
          } else if (playerState) {
            meta.textContent = `${preferenceLabel(playerState.preference)} · ${seat.ready ? "Ready" : "Choosing"}`;
          } else {
            meta.textContent = seat.ready ? "Ready" : "Choosing";
          }
          copy.append(name, meta);

          const badge = document.createElement("span");
          badge.className = `pc-ready-badge ${seat.ready ? "is-ready" : ""}`;
          badge.textContent = seat.ready ? "✓" : String(seat.seat);
          card.append(avatar, copy, badge);
          cards.push(card);
        });
        seatGrid.replaceChildren(...cards);

        const own = ownState();
        for (const [preference, button] of roleButtons) {
          button.classList.toggle("is-selected", own?.preference === preference);
          button.disabled = !connected || activeMatch.state !== "waiting" || ownSeatReady();
        }

        readyButton.disabled = !connected || activeMatch.state !== "waiting" || ownSeatReady();
        readyButton.textContent = ownSeatReady() ? "Ready ✓" : "Ready";

        const spectatorNodes = [];
        if (activeMatch.spectators?.length) {
          const label = document.createElement("strong");
          label.textContent = "Spectating";
          spectatorNodes.push(label);
          activeMatch.spectators.forEach((spectator) => {
            const pill = document.createElement("span");
            pill.className = "pc-spectator-pill";
            pill.textContent = spectator.nickname;
            spectatorNodes.push(pill);
          });
        }
        spectatorList.replaceChildren(...spectatorNodes);
      }

      function ownSeatReady() {
        const seat = activeMatch?.seats?.find((entry) => entry.seat === ownSeat());
        return Boolean(seat?.ready);
      }

      function initialsNode(name) {
        const span = document.createElement("span");
        span.textContent = String(name || "?")
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0] || "")
          .join("")
          .toUpperCase();
        return span;
      }

      function preferenceLabel(preference) {
        if (preference === "chomper") return "Chomper preference";
        if (preference === "ghost") return "Ghost preference";
        return "Flexible";
      }

      function renderArena() {
        if (!gameState) {
          phaseOverlay.hidden = false;
          phaseOverlay.textContent = "Loading maze…";
          return;
        }

        if (enterFullscreenOnPlay && activeMatch?.you?.role === "player" &&
            (gameState.phase === "countdown" || gameState.phase === "playing")) {
          enterFullscreenOnPlay = false;
          arcade.display.requestFullscreen();
        }

        const players = (gameState.players || []).slice().sort((a, b) => {
          if (a.seat === ownSeat()) return -1;
          if (b.seat === ownSeat()) return 1;
          return a.seat - b.seat;
        });
        const chomperScore = players
          .filter((player) => player.role === "chomper")
          .reduce((sum, player) => sum + player.score, 0);
        const ghostScore = players
          .filter((player) => player.role === "ghost")
          .reduce((sum, player) => sum + player.score, 0);

        teamScore.replaceChildren();
        const chomperTeam = document.createElement("span");
        chomperTeam.className = "pc-score-chomper";
        chomperTeam.textContent = `◖ ${chomperScore}`;
        const divider = document.createElement("span");
        divider.className = "pc-score-divider";
        divider.textContent = "vs";
        const ghostTeam = document.createElement("span");
        ghostTeam.className = "pc-score-ghost";
        ghostTeam.textContent = `${ghostScore} ♟`;
        teamScore.append(chomperTeam, divider, ghostTeam);

        timer.textContent = formatTime(gameState.roundTimeMs);
        pelletCounter.textContent = `• ${gameState.pelletsRemaining}`;

        const playerCards = players.map((player) => {
          const card = document.createElement("article");
          card.className = `pc-player-card role-${player.role}`;
          card.dataset.seat = String(player.seat);
          if (player.seat === ownSeat()) card.classList.add("is-you");
          if (!player.active) card.classList.add("is-inactive");
          const icon = document.createElement("span");
          icon.className = "pc-player-icon";
          icon.textContent = player.role === "chomper" ? "◖" : "♟";
          const copy = document.createElement("span");
          const name = document.createElement("strong");
          name.textContent = player.nickname;
          const stats = document.createElement("small");
          stats.textContent = player.role === "chomper"
            ? `${player.score} · ${"●".repeat(Math.max(0, player.lives))}`
            : `${player.score} points`;
          copy.append(name, stats);
          card.append(icon, copy);
          return card;
        });
        const spectatorCards = (activeMatch?.spectators || []).map((spectator) => {
          const card = document.createElement("article");
          card.className = "pc-player-card role-spectator";
          const avatar = document.createElement("span");
          avatar.className = "pc-player-avatar";
          if (spectator.avatarUrl) {
            const image = document.createElement("img");
            image.src = spectator.avatarUrl;
            image.alt = "";
            image.addEventListener("error", () => {
              avatar.replaceChildren(initialsNode(spectator.nickname));
            }, { once: true });
            avatar.append(image);
          } else {
            avatar.append(initialsNode(spectator.nickname));
          }
          const name = document.createElement("strong");
          name.textContent = spectator.nickname;
          card.append(avatar, name);
          return card;
        });
        playerStrip.replaceChildren(...playerCards, ...spectatorCards);

        const own = ownState();
        const isSpectating = activeMatch?.you?.role === "spectator";
        controlLabel.textContent = isSpectating
          ? "Spectating live"
          : own
            ? `You are ${own.role === "chomper" ? "a Chomper" : "a Ghost"}`
            : "Waiting for role";
        controlHint.textContent = isSpectating
          ? "Watch the chase and player scores."
          : activeMatch?.you?.controller
            ? "Swipe the maze or use the direction controls."
            : "This profile is controlled in another tab.";

        const controlsEnabled = Boolean(
          connected &&
          activeMatch?.you?.role === "player" &&
          activeMatch.you.controller &&
          gameState.phase === "playing" &&
          own?.active
        );
        controls.classList.toggle("is-active", controlsEnabled);
        controls.classList.toggle("is-spectating", isSpectating);
        dpad.hidden = isSpectating;
        dpad.querySelectorAll("button").forEach((button) => {
          button.disabled = !controlsEnabled;
          button.setAttribute("aria-disabled", String(!controlsEnabled));
        });
        arenaClaimButton.hidden = activeMatch?.you?.role !== "player" || Boolean(activeMatch?.you?.controller);
        arenaLeaveButton.hidden = !activeMatch || activeMatch.you?.role === "none";

        if (gameState.phase === "countdown") {
          phaseOverlay.hidden = false;
          phaseOverlay.textContent = String(Math.max(1, Math.ceil(gameState.countdownMs / 1000)));
        } else if (gameState.phase === "playing" && !own?.active && own?.respawnMs > 0) {
          phaseOverlay.hidden = false;
          phaseOverlay.textContent = `Respawning ${Math.ceil(own.respawnMs / 1000)}`;
        } else if (gameState.phase === "playing" && own?.role === "chomper" && own?.lives <= 0) {
          phaseOverlay.hidden = false;
          phaseOverlay.textContent = "Caught — watch your team";
        } else {
          phaseOverlay.hidden = true;
        }

        const finished = gameState.phase === "finished" || Boolean(result);
        resultPanel.hidden = !finished;
        boardShell.classList.toggle("is-finished", finished);
        controls.hidden = finished;
        if (finished) renderResult();
      }

      function renderResult() {
        const winner = gameState?.winnerTeam;
        if (winner === "chomper") {
          resultTitle.textContent = "Chompers win!";
          resultCopy.textContent = finishReasonCopy(gameState?.finishReason);
        } else if (winner === "ghost") {
          resultTitle.textContent = "Ghosts win!";
          resultCopy.textContent = finishReasonCopy(gameState?.finishReason);
        } else {
          resultTitle.textContent = "Draw";
          resultCopy.textContent = "Both teams finish level.";
        }

        const placements = result?.payload?.placements || [];
        const rows = placements
          .slice()
          .sort((a, b) => a.place - b.place || a.seat - b.seat)
          .map((placement) => {
            const row = document.createElement("div");
            row.className = "pc-placement";
            const place = document.createElement("strong");
            place.textContent = placement.place === 1 ? "Winner" : `Place ${placement.place}`;
            const name = document.createElement("span");
            name.textContent = placement.nickname;
            const wins = document.createElement("small");
            wins.textContent = `${placement.wins} total wins`;
            row.append(place, name, wins);
            return row;
          });
        resultPlacements.replaceChildren(...rows);
      }

      function finishReasonCopy(reason) {
        const reasons = {
          maze_cleared: "Every pellet was cleared before time ran out.",
          all_chompers_caught: "Every Chomper ran out of lives.",
          time_expired: "The Ghosts defended the maze until time expired.",
          opponents_left: "The opposing team left the match.",
          chompers_left: "No Chompers remained in the maze.",
          ghosts_left: "No Ghosts remained in the maze.",
        };
        return reasons[reason] || "The round is complete.";
      }

      function formatTime(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        return `${minutes}:${seconds}`;
      }

      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }

      function animate() {
        resizeCanvas();
        draw(performance.now());
        frameId = requestAnimationFrame(animate);
      }

      function draw(now) {
        const width = canvas.width;
        const height = canvas.height;
        if (!width || !height) return;

        context.fillStyle = "#050711";
        context.fillRect(0, 0, width, height);

        const scale = Math.min(width / WIDTH, height / HEIGHT);
        const offsetX = (width - WIDTH * scale) / 2;
        const offsetY = (height - HEIGHT * scale) / 2;
        context.save();
        context.translate(offsetX, offsetY);

        drawMaze(scale, now);
        updateInterpolatedPlayers();
        for (const renderPlayer of renderPlayers.values()) {
          drawPlayer(renderPlayer, scale, now);
        }
        drawEffects(scale, now);
        context.restore();
      }

      function drawMaze(scale, now) {
        const wallInset = scale * 0.08;
        for (let y = 0; y < HEIGHT; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            if (MAP[y][x] === "#") {
              const left = x * scale + wallInset;
              const top = y * scale + wallInset;
              const size = scale - wallInset * 2;
              context.fillStyle = "#191a4a";
              roundRect(context, left, top, size, size, scale * 0.18);
              context.fill();
              context.strokeStyle = "#655cff";
              context.lineWidth = Math.max(1, scale * 0.06);
              context.stroke();
            }
          }
        }

        if (!gameState?.pelletRows || !gameState?.powerRows) return;
        for (let y = 0; y < HEIGHT; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            const centreX = (x + 0.5) * scale;
            const centreY = (y + 0.5) * scale;
            if (maskHas(gameState.pelletRows[y], x)) {
              context.beginPath();
              context.arc(centreX, centreY, Math.max(1.2, scale * 0.09), 0, Math.PI * 2);
              context.fillStyle = "#ffe8ac";
              context.fill();
            } else if (maskHas(gameState.powerRows[y], x)) {
              const pulse = 0.17 + Math.sin(now / 130) * 0.035;
              context.beginPath();
              context.arc(centreX, centreY, Math.max(2.5, scale * pulse), 0, Math.PI * 2);
              context.fillStyle = "#ffffff";
              context.shadowColor = "#8bf9ff";
              context.shadowBlur = scale * 0.5;
              context.fill();
              context.shadowBlur = 0;
            }
          }
        }
      }

      function maskHas(mask, x) {
        if (!Number.isFinite(Number(mask))) return false;
        const bit = 2 ** x;
        return Math.floor(Number(mask) / bit) % 2 === 1;
      }

      function updateInterpolatedPlayers() {
        for (const renderPlayer of renderPlayers.values()) {
          let dx = renderPlayer.targetX - renderPlayer.x;
          if (Math.abs(dx) > WIDTH / 2) dx -= Math.sign(dx) * WIDTH;
          renderPlayer.x = (renderPlayer.x + dx * 0.34 + WIDTH) % WIDTH;
          renderPlayer.y += (renderPlayer.targetY - renderPlayer.y) * 0.34;
        }
      }

      function drawPlayer(renderPlayer, scale, now) {
        const player = renderPlayer.player;
        if (!player.active && player.respawnMs <= 0) return;
        const x = (renderPlayer.x + 0.5) * scale;
        const y = (renderPlayer.y + 0.5) * scale;
        const radius = scale * 0.39;

        if (!player.active) {
          context.beginPath();
          context.arc(x, y, radius * (0.75 + 0.12 * Math.sin(now / 100)), 0, Math.PI * 2);
          context.strokeStyle = player.role === "chomper" ? "#ffe24a" : "#ff5ca8";
          context.globalAlpha = 0.55;
          context.lineWidth = Math.max(2, scale * 0.08);
          context.stroke();
          context.globalAlpha = 1;
          return;
        }

        if (player.invulnerable && Math.floor(now / 100) % 2 === 0) {
          context.globalAlpha = 0.45;
        }
        if (player.role === "chomper") {
          drawChomper(x, y, radius, player, now);
        } else {
          drawGhost(x, y, radius, player, now);
        }
        context.globalAlpha = 1;

        context.font = `${Math.max(9, scale * 0.24)}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillStyle = "rgba(255,255,255,0.88)";
        context.fillText(player.nickname, x, y - radius - scale * 0.1);
      }

      function drawChomper(x, y, radius, player, now) {
        const colour = CHOMPER_COLOURS[(Math.max(1, player.roleIndex) - 1) % CHOMPER_COLOURS.length];
        const facing = [Math.PI * 1.5, 0, Math.PI * 0.5, Math.PI][Math.max(0, player.direction)] || 0;
        const mouth = 0.17 + Math.abs(Math.sin(now / 90)) * 0.3;
        context.beginPath();
        context.moveTo(x, y);
        context.arc(x, y, radius, facing + mouth, facing + Math.PI * 2 - mouth);
        context.closePath();
        context.fillStyle = colour;
        context.shadowColor = colour;
        context.shadowBlur = radius * 0.5;
        context.fill();
        context.shadowBlur = 0;
      }

      function drawGhost(x, y, radius, player, now) {
        const frightened = Number(gameState?.powerMs || 0) > 0;
        const flash = Number(gameState?.powerMs || 0) < 1800 && Math.floor(now / 130) % 2 === 0;
        const colour = frightened
          ? (flash ? "#f5f7ff" : "#5146d8")
          : GHOST_COLOURS[(Math.max(1, player.roleIndex) - 1) % GHOST_COLOURS.length];
        const left = x - radius;
        const top = y - radius;
        const width = radius * 2;
        const bottom = y + radius;

        context.beginPath();
        context.moveTo(left, bottom);
        context.lineTo(left, y);
        context.arc(x, y, radius, Math.PI, 0);
        context.lineTo(x + radius, bottom);
        context.lineTo(x + radius * 0.5, bottom - radius * 0.28);
        context.lineTo(x, bottom);
        context.lineTo(x - radius * 0.5, bottom - radius * 0.28);
        context.closePath();
        context.fillStyle = colour;
        context.shadowColor = colour;
        context.shadowBlur = radius * 0.35;
        context.fill();
        context.shadowBlur = 0;

        if (frightened) {
          context.fillStyle = flash ? "#5146d8" : "#ffffff";
          context.beginPath();
          context.arc(x - radius * 0.35, y, radius * 0.11, 0, Math.PI * 2);
          context.arc(x + radius * 0.35, y, radius * 0.11, 0, Math.PI * 2);
          context.fill();
          return;
        }

        const lookX = [0, 0.11, 0, -0.11][Math.max(0, player.direction)] || 0;
        const lookY = [-0.11, 0, 0.11, 0][Math.max(0, player.direction)] || 0;
        [-0.35, 0.35].forEach((offset) => {
          context.beginPath();
          context.ellipse(x + radius * offset, y - radius * 0.12, radius * 0.25, radius * 0.32, 0, 0, Math.PI * 2);
          context.fillStyle = "#ffffff";
          context.fill();
          context.beginPath();
          context.arc(x + radius * (offset + lookX), y + radius * (-0.12 + lookY), radius * 0.11, 0, Math.PI * 2);
          context.fillStyle = "#151936";
          context.fill();
        });
      }

      function roundRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
      }

      function addEffect(text, seat, kind) {
        const renderPlayer = renderPlayers.get(seat);
        if (!renderPlayer) return;
        effects.push({
          text,
          x: renderPlayer.x,
          y: renderPlayer.y,
          kind,
          started: performance.now(),
        });
        while (effects.length > 12) effects.shift();
      }

      function drawEffects(scale, now) {
        for (let index = effects.length - 1; index >= 0; index -= 1) {
          const effect = effects[index];
          const age = now - effect.started;
          if (age > 900) {
            effects.splice(index, 1);
            continue;
          }
          const alpha = 1 - age / 900;
          context.globalAlpha = alpha;
          context.font = `700 ${Math.max(11, scale * 0.32)}px system-ui, sans-serif`;
          context.textAlign = "center";
          context.fillStyle = effect.kind === "power" ? "#8bf9ff" : "#ffffff";
          context.fillText(effect.text, (effect.x + 0.5) * scale, (effect.y + 0.2 - age / 1800) * scale);
          context.globalAlpha = 1;
        }
      }

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(showToast.timeoutId);
        showToast.timeoutId = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
      }

      function onKeyDown(event) {
        const keyMap = {
          ArrowUp: 0,
          w: 0,
          W: 0,
          ArrowRight: 1,
          d: 1,
          D: 1,
          ArrowDown: 2,
          s: 2,
          S: 2,
          ArrowLeft: 3,
          a: 3,
          A: 3,
        };
        if (!(event.key in keyMap)) return;
        event.preventDefault();
        sendTurn(keyMap[event.key]);
      }

      canvas.addEventListener("pointerdown", (event) => {
        swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
        canvas.setPointerCapture?.(event.pointerId);
      });
      canvas.addEventListener("pointerup", (event) => {
        if (!swipeStart || swipeStart.id !== event.pointerId) return;
        const dx = event.clientX - swipeStart.x;
        const dy = event.clientY - swipeStart.y;
        swipeStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
        if (Math.abs(dx) > Math.abs(dy)) sendTurn(dx > 0 ? 1 : 3);
        else sendTurn(dy > 0 ? 2 : 0);
      });
      canvas.addEventListener("pointercancel", () => {
        swipeStart = null;
      });
      document.addEventListener("keydown", onKeyDown);

      const stopMatch = arcade.game.onMatch((match) => {
        acceptMatch(match);
      });

      const stopSnapshot = arcade.game.onSnapshot((snapshot) => {
        if (!activeMatch || snapshot.matchId !== activeMatch.matchId) return;
        const revision = Number(snapshot.revision);
        if (!Number.isFinite(revision) || revision < latestSnapshotRevision) return;
        latestSnapshotRevision = revision;
        gameState = snapshot.payload;
        updateRenderTargets();
        renderUI();
      });

      const stopEvent = arcade.game.onEvent((event) => {
        if (!activeMatch || event.matchId !== activeMatch.matchId) return;
        const payload = event.payload || {};
        if (event.name === "go") {
          showToast("GO!");
        } else if (event.name === "power") {
          addEffect("POWER!", payload.seat, "power");
        } else if (event.name === "ghost_eaten") {
          addEffect(`+${payload.bonus}`, payload.chomperSeat, "score");
        } else if (event.name === "chomper_hit") {
          addEffect("CAUGHT", payload.chomperSeat, "hit");
        }
      });

      const stopResult = arcade.game.onResult((nextResult) => {
        if (!activeMatch || nextResult.matchId !== activeMatch.matchId) return;
        result = nextResult;
        arcade.display.exitFullscreen();
        renderUI();
      });

      const stopError = arcade.game.onError((error) => {
        if (error.matchId && (!activeMatch || error.matchId !== activeMatch.matchId)) return;
        if (error.code === "match_not_found") {
          // A final turn command can cross the authoritative finish message.
          // Keep the completed result screen instead of replacing it with a
          // misleading closed-match error.
          if (result || gameState?.phase === "finished" || activeMatch?.state === "finished") {
            renderUI();
            return;
          }
          clearMatchState();
          showToast("That match has closed. Join a new one.");
          return;
        }
        if (error.code === "runtime_failed") {
          clearMatchState();
          showToast("The game runtime stopped. Join a fresh match.");
        } else if (error.code === "rate_limited" || error.code === "queue_full") {
          showToast("Input is moving too quickly. Try again.");
        } else {
          showToast(error.message || "Game error");
        }
      });

      const stopConnection = arcade.onConnection((status) => {
        connected = status !== "disconnected";
        if (!connected) swipeStart = null;
        renderUI();
      });

      const stopFullscreen = arcade.display.onFullscreenChange((fullscreen) => {
        root.classList.toggle("fullscreen", fullscreen);
        fullscreenButton.hidden = fullscreen || arena.hidden;
        fullscreenButton.textContent = "Full screen";
        window.requestAnimationFrame(resizeCanvas);
      });

      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(boardShell);

      const cachedMatch = arcade.game.currentMatch();
      if (cachedMatch && cachedMatch.you?.role !== "none") {
        acceptMatch(cachedMatch);
        const cachedSnapshot = arcade.game.currentSnapshot();
        if (cachedSnapshot && cachedSnapshot.matchId === cachedMatch.matchId) {
          latestSnapshotRevision = Number(cachedSnapshot.revision) || -1;
          gameState = cachedSnapshot.payload;
          updateRenderTargets();
        }
        if (cachedMatch.state !== "finished") arcade.game.requestSnapshot(cachedMatch.matchId);
      }

      renderUI();
      frameId = requestAnimationFrame(animate);

      return () => {
        stopMatch();
        stopSnapshot();
        stopEvent();
        stopResult();
        stopError();
        stopConnection();
        stopFullscreen();
        document.removeEventListener("keydown", onKeyDown);
        resizeObserver?.disconnect();
        cancelAnimationFrame(frameId);
        window.clearTimeout(showToast.timeoutId);
        swipeStart = null;
        renderPlayers.clear();
        effects.length = 0;
        arcade.display.exitFullscreen();
        container.replaceChildren();
      };
    },
  };
})();

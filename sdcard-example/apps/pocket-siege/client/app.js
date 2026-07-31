"use strict";

(() => {
  const APP_ID = "pocket-siege";
  const WORLD_W = 1000;
  const WORLD_H = 560;
  const MAX_PULL = 150;
  const PROJECTILES = {
    boulder: {
      name: "Boulder",
      icon: "●",
      description: "Heavy impact. No mid-flight ability.",
    },
    splitter: {
      name: "Splitter",
      icon: "✦",
      description: "Tap during flight to divide into three shots.",
    },
    bomber: {
      name: "Bomber",
      icon: "◆",
      description: "Tap during flight to drop an explosive charge.",
    },
  };
  const MAPS = {
    canyon: {
      name: "Dust Canyon",
      description: "Balanced gravity and sturdy stone foundations.",
    },
    harbour: {
      name: "Storm Harbour",
      description: "Heavier gravity and timber-heavy fortifications.",
    },
    moonbase: {
      name: "Moonbase Nine",
      description: "Lower gravity with brittle glass towers.",
    },
  };

  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;
  const splashUrl = new URL("../assets/splash.jpg", assetBase).href;

  window.PocketArcadeApps = window.PocketArcadeApps || {};
  window.PocketArcadeApps[APP_ID] = {
    mount(container, arcade) {
      let activeMatch = null;
      let latestSnapshotRevision = -1;
      let snapshot = null;
      let previousSnapshot = null;
      let result = null;
      let ownLoadout = [];
      let loadoutDraft = [];
      let loadoutPending = false;
      let aim = null;
      let rafId = 0;
      let destroyed = false;
      let lastPhase = "";
      let statusMessage = "Choose Join to play.";
      let statusKind = "neutral";
      let effects = [];
      let canvasScale = 1;
      let canvasOffsetX = 0;
      let canvasOffsetY = 0;

      const root = document.createElement("section");
      root.className = "pocket-siege";
      root.innerHTML = `
        <header class="pocket-siege__topbar">
          <div class="pocket-siege__brand">
            <img class="pocket-siege__icon" data-ref="icon" alt="" />
            <div>
              <h1>Pocket Siege</h1>
              <p>Two-player slingshot fortress battle</p>
            </div>
          </div>
          <div class="pocket-siege__connection" data-ref="connection">Connecting…</div>
        </header>

        <div class="pocket-siege__notice" data-ref="notice" role="status" aria-live="polite"></div>

        <main class="pocket-siege__main">
          <section class="pocket-siege__splash" data-view="splash">
            <div class="pocket-siege__splash-art">
              <img data-ref="splash-image" alt="Pocket Siege, a two-fortress slingshot battle" />
            </div>
            <div class="pocket-siege__splash-panel">
              <span class="pocket-siege__eyebrow">PocketArcade battle game</span>
              <p>Choose your projectile order, vote for an arena and break the rival fortress before yours falls.</p>
              <div class="pocket-siege__game-facts" aria-label="Game details">
                <span><strong>v1.2.0</strong> Version</span>
                <span><strong>2</strong> Players</span>
                <span><strong>5</strong> Shots each</span>
              </div>
              <button type="button" class="pocket-siege__button pocket-siege__button--primary pocket-siege__button--hero" data-action="join" data-ref="splash-join">Join game</button>
            </div>
          </section>

          <section class="pocket-siege__panel pocket-siege__lobby" data-view="lobby" hidden>
            <div class="pocket-siege__panel-heading">
              <div>
                <span class="pocket-siege__eyebrow">Match lobby</span>
                <h2>Prepare the siege</h2>
              </div>
              <span class="pocket-siege__badge" data-ref="lobby-state">Waiting</span>
            </div>
            <div class="pocket-siege__seats" data-ref="seats"></div>
            <div class="pocket-siege__spectators" data-ref="spectators"></div>
            <div class="pocket-siege__membership-bar">
              <p data-ref="lobby-help">Two players must join and ready up.</p>
              <div class="pocket-siege__actions">
                <button type="button" class="pocket-siege__button pocket-siege__button--primary" data-action="platform-ready">Ready</button>
                <button type="button" class="pocket-siege__button" data-action="claim-control">Take control</button>
                <button type="button" class="pocket-siege__button pocket-siege__button--danger" data-action="leave">Leave</button>
              </div>
            </div>
          </section>

          <section class="pocket-siege__panel pocket-siege__setup" data-view="setup" hidden>
            <div class="pocket-siege__panel-heading">
              <div>
                <span class="pocket-siege__eyebrow" data-ref="setup-step">Battle setup</span>
                <h2 data-ref="setup-title">Choose your loadout</h2>
              </div>
              <span class="pocket-siege__badge" data-ref="setup-progress">1 / 3</span>
            </div>
            <div data-ref="setup-content"></div>
            <div class="pocket-siege__setup-status" data-ref="setup-status"></div>
          </section>

          <section class="pocket-siege__battle" data-view="battle" hidden>
            <div class="pocket-siege__hud">
              <div class="pocket-siege__player-hud" data-ref="player-1"></div>
              <div class="pocket-siege__turn-hud">
                <span data-ref="turn-label">Turn 1</span>
                <strong data-ref="timer">20</strong>
              </div>
              <div class="pocket-siege__player-hud pocket-siege__player-hud--right" data-ref="player-2"></div>
            </div>

            <div class="pocket-siege__canvas-wrap" data-ref="canvas-wrap">
              <canvas class="pocket-siege__canvas" data-ref="canvas" aria-label="Pocket Siege battlefield"></canvas>
            </div>

            <div class="pocket-siege__battle-controls" data-ref="context-panel">
              <div class="pocket-siege__instruction">
                <span class="pocket-siege__instruction-kicker" data-ref="turn-state">Waiting</span>
                <strong data-ref="battle-message">Loading battlefield…</strong>
                <span data-ref="control-help">The current action appears here.</span>
              </div>
              <div class="pocket-siege__projectile-readout">
                <span class="pocket-siege__projectile-icon" data-ref="projectile-icon">●</span>
                <div>
                  <strong data-ref="projectile-name">Boulder</strong>
                  <span data-ref="projectile-help">Heavy impact. No mid-flight ability.</span>
                </div>
              </div>
              <button type="button" class="pocket-siege__ability" data-action="activate" disabled aria-disabled="true">
                No ability
              </button>
            </div>
          </section>

          <section class="pocket-siege__panel pocket-siege__result" data-view="result" hidden>
            <span class="pocket-siege__eyebrow">Match complete</span>
            <h2 data-ref="result-title">Battle complete</h2>
            <p data-ref="result-summary"></p>
            <div class="pocket-siege__result-placements" data-ref="result-placements"></div>
            <div class="pocket-siege__actions pocket-siege__actions--center">
              <button type="button" class="pocket-siege__button pocket-siege__button--primary" data-action="play-again">Play another match</button>
              <button type="button" class="pocket-siege__button" data-action="exit-fullscreen">Exit fullscreen</button>
            </div>
          </section>
        </main>
      `;

      const refs = {};
      root.querySelectorAll("[data-ref]").forEach((node) => {
        refs[node.dataset.ref] = node;
      });
      refs.icon.src = iconUrl;
      refs["splash-image"].src = splashUrl;
      const canvas = refs.canvas;
      const ctx = canvas.getContext("2d", { alpha: false });

      function setNotice(message, kind = "neutral") {
        statusMessage = message || "";
        statusKind = kind;
        refs.notice.textContent = statusMessage;
        refs.notice.dataset.kind = statusKind;
        refs.notice.hidden = !statusMessage;
      }

      function setView(name) {
        root.dataset.screen = name;
        root.querySelectorAll("[data-view]").forEach((view) => {
          view.hidden = view.dataset.view !== name;
        });
      }

      function ownSeat() {
        return activeMatch?.you?.role === "player" ? Number(activeMatch.you.seat) : 0;
      }

      function hasControl() {
        return Boolean(activeMatch?.you?.controller);
      }

      function playerFromPayload(seat) {
        const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
        return players.find((player) => Number(player.seat) === seat) || null;
      }

      function playerFromMatch(seat) {
        const seats = Array.isArray(activeMatch?.seats) ? activeMatch.seats : [];
        return seats.find((entry) => Number(entry.seat) === seat)?.player || null;
      }

      function initials(name) {
        return String(name || "?")
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("") || "?";
      }

      function makeAvatar(profile, seat) {
        const wrapper = document.createElement("span");
        wrapper.className = `pocket-siege__avatar pocket-siege__avatar--${seat}`;
        wrapper.textContent = initials(profile?.nickname);
        if (profile?.avatarUrl) {
          const image = document.createElement("img");
          image.alt = "";
          image.src = profile.avatarUrl;
          image.addEventListener("load", () => {
            wrapper.replaceChildren(image);
          }, { once: true });
          image.addEventListener("error", () => image.remove(), { once: true });
        }
        return wrapper;
      }

      function renderConnection() {
        const value = arcade.connectionStatus || "unknown";
        refs.connection.textContent = value === "connected" ? "Online" : value;
        refs.connection.dataset.state = value;
      }

      function renderSplash() {
        setView("splash");
        refs["splash-join"].disabled = arcade.connectionStatus !== "connected";
        refs["splash-join"].setAttribute("aria-disabled", refs["splash-join"].disabled ? "true" : "false");
        setNotice(arcade.connectionStatus === "connected" ? "" : "Connecting to PocketArcade…");
      }

      function renderLobby() {
        setView("lobby");
        const matchState = activeMatch?.state || "not joined";
        refs["lobby-state"].textContent = matchState === "waiting" ? "Waiting" : matchState;
        refs.seats.replaceChildren();

        const viewerSeat = ownSeat();
        const seatOrder = viewerSeat > 0 ? [viewerSeat, viewerSeat === 1 ? 2 : 1] : [1, 2];
        seatOrder.forEach((seat) => {
          const matchSeat = activeMatch?.seats?.find((entry) => Number(entry.seat) === seat);
          const card = document.createElement("article");
          card.className = `pocket-siege__seat pocket-siege__seat--${seat}`;
          const avatar = makeAvatar(matchSeat?.player, seat);
          const details = document.createElement("div");
          const name = document.createElement("strong");
          const meta = document.createElement("span");

          if (matchSeat?.player) {
            name.textContent = matchSeat.player.nickname;
            meta.textContent = matchSeat.ready ? "Ready for battle" : "Not ready";
            card.dataset.ready = matchSeat.ready ? "true" : "false";
          } else {
            name.textContent = "Open Seat";
            meta.textContent = "Waiting for player";
            card.dataset.ready = "false";
          }
          details.append(name, meta);
          const marker = document.createElement("span");
          marker.className = "pocket-siege__seat-marker";
          marker.textContent = `P${seat}`;
          card.append(avatar, details, marker);
          refs.seats.append(card);
        });

        refs.spectators.replaceChildren();
        const spectators = Array.isArray(activeMatch?.spectators) ? activeMatch.spectators : [];
        if (spectators.length) {
          const label = document.createElement("span");
          label.className = "pocket-siege__spectator-label";
          label.textContent = "Spectators";
          refs.spectators.append(label);
          spectators.forEach((profile) => {
            const chip = document.createElement("span");
            chip.className = "pocket-siege__spectator";
            chip.append(makeAvatar(profile, "spectator"));
            const name = document.createElement("span");
            name.textContent = profile.nickname;
            chip.append(name);
            refs.spectators.append(chip);
          });
        }

        const role = activeMatch?.you?.role || "none";
        const myMatchSeat = activeMatch?.seats?.find((entry) => Number(entry.seat) === ownSeat());
        const readyButton = root.querySelector('[data-action="platform-ready"]');
        const claimButton = root.querySelector('[data-action="claim-control"]');
        const leaveButton = root.querySelector('[data-action="leave"]');

        readyButton.hidden = role !== "player" || matchState !== "waiting" || Boolean(myMatchSeat?.ready);
        claimButton.hidden = role !== "player" || hasControl();
        leaveButton.hidden = role === "none";

        refs["lobby-help"].textContent = role === "spectator"
          ? "You joined as a spectator. The player seats are already locked."
          : "Both players must be present and ready before setup begins.";

        if (activeMatch.state === "closed") {
          setNotice("Connection lost. Waiting for authoritative match state…", "warning");
        } else if (role === "spectator") {
          setNotice("You are watching this match as a spectator.");
        } else if (!hasControl()) {
          setNotice("This profile is controlled from another tab.", "warning");
        } else if (!myMatchSeat?.ready) {
          setNotice("Press Ready when both players have joined.");
        } else {
          setNotice("Ready locked. Waiting for the other player.");
        }
      }

      function renderSetupPlayers() {
        const status = document.createElement("div");
        status.className = "pocket-siege__setup-players";
        const viewerSeat = ownSeat();
        const seatOrder = viewerSeat > 0 ? [viewerSeat, viewerSeat === 1 ? 2 : 1] : [1, 2];
        seatOrder.forEach((seat) => {
          const player = playerFromPayload(seat);
          const item = document.createElement("div");
          item.className = `pocket-siege__setup-player pocket-siege__setup-player--${seat}`;
          const name = document.createElement("strong");
          name.textContent = player?.nickname || `Player ${seat}`;
          const detail = document.createElement("span");
          if (snapshot?.phase === "loadout") {
            detail.textContent = player?.loadoutSelected ? "Loadout locked" : "Choosing loadout";
          } else if (snapshot?.phase === "vote") {
            detail.textContent = player?.vote ? `Voted: ${MAPS[player.vote]?.name || player.vote}` : "Choosing map";
          } else {
            detail.textContent = player?.battleReady ? "Ready" : "Reviewing battle";
          }
          item.append(name, detail);
          status.append(item);
        });
        refs["setup-status"].replaceChildren(status);
      }

      function renderLoadout() {
        refs["setup-step"].textContent = "Step 1 of 3";
        refs["setup-title"].textContent = "Set your firing order";
        refs["setup-progress"].textContent = "Loadout";
        const content = document.createElement("div");
        content.className = "pocket-siege__loadout";

        const intro = document.createElement("p");
        intro.className = "pocket-siege__intro";
        intro.textContent = "Tap all three projectiles in the order you want to fire them. The sequence repeats for your fourth and fifth shots.";
        content.append(intro);

        const slots = document.createElement("div");
        slots.className = "pocket-siege__loadout-slots";
        const ownPlayer = playerFromPayload(ownSeat());
        const loadoutLocked = ownLoadout.length > 0 || Boolean(ownPlayer?.loadoutSelected) || loadoutPending;
        const selected = ownLoadout.length ? ownLoadout : loadoutDraft;
        for (let i = 0; i < 3; i += 1) {
          const slot = document.createElement("div");
          slot.className = "pocket-siege__loadout-slot";
          const kind = selected[i];
          slot.textContent = kind ? `${i + 1}. ${PROJECTILES[kind].name}` : `${i + 1}. Empty`;
          slots.append(slot);
        }
        content.append(slots);

        const cards = document.createElement("div");
        cards.className = "pocket-siege__choice-grid";
        Object.entries(PROJECTILES).forEach(([kind, info]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "pocket-siege__choice-card";
          button.dataset.action = "choose-projectile";
          button.dataset.kind = kind;
          button.disabled = loadoutLocked || ownSeat() === 0 || !hasControl();
          button.dataset.selected = loadoutDraft.includes(kind) ? "true" : "false";
          const icon = document.createElement("span");
          icon.className = `pocket-siege__choice-icon pocket-siege__choice-icon--${kind}`;
          icon.textContent = info.icon;
          const text = document.createElement("span");
          const title = document.createElement("strong");
          title.textContent = info.name;
          const description = document.createElement("small");
          description.textContent = info.description;
          text.append(title, description);
          button.append(icon, text);
          cards.append(button);
        });
        content.append(cards);

        if (ownSeat() > 0) {
          const actions = document.createElement("div");
          actions.className = "pocket-siege__actions";
          const reset = document.createElement("button");
          reset.type = "button";
          reset.className = "pocket-siege__button";
          reset.dataset.action = "reset-loadout";
          reset.textContent = "Reset order";
          reset.disabled = loadoutLocked || loadoutDraft.length === 0;
          const lock = document.createElement("button");
          lock.type = "button";
          lock.className = "pocket-siege__button pocket-siege__button--primary";
          lock.dataset.action = "lock-loadout";
          lock.textContent = loadoutPending ? "Locking…" : loadoutLocked ? "Loadout locked" : "Lock loadout";
          lock.disabled = loadoutLocked || loadoutDraft.length !== 3 || !hasControl();
          actions.append(reset, lock);
          content.append(actions);
        }

        refs["setup-content"].replaceChildren(content);
      }

      function renderVote() {
        refs["setup-step"].textContent = "Step 2 of 3";
        refs["setup-title"].textContent = "Vote for a battlefield";
        refs["setup-progress"].textContent = "Map vote";
        const content = document.createElement("div");
        const intro = document.createElement("p");
        intro.className = "pocket-siege__intro";
        intro.textContent = "Choose one arena. Matching votes win; a split vote is decided at random.";
        content.append(intro);

        const ownPlayer = playerFromPayload(ownSeat());
        const cards = document.createElement("div");
        cards.className = "pocket-siege__map-grid";
        Object.entries(MAPS).forEach(([mapId, info]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `pocket-siege__map-card pocket-siege__map-card--${mapId}`;
          button.dataset.action = "vote-map";
          button.dataset.map = mapId;
          button.disabled = ownSeat() === 0 || Boolean(ownPlayer?.vote) || !hasControl();
          const visual = document.createElement("span");
          visual.className = "pocket-siege__map-visual";
          const title = document.createElement("strong");
          title.textContent = info.name;
          const description = document.createElement("small");
          description.textContent = info.description;
          button.append(visual, title, description);
          cards.append(button);
        });
        content.append(cards);
        refs["setup-content"].replaceChildren(content);
      }

      function renderFinalReady() {
        refs["setup-step"].textContent = "Step 3 of 3";
        refs["setup-title"].textContent = "Ready for battle?";
        refs["setup-progress"].textContent = "Final check";
        const content = document.createElement("div");
        content.className = "pocket-siege__ready-card";
        const mapId = snapshot?.setup?.mapSelected || "canyon";
        const mapInfo = MAPS[mapId] || MAPS.canyon;
        const visual = document.createElement("div");
        visual.className = `pocket-siege__ready-map pocket-siege__ready-map--${mapId}`;
        const title = document.createElement("h3");
        title.textContent = mapInfo.name;
        const description = document.createElement("p");
        description.textContent = mapInfo.description;
        const rules = document.createElement("p");
        rules.className = "pocket-siege__rules";
        rules.textContent = "Five shots each. Destroy the enemy commander for an instant win, or lead on score after the final turn.";
        visual.append(title, description, rules);
        content.append(visual);

        const ownPlayer = playerFromPayload(ownSeat());
        if (ownSeat() > 0) {
          const ready = document.createElement("button");
          ready.type = "button";
          ready.className = "pocket-siege__button pocket-siege__button--primary pocket-siege__button--large";
          ready.dataset.action = "battle-ready";
          ready.textContent = ownPlayer?.battleReady ? "Battle ready" : "Ready for battle";
          ready.disabled = Boolean(ownPlayer?.battleReady) || !hasControl();
          content.append(ready);
        }
        refs["setup-content"].replaceChildren(content);
      }

      function renderSetup() {
        setView("setup");
        const phase = snapshot?.phase || "loadout";
        if (phase === "loadout") renderLoadout();
        else if (phase === "vote") renderVote();
        else renderFinalReady();
        renderSetupPlayers();

        const setupPlayers = Array.isArray(snapshot?.players) ? snapshot.players : [];
        const buildingBattlefield = phase === "ready"
          && setupPlayers.length === 2
          && setupPlayers.every((player) => player.battleReady === true);

        if (activeMatch?.you?.role === "spectator") {
          setNotice(buildingBattlefield ? "Building battlefield…" : "Watching battle setup as a spectator.");
        } else if (!hasControl()) {
          setNotice("Take control from this tab to make selections.", "warning");
        } else if (buildingBattlefield) {
          setNotice("Building battlefield…");
        } else {
          setNotice("");
        }
      }

      function renderHudPlayer(seat) {
        const target = refs[`player-${seat}`];
        const player = playerFromPayload(seat);
        const profile = playerFromMatch(seat) || player;
        target.replaceChildren();
        target.dataset.active = snapshot?.battle?.activeSeat === seat ? "true" : "false";
        target.append(makeAvatar(profile, seat));
        const detail = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = player?.nickname || `Player ${seat}`;
        const stats = document.createElement("span");
        stats.textContent = `${player?.score || 0} pts · ${player?.shots || 0}/5 shots`;
        detail.append(name, stats);
        target.append(detail);
      }

      function battleMessage() {
        const phase = snapshot?.phase;
        const battle = snapshot?.battle;
        if (!battle) return "Loading battlefield…";
        if (phase === "countdown") return `Battle begins in ${Math.max(1, Math.ceil((battle.timerMs || 0) / 1000))}`;
        if (phase === "aiming") {
          if (ownSeat() === battle.activeSeat && hasControl()) return "Drag backwards from your launcher and release";
          const active = playerFromPayload(battle.activeSeat);
          return `${active?.nickname || `Player ${battle.activeSeat}`} is aiming`;
        }
        if (phase === "flight") {
          if (ownSeat() === battle.activeSeat) return "Projectile in flight";
          return "Incoming!";
        }
        if (phase === "resolve") return "Structures settling…";
        return "";
      }

      function renderBattle() {
        setView("battle");
        renderHudPlayer(1);
        renderHudPlayer(2);
        const battle = snapshot?.battle;
        const phase = snapshot?.phase;
        refs["turn-label"].textContent = `Turn ${battle?.turnNumber || 1}`;
        refs.timer.textContent = phase === "aiming"
          ? String(Math.max(0, Math.ceil((battle?.timerMs || 0) / 1000)))
          : phase === "countdown"
            ? String(Math.max(1, Math.ceil((battle?.timerMs || 0) / 1000)))
            : "—";
        refs["battle-message"].textContent = battleMessage();

        const kind = battle?.currentKind || "boulder";
        const info = PROJECTILES[kind] || PROJECTILES.boulder;
        refs["projectile-icon"].textContent = info.icon;
        refs["projectile-icon"].className = `pocket-siege__projectile-icon pocket-siege__projectile-icon--${kind}`;
        refs["projectile-name"].textContent = info.name;
        refs["projectile-help"].textContent = info.description;

        const isMine = ownSeat() > 0 && ownSeat() === battle?.activeSeat;
        const canAim = phase === "aiming" && isMine && hasControl();
        const ability = root.querySelector('[data-action="activate"]');
        const canActivate = phase === "flight"
          && isMine
          && hasControl()
          && !battle?.abilityUsed
          && kind !== "boulder";
        const canAct = canAim || canActivate;
        refs["context-panel"].dataset.active = canAct ? "true" : "false";
        refs["turn-state"].textContent = activeMatch?.you?.role === "spectator"
          ? "Spectating"
          : isMine ? (canAct ? "Your turn" : "Your shot") : "Opponent turn";
        refs["control-help"].textContent = canAim
          ? "Pull away from the launcher to set angle and power, then release."
          : canActivate
            ? "Use the special ability before the projectile lands."
            : phase === "flight"
              ? "Watch the projectile and wait for the structures to settle."
              : phase === "countdown"
                ? "The battlefield is loading. Get ready to aim."
                : "The next turn begins when the structures have settled.";
        ability.disabled = !canActivate;
        ability.setAttribute("aria-disabled", canActivate ? "false" : "true");
        ability.textContent = battle?.abilityUsed
          ? "Ability used"
          : kind === "boulder"
            ? "No ability"
            : canActivate ? "Activate ability" : "Ability waiting";
        setNotice(activeMatch?.you?.role === "spectator" ? "Spectator view" : "");
      }

      function renderResult() {
        setView("result");
        arcade.display.exitFullscreen();
        const payload = result?.payload || {};
        const placements = Array.isArray(payload.placements) ? payload.placements : [];
        const mine = placements.find((placement) => placement.profileId === arcade.profile?.profileId)
          || placements.find((placement) => Number(placement.seat) === ownSeat());
        refs["result-title"].textContent = placements.length === 0
          ? "Battle complete"
          : payload.draw
            ? "Draw battle"
            : mine?.place === 1 ? "Victory!" : "Fortress defeated";
        refs["result-summary"].textContent = snapshot?.battle?.reason || (payload.draw ? "Both fortresses finished level." : "The siege is over.");
        refs["result-placements"].replaceChildren();
        placements
          .slice()
          .sort((a, b) => Number(a.place) - Number(b.place))
          .forEach((placement) => {
            const card = document.createElement("div");
            card.className = "pocket-siege__placement";
            const place = document.createElement("span");
            place.className = "pocket-siege__placement-rank";
            place.textContent = payload.draw ? "=" : `#${placement.place}`;
            const detail = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = placement.nickname;
            const wins = document.createElement("span");
            wins.textContent = `${placement.wins} total wins`;
            detail.append(name, wins);
            card.append(place, detail);
            refs["result-placements"].append(card);
          });
        setNotice("");
      }

      function render() {
        if (destroyed) return;
        renderConnection();
        if (result || snapshot?.phase === "finished") {
          renderResult();
          return;
        }
        if (!activeMatch || activeMatch.you?.role === "none") {
          renderSplash();
          return;
        }
        if (activeMatch.state !== "playing" || !snapshot) {
          renderLobby();
          return;
        }
        if (["loadout", "vote", "ready"].includes(snapshot.phase)) {
          renderSetup();
          return;
        }
        if (["countdown", "aiming", "flight", "resolve"].includes(snapshot.phase)) {
          renderBattle();
          return;
        }
        if (snapshot.phase === "finished") {
          renderBattle();
          return;
        }
        renderLobby();
      }

      function clearMatchState() {
        activeMatch = null;
        latestSnapshotRevision = -1;
        snapshot = null;
        previousSnapshot = null;
        result = null;
        ownLoadout = [];
        loadoutDraft = [];
        loadoutPending = false;
        aim = null;
        lastPhase = "";
        effects = [];
        arcade.display.exitFullscreen();
        render();
      }

      function acceptMatch(match) {
        if (match.you?.role === "none") {
          if (!activeMatch || match.matchId === activeMatch.matchId) clearMatchState();
          return;
        }
        if (!activeMatch || activeMatch.matchId !== match.matchId) {
          latestSnapshotRevision = -1;
          snapshot = null;
          previousSnapshot = null;
          result = null;
          ownLoadout = [];
          loadoutDraft = [];
          loadoutPending = false;
          aim = null;
          effects = [];
        }
        activeMatch = match;
        if (match.state === "closed") {
          snapshot = null;
          aim = null;
          setNotice("Connection lost. Waiting to reconnect…", "warning");
        }
        render();
      }

      function maybeFullscreen(nextPhase) {
        const battlePhases = ["countdown", "aiming", "flight", "resolve"];
        if (battlePhases.includes(nextPhase) && !battlePhases.includes(lastPhase)) {
          arcade.display.requestFullscreen();
        } else if (!battlePhases.includes(nextPhase) && battlePhases.includes(lastPhase)) {
          arcade.display.exitFullscreen();
        }
        lastPhase = nextPhase;
      }

      function applySnapshot(envelope) {
        if (!activeMatch || envelope.matchId !== activeMatch.matchId) return;
        const revision = Number(envelope.revision);
        if (!Number.isFinite(revision) || revision < latestSnapshotRevision) return;
        latestSnapshotRevision = revision;
        previousSnapshot = snapshot;
        const next = envelope.payload || {};
        if (Array.isArray(next.you?.loadout)) {
          ownLoadout = next.you.loadout.slice(0, 3);
          loadoutDraft = ownLoadout.slice();
          loadoutPending = false;
        }
        if (!next.you && ownLoadout.length) {
          next.you = { loadout: ownLoadout.slice() };
        }
        snapshot = next;
        maybeFullscreen(snapshot.phase);
        if (snapshot.phase !== "aiming") aim = null;
        render();
      }

      function addEffect(type, payload = {}) {
        const now = performance.now();
        const count = type === "explosion" ? 22 : type === "impact" ? 8 : 12;
        for (let i = 0; i < count; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = (type === "explosion" ? 70 : 38) + Math.random() * 90;
          effects.push({
            type,
            x: Number(payload.x) || WORLD_W / 2,
            y: Number(payload.y) || WORLD_H / 2,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - (type === "explosion" ? 45 : 10),
            born: now,
            life: 350 + Math.random() * 450,
            size: 2 + Math.random() * (type === "explosion" ? 8 : 4),
          });
        }
        if (effects.length > 90) effects = effects.slice(-90);
      }

      function handleEvent(event) {
        if (!activeMatch || event.matchId !== activeMatch.matchId) return;
        const payload = event.payload || {};
        if (event.name === "impact") addEffect("impact", payload);
        if (event.name === "explosion") addEffect("explosion", payload);
        if (event.name === "body_destroyed") addEffect("debris", payload);
      }

      function send(action, data = {}) {
        if (!activeMatch || activeMatch.you?.role !== "player" || !hasControl()) return false;
        return arcade.game.send(activeMatch.matchId, action, data);
      }

      function handleAction(button) {
        const action = button.dataset.action;
        if (action === "join") {
          arcade.game.join(APP_ID);
        } else if (action === "platform-ready") {
          if (activeMatch) arcade.game.ready(activeMatch.matchId);
        } else if (action === "claim-control") {
          if (activeMatch) arcade.game.claimControl(activeMatch.matchId);
        } else if (action === "leave") {
          if (activeMatch) arcade.game.leave(activeMatch.matchId);
        } else if (action === "choose-projectile") {
          const kind = button.dataset.kind;
          if (!PROJECTILES[kind] || ownLoadout.length) return;
          const existing = loadoutDraft.indexOf(kind);
          if (existing >= 0) loadoutDraft.splice(existing, 1);
          else if (loadoutDraft.length < 3) loadoutDraft.push(kind);
          render();
        } else if (action === "reset-loadout") {
          loadoutDraft = [];
          render();
        } else if (action === "lock-loadout") {
          if (loadoutDraft.length === 3 && send("set_loadout", { loadout: loadoutDraft.slice() })) {
            loadoutPending = true;
            render();
          }
        } else if (action === "vote-map") {
          send("vote_map", { map: button.dataset.map });
        } else if (action === "battle-ready") {
          send("battle_ready", {});
        } else if (action === "activate") {
          send("activate", {});
        } else if (action === "play-again") {
          result = null;
          snapshot = null;
          latestSnapshotRevision = -1;
          ownLoadout = [];
          loadoutDraft = [];
          loadoutPending = false;
          arcade.game.join(APP_ID);
          render();
        } else if (action === "exit-fullscreen") {
          arcade.display.exitFullscreen();
        }
      }

      function worldPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((event.clientX - rect.left) / rect.width) * WORLD_W,
          y: ((event.clientY - rect.top) / rect.height) * WORLD_H,
        };
      }

      function launcherForSeat(seat) {
        return { x: seat === 1 ? 130 : 870, y: 425 };
      }

      function validAimState() {
        return snapshot?.phase === "aiming"
          && snapshot?.battle?.activeSeat === ownSeat()
          && ownSeat() > 0
          && hasControl();
      }

      function updateAim(point) {
        const seat = ownSeat();
        const sling = launcherForSeat(seat);
        const constrained = { ...point };
        if (seat === 1) constrained.x = Math.min(constrained.x, sling.x - 14);
        else constrained.x = Math.max(constrained.x, sling.x + 14);
        constrained.y = Math.max(constrained.y, sling.y + 12);

        let pullX = sling.x - constrained.x;
        let pullY = sling.y - constrained.y;
        let length = Math.hypot(pullX, pullY);
        if (length > MAX_PULL) {
          pullX = (pullX / length) * MAX_PULL;
          pullY = (pullY / length) * MAX_PULL;
          length = MAX_PULL;
          constrained.x = sling.x - pullX;
          constrained.y = sling.y - pullY;
        }
        const power = Math.max(0.2, Math.min(1, length / MAX_PULL));
        const angle = Math.max(10, Math.min(80, Math.atan2(-pullY, Math.abs(pullX)) * 180 / Math.PI));
        aim = { seat, sling, point: constrained, power, angle };
      }

      function pointerDown(event) {
        if (!validAimState()) return;
        const point = worldPoint(event);
        const sling = launcherForSeat(ownSeat());
        if (Math.hypot(point.x - sling.x, point.y - sling.y) > 100) return;
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        updateAim(point);
      }

      function pointerMove(event) {
        if (!aim) return;
        event.preventDefault();
        updateAim(worldPoint(event));
      }

      function pointerUp(event) {
        if (!aim) return;
        event.preventDefault();
        const launch = aim;
        aim = null;
        send("launch", {
          angle: Math.round(launch.angle * 10) / 10,
          power: Math.round(launch.power * 1000) / 1000,
        });
      }

      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const scale = Math.min(width / WORLD_W, height / WORLD_H);
        canvasScale = scale;
        canvasOffsetX = (width - WORLD_W * scale) * 0.5;
        canvasOffsetY = (height - WORLD_H * scale) * 0.5;
      }

      function roundRect(context, x, y, width, height, radius) {
        const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.arcTo(x + width, y, x + width, y + height, r);
        context.arcTo(x + width, y + height, x, y + height, r);
        context.arcTo(x, y + height, x, y, r);
        context.arcTo(x, y, x + width, y, r);
        context.closePath();
      }

      function drawBackground(context, mapId, groundY) {
        const gradient = context.createLinearGradient(0, 0, 0, WORLD_H);
        if (mapId === "moonbase") {
          gradient.addColorStop(0, "#10172f");
          gradient.addColorStop(1, "#49506d");
        } else if (mapId === "harbour") {
          gradient.addColorStop(0, "#476c82");
          gradient.addColorStop(1, "#c1d0cb");
        } else {
          gradient.addColorStop(0, "#4f92c8");
          gradient.addColorStop(1, "#f2c178");
        }
        context.fillStyle = gradient;
        context.fillRect(0, 0, WORLD_W, WORLD_H);

        if (mapId === "moonbase") {
          context.fillStyle = "rgba(255,255,255,0.75)";
          for (let i = 0; i < 32; i += 1) {
            const x = (i * 83) % WORLD_W;
            const y = (i * 47) % 250 + 25;
            context.fillRect(x, y, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
          }
          context.fillStyle = "rgba(215,224,243,0.22)";
          context.beginPath();
          context.arc(800, 112, 72, 0, Math.PI * 2);
          context.fill();
        } else if (mapId === "harbour") {
          context.fillStyle = "rgba(24,55,72,0.28)";
          context.beginPath();
          context.moveTo(0, 410);
          for (let x = 0; x <= WORLD_W; x += 90) {
            context.lineTo(x, 390 + Math.sin(x * 0.02) * 18);
          }
          context.lineTo(WORLD_W, groundY);
          context.lineTo(0, groundY);
          context.closePath();
          context.fill();
        } else {
          context.fillStyle = "rgba(113,63,45,0.28)";
          context.beginPath();
          context.moveTo(0, groundY);
          context.lineTo(0, 360);
          context.lineTo(90, 325);
          context.lineTo(180, 370);
          context.lineTo(310, 310);
          context.lineTo(430, 372);
          context.lineTo(590, 302);
          context.lineTo(730, 356);
          context.lineTo(850, 310);
          context.lineTo(1000, 365);
          context.lineTo(1000, groundY);
          context.closePath();
          context.fill();
        }

        context.fillStyle = mapId === "moonbase" ? "#777d92" : mapId === "harbour" ? "#455d58" : "#76533a";
        context.fillRect(0, groundY, WORLD_W, WORLD_H - groundY);
        context.fillStyle = mapId === "moonbase" ? "#aeb4c6" : mapId === "harbour" ? "#789080" : "#b88a55";
        context.fillRect(0, groundY, WORLD_W, 12);
      }

      function drawLauncher(context, seat, active) {
        const sling = launcherForSeat(seat);
        context.save();
        context.strokeStyle = active ? "#f7df74" : "rgba(40,30,20,0.8)";
        context.lineWidth = active ? 8 : 6;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(sling.x - 16, sling.y + 60);
        context.lineTo(sling.x - 12, sling.y - 20);
        context.moveTo(sling.x + 16, sling.y + 60);
        context.lineTo(sling.x + 12, sling.y - 20);
        context.stroke();
        context.fillStyle = "#5a3a27";
        context.fillRect(sling.x - 28, sling.y + 54, 56, 12);
        context.restore();
      }

      function drawTarget(context, body) {
        const x = body.x - body.w / 2;
        const y = body.y - body.h / 2;
        const ratio = Math.max(0, body.hp / body.mx);
        context.save();
        context.globalAlpha = body.a ? 1 : 0.16;
        context.fillStyle = body.o === 1 ? "#2f8f83" : "#a84f6f";
        roundRect(context, x, y, body.w, body.h, 8);
        context.fill();
        context.fillStyle = "rgba(255,255,255,0.88)";
        context.fillRect(body.x - body.w * 0.23, body.y - 5, 5, 5);
        context.fillRect(body.x + body.w * 0.12, body.y - 5, 5, 5);
        context.strokeStyle = "rgba(10,20,28,0.75)";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(body.x - body.w * 0.18, body.y + 8);
        context.lineTo(body.x + body.w * 0.18, body.y + 8);
        context.stroke();
        if (body.k === "commander") {
          context.strokeStyle = "rgba(255,255,255,0.8)";
          context.lineWidth = 2;
          context.strokeRect(x + 4, y + 4, body.w - 8, body.h - 8);
        }
        context.fillStyle = "rgba(0,0,0,0.35)";
        context.fillRect(x, y - 7, body.w, 4);
        context.fillStyle = ratio > 0.5 ? "#8de398" : ratio > 0.22 ? "#f5cf63" : "#ee6a68";
        context.fillRect(x, y - 7, body.w * ratio, 4);
        context.restore();
      }

      function drawBody(context, body) {
        if (!body.a) return;
        if (body.k === "commander" || body.k === "support") {
          drawTarget(context, body);
          return;
        }
        const x = body.x - body.w / 2;
        const y = body.y - body.h / 2;
        context.save();
        if (body.m === "wood") {
          context.fillStyle = "#9d643c";
          context.strokeStyle = "#5e3b28";
        } else if (body.m === "stone") {
          context.fillStyle = "#858993";
          context.strokeStyle = "#525762";
        } else if (body.m === "glass") {
          context.fillStyle = "rgba(125,221,238,0.62)";
          context.strokeStyle = "rgba(224,250,255,0.9)";
        } else {
          context.fillStyle = "#b34d3d";
          context.strokeStyle = "#6c2d29";
        }
        context.lineWidth = 2;
        roundRect(context, x, y, body.w, body.h, body.m === "barrel" ? 6 : 2);
        context.fill();
        context.stroke();

        if (body.m === "wood") {
          context.strokeStyle = "rgba(255,220,170,0.28)";
          context.beginPath();
          context.moveTo(x + 5, body.y);
          context.lineTo(x + body.w - 5, body.y);
          context.stroke();
        } else if (body.m === "stone") {
          context.strokeStyle = "rgba(255,255,255,0.2)";
          context.beginPath();
          context.moveTo(x + body.w * 0.5, y + 2);
          context.lineTo(x + body.w * 0.5, y + body.h - 2);
          context.stroke();
        } else if (body.m === "glass") {
          context.strokeStyle = "rgba(255,255,255,0.7)";
          context.beginPath();
          context.moveTo(x + 4, y + body.h - 5);
          context.lineTo(x + body.w - 4, y + 5);
          context.stroke();
        } else if (body.m === "barrel") {
          context.fillStyle = "#f0c85a";
          context.fillRect(body.x - 3, y + 7, 6, body.h - 14);
        }
        context.restore();
      }

      function drawProjectile(context, projectile) {
        if (!projectile.a) return;
        context.save();
        if (projectile.k === "splitter") context.fillStyle = "#57d8e4";
        else if (projectile.k === "bomber" || projectile.k === "bomb") context.fillStyle = "#ed8d3b";
        else context.fillStyle = "#464b55";
        context.strokeStyle = "rgba(255,255,255,0.8)";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(projectile.x, projectile.y, projectile.r, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = "rgba(255,255,255,0.55)";
        context.beginPath();
        context.arc(projectile.x - projectile.r * 0.3, projectile.y - projectile.r * 0.3, Math.max(2, projectile.r * 0.22), 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      function drawAim(context, battle) {
        if (!aim || !validAimState()) return;
        const { sling, point, seat, power, angle } = aim;
        context.save();
        context.strokeStyle = "rgba(55,30,20,0.9)";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(sling.x - 12, sling.y - 14);
        context.lineTo(point.x, point.y);
        context.lineTo(sling.x + 12, sling.y - 14);
        context.stroke();
        context.fillStyle = "rgba(255,255,255,0.9)";
        context.beginPath();
        context.arc(point.x, point.y, 13, 0, Math.PI * 2);
        context.fill();

        const direction = seat === 1 ? 1 : -1;
        const speed = 540 + 430 * power;
        const radians = angle * Math.PI / 180;
        const vx = Math.cos(radians) * speed * direction;
        const vy = -Math.sin(radians) * speed;
        context.fillStyle = "rgba(255,255,255,0.62)";
        for (let i = 1; i <= 14; i += 1) {
          const t = i * 0.12;
          const x = sling.x + vx * t;
          const y = sling.y + vy * t + 0.5 * (battle?.gravity || 820) * t * t;
          if (x < 0 || x > WORLD_W || y > (battle?.groundY || 500)) break;
          context.globalAlpha = 1 - i / 18;
          context.beginPath();
          context.arc(x, y, Math.max(2, 5 - i * 0.18), 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      function drawEffects(context, now) {
        effects = effects.filter((effect) => now - effect.born < effect.life);
        effects.forEach((effect) => {
          const age = (now - effect.born) / 1000;
          const progress = (now - effect.born) / effect.life;
          const x = effect.x + effect.vx * age;
          const y = effect.y + effect.vy * age + 180 * age * age;
          context.save();
          context.globalAlpha = Math.max(0, 1 - progress);
          context.fillStyle = effect.type === "explosion" ? "#ffb447" : effect.type === "impact" ? "#f4e3bc" : "#9e7b63";
          context.beginPath();
          context.arc(x, y, effect.size * (1 - progress * 0.35), 0, Math.PI * 2);
          context.fill();
          context.restore();
        });
      }

      function drawBattlefield(now) {
        resizeCanvas();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvasOffsetX, canvasOffsetY);
        ctx.scale(canvasScale, canvasScale);

        const battle = snapshot?.battle;
        drawBackground(ctx, battle?.map || "canyon", battle?.groundY || 500);
        drawLauncher(ctx, 1, snapshot?.phase === "aiming" && battle?.activeSeat === 1);
        drawLauncher(ctx, 2, snapshot?.phase === "aiming" && battle?.activeSeat === 2);

        const bodies = Array.isArray(battle?.bodies) ? battle.bodies : [];
        bodies.forEach((body) => drawBody(ctx, body));
        const projectiles = Array.isArray(battle?.projectiles) ? battle.projectiles : [];
        projectiles.forEach((projectile) => drawProjectile(ctx, projectile));
        drawAim(ctx, battle);
        drawEffects(ctx, now);
        ctx.restore();
      }

      function animationLoop(now) {
        if (destroyed) return;
        drawBattlefield(now);
        rafId = requestAnimationFrame(animationLoop);
      }

      function handleRootClick(event) {
        const button = event.target.closest("button[data-action]");
        if (!button || button.disabled || !root.contains(button)) return;
        handleAction(button);
      }

      function cancelAim() {
        aim = null;
      }

      root.addEventListener("click", handleRootClick);
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointermove", pointerMove);
      canvas.addEventListener("pointerup", pointerUp);
      canvas.addEventListener("pointercancel", cancelAim);
      document.addEventListener("visibilitychange", cancelAim);

      const resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(refs["canvas-wrap"]);

      const stopConnection = arcade.onConnection(() => {
        renderConnection();
        if (arcade.connectionStatus !== "connected") cancelAim();
        if (!activeMatch || activeMatch.you?.role === "none") renderSplash();
      });
      const stopFullscreen = arcade.display.onFullscreenChange((fullscreen) => {
        root.classList.toggle("pocket-siege--fullscreen", fullscreen);
        resizeCanvas();
      });
      const stopMatch = arcade.game.onMatch((match) => acceptMatch(match));
      const stopSnapshot = arcade.game.onSnapshot((envelope) => applySnapshot(envelope));
      const stopEvent = arcade.game.onEvent((event) => handleEvent(event));
      const stopResult = arcade.game.onResult((envelope) => {
        if (!activeMatch || envelope.matchId !== activeMatch.matchId) return;
        result = envelope;
        render();
      });
      const stopError = arcade.game.onError((error) => {
        if (error.matchId && (!activeMatch || error.matchId !== activeMatch.matchId)) return;
        if (error.code === "match_not_found") {
          clearMatchState();
          setNotice("That match is no longer available. Join a new match.", "warning");
          return;
        }
        if (error.code === "runtime_failed") {
          cancelAim();
          setNotice("The game runtime stopped. Leave and start a fresh match.", "error");
          return;
        }
        if (error.code === "rate_limited" || error.code === "queue_full") {
          cancelAim();
        }
        loadoutPending = false;
        setNotice(error.message || "The game command was rejected.", "error");
      });

      container.replaceChildren(root);
      const cachedMatch = arcade.game.currentMatch();
      if (cachedMatch && cachedMatch.you?.role !== "none") {
        acceptMatch(cachedMatch);
        const cachedSnapshot = arcade.game.currentSnapshot();
        if (cachedSnapshot && cachedSnapshot.matchId === cachedMatch.matchId) {
          applySnapshot(cachedSnapshot);
        } else if (cachedMatch.state !== "finished") {
          arcade.game.requestSnapshot(cachedMatch.matchId);
        }
      } else {
        render();
      }
      rafId = requestAnimationFrame(animationLoop);

      return () => {
        destroyed = true;
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        root.removeEventListener("click", handleRootClick);
        canvas.removeEventListener("pointerdown", pointerDown);
        canvas.removeEventListener("pointermove", pointerMove);
        canvas.removeEventListener("pointerup", pointerUp);
        canvas.removeEventListener("pointercancel", cancelAim);
        document.removeEventListener("visibilitychange", cancelAim);
        stopConnection();
        stopFullscreen();
        stopMatch();
        stopSnapshot();
        stopEvent();
        stopResult();
        stopError();
        arcade.display.exitFullscreen();
        activeMatch = null;
        snapshot = null;
        previousSnapshot = null;
        result = null;
        effects = [];
        container.replaceChildren();
      };
    },
  };
})();

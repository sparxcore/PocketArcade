"use strict";

(() => {
  const APP_ID = "pocket-inferno";
  const VERSION = "0.1.13";
  const scriptUrl = document.currentScript && document.currentScript.src;
  const assetBase = new URL(".", scriptUrl || window.location.href);
  const logoUrl = new URL("../assets/pocket-arcade-horizontal.png", assetBase).href;
  const splashUrl = new URL("../assets/splash.jpg", assetBase).href;
  const wallAtlasUrl = new URL("../assets/wall-atlas.png", assetBase).href;
  const floorAtlasUrl = new URL("../assets/floor-atlas.png", assetBase).href;
  const ceilingAtlasUrl = new URL("../assets/ceiling-atlas.png", assetBase).href;
  const weaponsSpriteUrl = new URL("../assets/inferno_weapons.png", assetBase).href;
  const woodBarrelUrl = new URL("../assets/inferno_wood_barrel.png", assetBase).href;
  const torchSpriteUrl = new URL("../assets/inferno_torch.png", assetBase).href;
  const flameBarrelUrl = new URL("../assets/inferno_flame_barrel.png", assetBase).href;
  const flameBarrelExplosionUrl = new URL("../assets/flame_barrel_exp.png", assetBase).href;
  const playerSpriteUrl = new URL("../assets/inferno_player_sprites.png", assetBase).href;
  const TEXTURE_TILE_SIZE = 64;
  const TEXTURE_COLUMNS = 5;
  const TEXTURE_COUNT = 10;
  const PLAYER_SPRITE_FRAME_WIDTH = 384;
  const PLAYER_SPRITE_FRAME_HEIGHT = 512;
  const WEAPON_SPRITES = {
    1: { name: "Blaster", x: 252, y: 54, w: 264, h: 404 },
    2: { name: "Shotgun", x: 243, y: 556, w: 280, h: 398 },
    3: { name: "NailGun", x: 944, y: 54, w: 382, h: 404 },
    4: { name: "BFG", x: 889, y: 542, w: 525, h: 407 },
  };
  const TORCH_SPRITES = {
    front: { x: 152, y: 276, w: 223, h: 421 },
    left: { x: 580, y: 275, w: 268, h: 422 },
    right: { x: 1207, y: 276, w: 262, h: 419 },
  };
  const PLAYER_SPRITES = {
    toward: { x: 168, y: 124, w: 216, h: 321, ax: 80, ay: 320 },
    forwardRight: { x: 480, y: 124, w: 234, h: 321, ax: 138, ay: 320 },
    left: { x: 768, y: 125, w: 236, h: 320, ax: 111, ay: 319 },
    awayRight: { x: 1152, y: 124, w: 245, h: 320, ax: 114, ay: 319 },
    away: { x: 172, y: 553, w: 212, h: 310, ax: 80, ay: 309 },
    awayLeft: { x: 458, y: 550, w: 268, h: 320, ax: 140, ay: 319 },
    forwardLeft: { x: 768, y: 553, w: 240, h: 310, ax: 120, ay: 309 },
    right: { x: 1152, y: 552, w: 244, h: 310, ax: 84, ay: 309 },
  };
  const PLAYER_DIRECTION_ORDER = ["toward", "forwardRight", "right", "awayRight", "away", "awayLeft", "left", "forwardLeft"];
  const WOOD_BARREL_SPRITE = { x: 495, y: 156, w: 549, h: 738 };
  const FLAME_BARREL_SPRITE = { x: 503, y: 111, w: 524, h: 753 };
  const EXPLOSION_FRAME_WIDTH = 384;
  const EXPLOSION_FRAME_HEIGHT = 512;
  const EXPLOSION_FRAME_COUNT = 8;
  const EXPLOSION_FRAME_MS = 85;
  const EXPLOSION_DURATION_MS = EXPLOSION_FRAME_COUNT * EXPLOSION_FRAME_MS + 120;
  const WEAPON_DISPLAY_SCALE = 0.21;
  const SPRITE_WALL_EPSILON = 0.08;
  const DECOR_TORCHES = [
    { id: "n1", x: 4.5, y: 1.08, nx: 0, ny: 1 },
    { id: "n2", x: 11.5, y: 1.08, nx: 0, ny: 1 },
    { id: "s1", x: 5.5, y: 14.92, nx: 0, ny: -1 },
    { id: "s2", x: 10.5, y: 14.92, nx: 0, ny: -1 },
    { id: "w1", x: 1.08, y: 5.5, nx: 1, ny: 0 },
    { id: "w2", x: 1.08, y: 10.5, nx: 1, ny: 0 },
    { id: "e1", x: 14.92, y: 5.5, nx: -1, ny: 0 },
    { id: "e2", x: 14.92, y: 10.5, nx: -1, ny: 0 },
  ];
  let assetBundlePromise = null;

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error(`Unable to load ${url}`)), { once: true });
      image.src = url;
    });
  }

  function readPixels(image) {
    const buffer = document.createElement("canvas");
    buffer.width = image.naturalWidth;
    buffer.height = image.naturalHeight;
    const context = buffer.getContext("2d", { alpha: false, willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0);
    return {
      data: context.getImageData(0, 0, buffer.width, buffer.height).data,
      width: buffer.width,
      height: buffer.height,
    };
  }

  function hexToRgb(hex) {
    const normalized = String(hex || "#000").trim().replace(/^#/, "");
    const expanded = normalized.length === 3
      ? normalized.split("").map((part) => part + part).join("")
      : normalized;
    const value = parseInt(expanded, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  function mixChannel(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function tintMonochromeSpriteSheet(image, palette) {
    const dark = hexToRgb(palette.dark);
    const base = hexToRgb(palette.base);
    const soft = hexToRgb(palette.soft);
    const outline = {
      r: Math.round(dark.r * 0.36),
      g: Math.round(dark.g * 0.36),
      b: Math.round(dark.b * 0.36),
    };
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (!alpha) continue;
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / (255 * 3);
      let from;
      let to;
      let t;
      if (luminance < 0.18) {
        from = outline;
        to = dark;
        t = luminance / 0.18;
      } else if (luminance < 0.62) {
        from = dark;
        to = base;
        t = (luminance - 0.18) / 0.44;
      } else {
        from = base;
        to = soft;
        t = (luminance - 0.62) / 0.38;
      }
      data[index] = mixChannel(from.r, to.r, t);
      data[index + 1] = mixChannel(from.g, to.g, t);
      data[index + 2] = mixChannel(from.b, to.b, t);
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function loadAssetBundle() {
    if (!assetBundlePromise) {
      assetBundlePromise = Promise.all([
        loadImage(splashUrl),
        loadImage(wallAtlasUrl),
        loadImage(floorAtlasUrl),
        loadImage(ceilingAtlasUrl),
        loadImage(weaponsSpriteUrl),
        loadImage(woodBarrelUrl),
        loadImage(torchSpriteUrl),
        loadImage(flameBarrelUrl),
        loadImage(flameBarrelExplosionUrl),
        loadImage(playerSpriteUrl),
      ]).then(([splash, wall, floor, ceiling, weapons, woodBarrel, torch, flameBarrel, flameBarrelExplosion, playerSprites]) => ({
        splash,
        wall: { image: wall },
        floor: { image: floor, pixels: readPixels(floor) },
        ceiling: { image: ceiling, pixels: readPixels(ceiling) },
        weapons: { image: weapons },
        woodBarrel: { image: woodBarrel },
        torch: { image: torch },
        flameBarrel: { image: flameBarrel },
        flameBarrelExplosion: { image: flameBarrelExplosion },
        playerSprites: {
          image: playerSprites,
          tinted: SEAT_COLOURS.map((base, index) => tintMonochromeSpriteSheet(playerSprites, {
            base,
            dark: SEAT_DARK[index] || SEAT_DARK[0],
            soft: SEAT_SOFT[index] || SEAT_SOFT[0],
          })),
        },
      }));
    }
    return assetBundlePromise;
  }

  function textureIndexForCell(cellX, cellY, salt) {
    const hash = Math.imul(cellX | 0, 73856093)
      ^ Math.imul(cellY | 0, 19349663)
      ^ salt;
    return (hash >>> 0) % TEXTURE_COUNT;
  }

  const MAP = [
    "1111111111111111",
    "1000001000000001",
    "1011101001110101",
    "1000100001000101",
    "1100110101011101",
    "1000000101000001",
    "1011110000011101",
    "1000010111000001",
    "1010010001010101",
    "1000001100010001",
    "1110100001110101",
    "1000101100000101",
    "1011100010111101",
    "1000001000000001",
    "1000000000000001",
    "1111111111111111",
  ];

  const PICKUP_POSITIONS = {
    1: { kind: "health", x: 7.5, y: 7.5 },
    2: { kind: "health", x: 8.5, y: 8.5 },
    3: { kind: "shells", x: 4.5, y: 4.5 },
    4: { kind: "shells", x: 11.5, y: 11.5 },
    5: { kind: "shells", x: 3.5, y: 12.5 },
    6: { kind: "shells", x: 12.5, y: 3.5 },
  };

  const SEAT_COLOURS = ["#ef5d67", "#21b88c", "#f5b83d", "#8067ed", "#3699e8", "#f47b35", "#df4f9a", "#86c83f"];
  const SEAT_DARK = ["#b62f49", "#08775f", "#b66d08", "#5136b6", "#1764a5", "#b84712", "#9e2869", "#4e8419"];
  const SEAT_SOFT = ["#ffd3d0", "#c8f6df", "#fff0ae", "#ded6ff", "#cceaff", "#ffd8bd", "#ffd0e6", "#e2f5bd"];
  const FOV = Math.PI / 3.15;
  const PLAYER_RADIUS = 0.22;
  const MOVE_SPEED = 2.35;
  const INPUT_INTERVAL_MS = 150;
  const INPUT_HEARTBEAT_MS = 600;
  let mountedCleanup = null;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function normaliseAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function initials(name) {
    const parts = String(name || "Player").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P";
  }

  function isWall(x, y) {
    const row = Math.floor(y);
    const column = Math.floor(x);
    if (row < 0 || row >= MAP.length || column < 0 || column >= MAP[0].length) return true;
    return MAP[row][column] !== "0";
  }

  function positionClear(x, y) {
    const r = PLAYER_RADIUS;
    return !isWall(x - r, y - r)
      && !isWall(x + r, y - r)
      && !isWall(x - r, y + r)
      && !isWall(x + r, y + r);
  }

  function profileForSeat(match, seat) {
    const entry = match && Array.isArray(match.seats)
      ? match.seats.find((candidate) => candidate.seat === seat)
      : null;
    return entry && entry.player ? entry.player : null;
  }

  function nameForSeat(match, seat) {
    return profileForSeat(match, seat)?.nickname || `Player ${seat}`;
  }

  window.PocketArcadeApps = window.PocketArcadeApps || {};
  window.PocketArcadeApps[APP_ID] = {
    mount(container, arcade) {
      if (mountedCleanup) mountedCleanup();

      let activeMatch = null;
      let snapshot = null;
      let result = null;
      let latestSnapshotRevision = -1;
      let animationFrame = 0;
      let lastFrameAt = performance.now();
      let inputTimer = 0;
      let lastInputSignature = "";
      let lastInputSentAt = 0;
      let requestedSnapshotMatchId = null;
      let toastTimer = 0;
      let destroyed = false;
      let canvasWidth = 0;
      let canvasHeight = 0;
      let renderScale = 1;
      let textureAssets = null;
      const surfaceCanvas = document.createElement("canvas");
      const surfaceCtx = surfaceCanvas.getContext("2d", { alpha: false });
      let surfaceImageData = null;
      let predicted = null;
      let remotePlayers = new Map();
      let effects = {
        damageUntil: 0,
        muzzleUntil: 0,
        shakeUntil: 0,
        shotBySeat: new Map(),
        explodingBarrels: new Map(),
        barrelActiveById: new Map(),
      };

      const keys = new Set();
      const touchState = { forward: 0, strafe: 0 };
      const control = { forward: 0, strafe: 0, angle: 0, fire: false, weapon: 1 };
      const activePointers = new Map();

      const root = document.createElement("section");
      root.className = "pocket-inferno";
      root.innerHTML = `
        <header class="pocket-inferno__topbar">
          <div class="pocket-inferno__brand">
            <span class="pocket-inferno__brand-mark" aria-hidden="true"></span>
            <span>
              <strong>Pocket Inferno</strong>
              <small>Multiplayer arena</small>
            </span>
          </div>
          <div class="pocket-inferno__top-actions">
            <span class="pocket-inferno__connection" data-role="connection">Connecting</span>
            <button class="pocket-inferno__icon-button" type="button" data-action="fullscreen" aria-label="Toggle fullscreen">⛶</button>
          </div>
        </header>

        <main class="pocket-inferno__body">
          <section class="pocket-inferno__screen pocket-inferno__splash is-visible" data-screen="splash">
            <div class="pocket-inferno__splash-art">
              <img class="pocket-inferno__splash-image" alt="Pocket Inferno pixel-art arena fighter" data-role="splash-image">
            </div>
            <div class="pocket-inferno__splash-copy">
              <img class="pocket-inferno__pa-logo" alt="PocketArcade" data-role="logo">
              <h1 class="pocket-inferno__sr-only">Pocket Inferno</h1>
              <p class="pocket-inferno__kicker">2–4 PLAYER DEATHMATCH</p>
              <p>Enter the arena, dodge the blast barrels, and reach seven frags first.</p>
              <div class="pocket-inferno__chips">
                <span>Version ${VERSION}</span><span>2–4 players</span><span>No bots</span>
              </div>
              <button class="pocket-inferno__primary-button" type="button" data-action="join" disabled>Loading arena…</button>
            </div>
          </section>

          <section class="pocket-inferno__screen pocket-inferno__lobby" data-screen="lobby">
            <div class="pocket-inferno__lobby-hero">
              <span class="pocket-inferno__arena-icon" aria-hidden="true"></span>
              <div>
                <p class="pocket-inferno__kicker">ARENA LOCKER</p>
                <h2 data-role="lobby-title">Ready your weapons</h2>
                <p data-role="lobby-copy">Everyone must join and ready up before the arena opens.</p>
              </div>
            </div>
            <div class="pocket-inferno__players-grid" data-role="lobby-players"></div>
            <div class="pocket-inferno__lobby-actions">
              <button class="pocket-inferno__primary-button" type="button" data-action="ready">Ready</button>
              <button class="pocket-inferno__secondary-button" type="button" data-action="take-control">Take control</button>
              <button class="pocket-inferno__secondary-button" type="button" data-action="leave">Leave match</button>
            </div>
          </section>

          <section class="pocket-inferno__screen pocket-inferno__game" data-screen="game">
            <div class="pocket-inferno__game-shell">
              <canvas class="pocket-inferno__canvas" data-role="canvas" aria-label="First-person arena view"></canvas>
              <div class="pocket-inferno__player-rail" data-role="game-players"></div>
              <div class="pocket-inferno__hud">
                <div class="pocket-inferno__hud-card"><span>HEALTH</span><strong data-role="health">100</strong></div>
                <div class="pocket-inferno__hud-card"><span>FRAGS</span><strong data-role="score">0 / 7</strong></div>
                <div class="pocket-inferno__hud-card"><span>TIME</span><strong data-role="time">3:00</strong></div>
              </div>
              <div class="pocket-inferno__game-message" data-role="game-message">Loading arena…</div>
              <div class="pocket-inferno__controller-warning" data-role="controller-warning">
                <span>This match is controlled in another tab.</span>
                <button type="button" data-action="take-control">Take control here</button>
              </div>
              <div class="pocket-inferno__touch-layer" data-role="touch-layer">
                <div class="pocket-inferno__move-pad" data-role="move-pad" aria-label="Move control">
                  <span class="pocket-inferno__stick" data-role="move-stick"></span>
                </div>
                <div class="pocket-inferno__look-pad" data-role="look-pad" aria-label="Drag to turn"><span>DRAG TO TURN</span></div>
                <div class="pocket-inferno__weapon-controls">
                  <button class="pocket-inferno__weapon-button is-selected" type="button" data-weapon="1"><span>1</span>Blaster</button>
                  <button class="pocket-inferno__weapon-button" type="button" data-weapon="2"><span>2</span>Shotgun <b data-role="ammo">4</b></button>
                </div>
                <button class="pocket-inferno__fire-button" type="button" data-role="fire">FIRE</button>
              </div>
              <div class="pocket-inferno__damage-flash" data-role="damage-flash"></div>
            </div>
          </section>

          <section class="pocket-inferno__screen pocket-inferno__results" data-screen="results">
            <div class="pocket-inferno__result-emblem" aria-hidden="true">✦</div>
            <p class="pocket-inferno__kicker">MATCH COMPLETE</p>
            <h2 data-role="result-title">Arena cleared</h2>
            <div class="pocket-inferno__result-list" data-role="result-list"></div>
            <div class="pocket-inferno__result-actions">
              <button class="pocket-inferno__primary-button" type="button" data-action="play-again">Play another match</button>
              <button class="pocket-inferno__secondary-button" type="button" data-action="exit-fullscreen">Exit fullscreen</button>
            </div>
          </section>
        </main>

        <div class="pocket-inferno__toast" data-role="toast" aria-live="polite"></div>
      `;
      container.replaceChildren(root);

      const canvas = root.querySelector('[data-role="canvas"]');
      const ctx = canvas.getContext("2d", { alpha: false });
      const logo = root.querySelector('[data-role="logo"]');
      const splashImage = root.querySelector('[data-role="splash-image"]');
      const joinButton = root.querySelector('[data-action="join"]');
      const connectionLabel = root.querySelector('[data-role="connection"]');
      const lobbyPlayers = root.querySelector('[data-role="lobby-players"]');
      const gamePlayers = root.querySelector('[data-role="game-players"]');
      const healthLabel = root.querySelector('[data-role="health"]');
      const scoreLabel = root.querySelector('[data-role="score"]');
      const timeLabel = root.querySelector('[data-role="time"]');
      const ammoLabel = root.querySelector('[data-role="ammo"]');
      const gameMessage = root.querySelector('[data-role="game-message"]');
      const controllerWarning = root.querySelector('[data-role="controller-warning"]');
      const movePad = root.querySelector('[data-role="move-pad"]');
      const moveStick = root.querySelector('[data-role="move-stick"]');
      const lookPad = root.querySelector('[data-role="look-pad"]');
      const fireButton = root.querySelector('[data-role="fire"]');
      const toast = root.querySelector('[data-role="toast"]');
      const damageFlash = root.querySelector('[data-role="damage-flash"]');
      const resultTitle = root.querySelector('[data-role="result-title"]');
      const resultList = root.querySelector('[data-role="result-list"]');
      const lobbyTitle = root.querySelector('[data-role="lobby-title"]');
      const lobbyCopy = root.querySelector('[data-role="lobby-copy"]');
      const readyButton = root.querySelector('[data-action="ready"]');

      logo.src = logoUrl;
      splashImage.src = splashUrl;
      loadAssetBundle().then((bundle) => {
        if (destroyed) return;
        textureAssets = bundle;
        joinButton.disabled = false;
        joinButton.textContent = "Join game";
      }).catch(() => {
        if (destroyed) return;
        joinButton.disabled = false;
        joinButton.textContent = "Join game";
        showToast("Texture pack could not load; using fallback rendering", "warning");
      });

      function localSeat() {
        return activeMatch && activeMatch.you && activeMatch.you.role === "player"
          ? activeMatch.you.seat
          : null;
      }

      function playerStateBySeat(seat) {
        return snapshot && Array.isArray(snapshot.players)
          ? snapshot.players.find((player) => player.seat === seat)
          : null;
      }

      function localPlayerState() {
        const seat = localSeat();
        return seat ? playerStateBySeat(seat) : null;
      }

      function barrelStateById(id) {
        return snapshot && Array.isArray(snapshot.barrels)
          ? snapshot.barrels.find((barrel) => barrel.id === id)
          : null;
      }

      function startBarrelExplosion(id, x, y, now = performance.now(), force = false) {
        if (!Number.isFinite(Number(id)) || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
        const existing = effects.explodingBarrels.get(id);
        if (existing && existing.until > now && !force) return;
        effects.explodingBarrels.set(id, {
          id,
          x: Number(x),
          y: Number(y),
          startAt: now,
          until: now + EXPLOSION_DURATION_MS,
        });
        effects.shakeUntil = Math.max(effects.shakeUntil, now + 220);
      }

      function reconcileBarrelEffects(nextSnapshot) {
        const barrels = Array.isArray(nextSnapshot?.barrels) ? nextSnapshot.barrels : [];
        const nextActivity = new Map();
        const now = performance.now();
        for (const barrel of barrels) {
          const id = barrel.id;
          const active = Boolean(barrel.active);
          const previous = effects.barrelActiveById.get(id);
          nextActivity.set(id, active);
          if (previous === true && !active) {
            startBarrelExplosion(id, barrel.x, barrel.y, now, false);
          }
        }
        effects.barrelActiveById.clear();
        for (const [id, active] of nextActivity) effects.barrelActiveById.set(id, active);
      }

      function canControl() {
        return Boolean(
          activeMatch
          && activeMatch.state === "playing"
          && activeMatch.you?.role === "player"
          && activeMatch.you?.controller
          && snapshot
          && (snapshot.phase === "countdown" || snapshot.phase === "playing")
        );
      }

      function setScreen(name) {
        root.querySelectorAll("[data-screen]").forEach((screen) => {
          screen.classList.toggle("is-visible", screen.dataset.screen === name);
        });
        root.classList.toggle("is-playing", name === "game");
      }

      function showToast(message, kind = "neutral") {
        window.clearTimeout(toastTimer);
        toast.textContent = message;
        toast.dataset.kind = kind;
        toast.classList.add("is-visible");
        toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1900);
      }

      function clearControlState() {
        keys.clear();
        control.forward = 0;
        control.strafe = 0;
        control.fire = false;
        touchState.forward = 0;
        touchState.strafe = 0;
        moveStick.style.transform = "translate(0, 0)";
        fireButton.classList.remove("is-held");
        activePointers.clear();
      }

      function clearMatchState() {
        activeMatch = null;
        snapshot = null;
        result = null;
        predicted = null;
        remotePlayers = new Map();
        latestSnapshotRevision = -1;
        requestedSnapshotMatchId = null;
        lastInputSignature = "";
        effects.explodingBarrels.clear();
        effects.barrelActiveById.clear();
        clearControlState();
        setScreen("splash");
      }

      function formatTime(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
      }

      function buildAvatar(profile, seat, neutral = false) {
        const avatar = document.createElement("span");
        avatar.className = `pocket-inferno__avatar${neutral ? " is-neutral" : ""}`;
        if (!neutral && seat) avatar.style.setProperty("--seat-colour", SEAT_COLOURS[seat - 1]);
        const fallback = document.createElement("span");
        fallback.textContent = initials(profile?.nickname);
        avatar.append(fallback);
        if (profile?.avatarUrl) {
          const image = document.createElement("img");
          image.alt = "";
          image.src = profile.avatarUrl;
          image.addEventListener("error", () => image.remove(), { once: true });
          avatar.append(image);
        }
        return avatar;
      }

      function buildPlayerCard(seatEntry, compact = false) {
        const card = document.createElement("div");
        const occupied = Boolean(seatEntry.player);
        const isLocal = occupied && activeMatch?.you?.role === "player" && activeMatch.you.seat === seatEntry.seat;
        card.className = `pocket-inferno__player-card seat-${seatEntry.seat}${isLocal ? " is-local" : ""}${compact ? " is-compact" : ""}`;

        if (!occupied) {
          card.classList.add("is-open");
          const openMark = document.createElement("span");
          openMark.className = "pocket-inferno__open-avatar";
          openMark.textContent = "+";
          const label = document.createElement("strong");
          label.textContent = "Open Seat";
          card.append(openMark, label);
          return card;
        }

        const state = playerStateBySeat(seatEntry.seat);
        const details = document.createElement("span");
        details.className = "pocket-inferno__player-details";
        const name = document.createElement("strong");
        name.textContent = seatEntry.player.nickname;
        const status = document.createElement("small");
        if (activeMatch.state === "waiting") {
          status.textContent = seatEntry.ready ? "Ready" : "Not ready";
        } else if (state) {
          status.textContent = state.dead ? `Respawning · ${state.k} frags` : `${state.k} frags · ${state.h} health`;
        } else {
          status.textContent = "Loading";
        }
        details.append(name, status);
        const marker = document.createElement("span");
        marker.className = "pocket-inferno__seat-marker";
        marker.textContent = isLocal ? "YOU" : String(seatEntry.seat);
        card.append(buildAvatar(seatEntry.player, seatEntry.seat), details, marker);
        return card;
      }

      function buildSpectatorCard(profile) {
        const card = document.createElement("div");
        card.className = "pocket-inferno__player-card is-spectator is-compact";
        const name = document.createElement("strong");
        name.textContent = profile.nickname;
        card.append(buildAvatar(profile, null, true), name);
        return card;
      }

      function renderMembership() {
        if (!activeMatch) return;
        const seats = Array.isArray(activeMatch.seats) ? activeMatch.seats.slice() : [];
        const ownSeat = localSeat();
        seats.sort((left, right) => {
          if (left.seat === ownSeat) return -1;
          if (right.seat === ownSeat) return 1;
          return left.seat - right.seat;
        });

        lobbyPlayers.replaceChildren(...seats.map((seat) => buildPlayerCard(seat, false)));

        const activeCards = seats
          .filter((seat) => seat.player)
          .map((seat) => buildPlayerCard(seat, true));
        if (activeMatch.state !== "waiting" && Array.isArray(activeMatch.spectators)) {
          activeCards.push(...activeMatch.spectators.map(buildSpectatorCard));
        }
        gamePlayers.replaceChildren(...activeCards);

        const ownEntry = seats.find((seat) => seat.seat === ownSeat);
        readyButton.hidden = activeMatch.you?.role !== "player" || activeMatch.state !== "waiting" || Boolean(ownEntry?.ready);
        root.querySelectorAll('[data-action="take-control"]').forEach((button) => {
          button.hidden = activeMatch.you?.role !== "player" || Boolean(activeMatch.you?.controller);
        });

        if (activeMatch.you?.role === "spectator") {
          lobbyTitle.textContent = "Spectating this match";
          lobbyCopy.textContent = "The player seats are locked, but you can watch the arena live.";
        } else if (ownEntry?.ready) {
          lobbyTitle.textContent = "Ready — waiting for rivals";
          lobbyCopy.textContent = "The arena opens when every occupied seat is ready.";
        } else {
          lobbyTitle.textContent = "Ready your weapons";
          lobbyCopy.textContent = "Everyone must join and ready up before the arena opens.";
        }
      }

      function syncRemotePlayers() {
        if (!snapshot || !Array.isArray(snapshot.players)) return;
        const seen = new Set();
        for (const player of snapshot.players) {
          seen.add(player.seat);
          const existing = remotePlayers.get(player.seat);
          if (!existing) {
            remotePlayers.set(player.seat, { ...player, rx: player.x, ry: player.y, ra: player.a, rma: Number.isFinite(player.ma) ? player.ma : player.a });
          } else {
            Object.assign(existing, player);
          }
        }
        for (const seat of remotePlayers.keys()) {
          if (!seen.has(seat)) remotePlayers.delete(seat);
        }
      }

      function reconcilePrediction() {
        const authoritative = localPlayerState();
        if (!authoritative) {
          predicted = null;
          return;
        }
        if (!predicted || authoritative.dead) {
          predicted = { x: authoritative.x, y: authoritative.y, a: authoritative.a };
          control.angle = authoritative.a;
          return;
        }
        const dx = authoritative.x - predicted.x;
        const dy = authoritative.y - predicted.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.8) {
          predicted.x = authoritative.x;
          predicted.y = authoritative.y;
        } else {
          predicted.x += dx * 0.28;
          predicted.y += dy * 0.28;
        }
        const angleError = normaliseAngle(authoritative.a - predicted.a);
        if (Math.abs(angleError) > 0.9) {
          predicted.a = authoritative.a;
          control.angle = authoritative.a;
        } else if (!keys.has("ArrowLeft") && !keys.has("ArrowRight") && !activePointers.has("look")) {
          predicted.a = normaliseAngle(predicted.a + angleError * 0.12);
          control.angle = predicted.a;
        }
      }

      function updateHud() {
        const local = localPlayerState();
        healthLabel.textContent = local ? String(local.h) : "—";
        scoreLabel.textContent = local ? `${local.k} / ${snapshot?.limit || 7}` : "—";
        timeLabel.textContent = formatTime(snapshot?.time || 0);
        ammoLabel.textContent = local ? String(local.ammo) : "0";
        root.querySelectorAll("[data-weapon]").forEach((button) => {
          const weapon = Number(button.dataset.weapon);
          button.classList.toggle("is-selected", control.weapon === weapon);
          button.setAttribute("aria-pressed", control.weapon === weapon ? "true" : "false");
          if (weapon === 2) {
            const unavailable = !local || local.ammo <= 0;
            button.classList.toggle("is-unavailable", unavailable);
            button.setAttribute("aria-disabled", unavailable ? "true" : "false");
          }
        });

        controllerWarning.classList.toggle("is-visible", Boolean(
          activeMatch?.you?.role === "player" && !activeMatch.you.controller
        ));

        if (!snapshot) {
          gameMessage.textContent = "Loading arena…";
          gameMessage.classList.add("is-visible");
        } else if (snapshot.phase === "countdown") {
          gameMessage.textContent = String(Math.max(1, Math.ceil(snapshot.countdown / 1000)));
          gameMessage.classList.add("is-visible", "is-countdown");
        } else if (local?.dead) {
          gameMessage.textContent = `Respawning in ${(local.respawn / 1000).toFixed(1)}`;
          gameMessage.classList.add("is-visible");
          gameMessage.classList.remove("is-countdown");
        } else if (activeMatch?.you?.role === "spectator") {
          gameMessage.textContent = "Spectating";
          gameMessage.classList.add("is-visible");
          gameMessage.classList.remove("is-countdown");
        } else {
          gameMessage.classList.remove("is-visible", "is-countdown");
        }
      }

      function updateView() {
        if (!activeMatch) {
          setScreen("splash");
          return;
        }
        if (result || activeMatch.state === "finished") {
          setScreen("results");
          renderResults();
          return;
        }
        if (activeMatch.state === "playing" || activeMatch.state === "countdown") {
          setScreen("game");
          updateHud();
        } else {
          setScreen("lobby");
        }
        renderMembership();
      }

      function renderResults() {
        const payload = result?.payload || null;
        const placements = Array.isArray(payload?.placements) ? payload.placements.slice() : [];
        placements.sort((left, right) => left.place - right.place || left.seat - right.seat);
        const winner = placements.find((placement) => placement.place === 1);
        resultTitle.textContent = winner
          ? `${winner.nickname} rules the arena`
          : "Arena cleared";
        resultList.replaceChildren();
        for (const placement of placements) {
          const row = document.createElement("div");
          row.className = `pocket-inferno__result-row${placement.place === 1 ? " is-winner" : ""}`;
          const place = document.createElement("span");
          place.className = "pocket-inferno__result-place";
          place.textContent = `#${placement.place}`;
          const profile = { nickname: placement.nickname, avatarUrl: null };
          const details = document.createElement("span");
          details.className = "pocket-inferno__result-details";
          const name = document.createElement("strong");
          name.textContent = placement.nickname;
          const meta = document.createElement("small");
          const finalState = playerStateBySeat(placement.seat);
          meta.textContent = `${finalState?.k ?? 0} frags · ${finalState?.d ?? 0} deaths · ${placement.wins} total wins`;
          details.append(name, meta);
          row.append(place, buildAvatar(profile, placement.seat), details);
          resultList.append(row);
        }
      }

      function requestFreshSnapshot(matchId) {
        if (!matchId || requestedSnapshotMatchId === matchId) return;
        if (arcade.game.requestSnapshot(matchId)) requestedSnapshotMatchId = matchId;
      }

      function acceptMatch(nextMatch) {
        if (nextMatch.you?.role === "none" || nextMatch.state === "closed") {
          if (!activeMatch || nextMatch.matchId === activeMatch.matchId) clearMatchState();
          return;
        }
        const changedMatch = !activeMatch || nextMatch.matchId !== activeMatch.matchId;
        const previousState = activeMatch?.state;
        if (changedMatch) {
          snapshot = null;
          result = null;
          predicted = null;
          remotePlayers = new Map();
          latestSnapshotRevision = -1;
          requestedSnapshotMatchId = null;
          lastInputSignature = "";
          effects.explodingBarrels.clear();
          effects.barrelActiveById.clear();
          clearControlState();
        }
        activeMatch = nextMatch;
        updateView();
        if ((nextMatch.state === "playing" || nextMatch.state === "countdown")
            && (changedMatch || previousState !== nextMatch.state || !snapshot)) {
          requestFreshSnapshot(nextMatch.matchId);
        }
      }

      function updateConnection(nextStatus) {
        const status = typeof nextStatus === "string"
          ? nextStatus
          : arcade.connectionStatus;
        connectionLabel.textContent = status === "connected" ? "Online" : status === "connecting" ? "Connecting" : "Reconnecting";
        connectionLabel.dataset.state = status || "unknown";
        if (status !== "connected") clearControlState();
      }

      function updateCanvasSize() {
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        renderScale = Math.min(window.devicePixelRatio || 1, 1.35);
        const nextWidth = Math.max(240, Math.min(640, Math.round(rect.width * renderScale)));
        const nextHeight = Math.max(180, Math.min(520, Math.round(rect.height * renderScale)));
        if (nextWidth !== canvasWidth || nextHeight !== canvasHeight) {
          canvasWidth = nextWidth;
          canvasHeight = nextHeight;
          canvas.width = nextWidth;
          canvas.height = nextHeight;
        }
      }

      function castRay(originX, originY, angle) {
        const directionX = Math.cos(angle);
        const directionY = Math.sin(angle);
        let mapX = Math.floor(originX);
        let mapY = Math.floor(originY);
        const deltaX = directionX === 0 ? 1e30 : Math.abs(1 / directionX);
        const deltaY = directionY === 0 ? 1e30 : Math.abs(1 / directionY);
        const stepX = directionX < 0 ? -1 : 1;
        const stepY = directionY < 0 ? -1 : 1;
        let sideX = directionX < 0 ? (originX - mapX) * deltaX : (mapX + 1 - originX) * deltaX;
        let sideY = directionY < 0 ? (originY - mapY) * deltaY : (mapY + 1 - originY) * deltaY;
        let side = 0;
        let guard = 0;
        while (guard < 48) {
          if (sideX < sideY) {
            sideX += deltaX;
            mapX += stepX;
            side = 0;
          } else {
            sideY += deltaY;
            mapY += stepY;
            side = 1;
          }
          guard += 1;
          if (isWall(mapX + 0.5, mapY + 0.5)) break;
        }
        const distance = side === 0
          ? (mapX - originX + (1 - stepX) / 2) / (directionX || 1e-9)
          : (mapY - originY + (1 - stepY) / 2) / (directionY || 1e-9);
        const wallCoordinate = side === 0
          ? originY + distance * directionY
          : originX + distance * directionX;
        return {
          distance: Math.max(0.001, distance),
          side,
          texture: wallCoordinate - Math.floor(wallCoordinate),
          mapX,
          mapY,
          directionX,
          directionY,
        };
      }

      function drawRoundRect(context, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.arcTo(x + width, y, x + width, y + height, r);
        context.arcTo(x + width, y + height, x, y + height, r);
        context.arcTo(x, y + height, x, y, r);
        context.arcTo(x, y, x + width, y, r);
        context.closePath();
      }

      function renderTexturedSurfaces(view, horizon) {
        if (!textureAssets || !surfaceCtx) return false;

        const width = canvasWidth;
        const height = canvasHeight;
        const surfaceWidth = Math.max(1, Math.ceil(width / 2));
        const surfaceHeight = Math.max(1, Math.ceil(height / 2));
        if (surfaceCanvas.width !== surfaceWidth || surfaceCanvas.height !== surfaceHeight || !surfaceImageData) {
          surfaceCanvas.width = surfaceWidth;
          surfaceCanvas.height = surfaceHeight;
          surfaceImageData = surfaceCtx.createImageData(surfaceWidth, surfaceHeight);
        }

        const data = surfaceImageData.data;
        const surfaceHorizon = Math.round(horizon * surfaceHeight / height);
        const directionX = Math.cos(view.a);
        const directionY = Math.sin(view.a);
        const planeScale = Math.tan(FOV / 2);
        const planeX = -directionY * planeScale;
        const planeY = directionX * planeScale;
        const leftRayX = directionX - planeX;
        const leftRayY = directionY - planeY;
        const rightRayX = directionX + planeX;
        const rightRayY = directionY + planeY;

        for (let y = 0; y < surfaceHeight; y += 1) {
          const floorSide = y > surfaceHorizon;
          const rowOffset = Math.abs(y - surfaceHorizon);
          if (rowOffset < 1) {
            const lineOffset = y * surfaceWidth * 4;
            for (let x = 0; x < surfaceWidth; x += 1) {
              const target = lineOffset + x * 4;
              data[target] = 124;
              data[target + 1] = 38;
              data[target + 2] = 24;
              data[target + 3] = 255;
            }
            continue;
          }

          const rowDistance = (surfaceHeight * 0.48) / rowOffset;
          const stepX = rowDistance * (rightRayX - leftRayX) / surfaceWidth;
          const stepY = rowDistance * (rightRayY - leftRayY) / surfaceWidth;
          let worldX = view.x + rowDistance * leftRayX;
          let worldY = view.y + rowDistance * leftRayY;
          const atlas = floorSide ? textureAssets.floor.pixels : textureAssets.ceiling.pixels;
          const shade = floorSide
            ? clamp(0.82 - rowDistance * 0.045, 0.18, 0.76)
            : clamp(0.68 - rowDistance * 0.035, 0.13, 0.62);
          const redGlow = clamp(1 - rowDistance / 7, 0, 1) * (floorSide ? 15 : 8);

          for (let x = 0; x < surfaceWidth; x += 1) {
            const cellX = Math.floor(worldX);
            const cellY = Math.floor(worldY);
            const tile = textureIndexForCell(cellX, cellY, floorSide ? 0x31f2 : 0x58a7);
            const textureX = Math.floor((worldX - cellX) * TEXTURE_TILE_SIZE) & (TEXTURE_TILE_SIZE - 1);
            const textureY = Math.floor((worldY - cellY) * TEXTURE_TILE_SIZE) & (TEXTURE_TILE_SIZE - 1);
            const atlasX = (tile % TEXTURE_COLUMNS) * TEXTURE_TILE_SIZE + textureX;
            const atlasY = Math.floor(tile / TEXTURE_COLUMNS) * TEXTURE_TILE_SIZE + textureY;
            const source = (atlasY * atlas.width + atlasX) * 4;
            const target = (y * surfaceWidth + x) * 4;
            data[target] = Math.min(255, atlas.data[source] * shade + redGlow);
            data[target + 1] = Math.min(255, atlas.data[source + 1] * shade);
            data[target + 2] = Math.min(255, atlas.data[source + 2] * shade);
            data[target + 3] = 255;
            worldX += stepX;
            worldY += stepY;
          }
        }

        surfaceCtx.putImageData(surfaceImageData, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(surfaceCanvas, 0, 0, width, height);
        return true;
      }

      function purgeExpiredExplosions(now) {
        for (const [id, explosion] of effects.explodingBarrels.entries()) {
          if (explosion.until <= now) effects.explodingBarrels.delete(id);
        }
      }

      function drawFallbackWeapon(width, height, weapon, now) {
        const recoil = effects.muzzleUntil > now ? height * 0.025 * WEAPON_DISPLAY_SCALE : 0;
        const centreX = width / 2;
        const baseY = height + recoil;
        const gunWidth = (weapon === 2 ? width * 0.34 : width * 0.23) * WEAPON_DISPLAY_SCALE;
        const gunHeight = (weapon === 2 ? height * 0.28 : height * 0.22) * WEAPON_DISPLAY_SCALE;
        ctx.save();
        ctx.translate(centreX, baseY);
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.beginPath();
        ctx.ellipse(0, -gunHeight * 0.05, gunWidth * 0.55, gunHeight * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = weapon === 2 ? "#6c5262" : "#584b73";
        ctx.strokeStyle = "#21182f";
        ctx.lineWidth = Math.max(2, width * 0.006);
        ctx.beginPath();
        ctx.moveTo(-gunWidth * 0.48, 0);
        ctx.lineTo(-gunWidth * 0.32, -gunHeight * 0.76);
        ctx.lineTo(-gunWidth * 0.11, -gunHeight);
        ctx.lineTo(gunWidth * 0.11, -gunHeight);
        ctx.lineTo(gunWidth * 0.32, -gunHeight * 0.76);
        ctx.lineTo(gunWidth * 0.48, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = weapon === 2 ? "#f5b83d" : "#ef5d67";
        drawRoundRect(ctx, -gunWidth * 0.13, -gunHeight * 0.94, gunWidth * 0.26, gunHeight * 0.45, gunWidth * 0.06);
        ctx.fill();
        if (effects.muzzleUntil > now) {
          ctx.fillStyle = "rgba(255,229,145,.96)";
          ctx.beginPath();
          ctx.moveTo(0, -gunHeight * 1.42);
          ctx.lineTo(-gunWidth * 0.16, -gunHeight * 0.94);
          ctx.lineTo(0, -gunHeight * 1.08);
          ctx.lineTo(gunWidth * 0.16, -gunHeight * 0.94);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      function floorProjectionY(horizon, height, correctedDistance) {
        return horizon + (height * 0.39) / Math.max(0.05, correctedDistance);
      }

      function playerSpriteFrameForView(movementAngle, targetX, targetY, viewX, viewY) {
        // Compare the player's world-space movement heading with the bearing from
        // that player to this first-person camera. The resulting eight octants
        // map directly to the supplied sprite sheet:
        // toward, forward-right, right, away-right, away, away-left, left,
        // forward-left.
        const bearingToViewer = Math.atan2(viewY - targetY, viewX - targetX);
        const relative = normaliseAngle(bearingToViewer - movementAngle);
        const octant = ((Math.floor((relative + Math.PI / 8) / (Math.PI / 4)) % 8) + 8) % 8;
        const key = PLAYER_DIRECTION_ORDER[octant] || "toward";
        return PLAYER_SPRITES[key] || PLAYER_SPRITES.toward;
      }

      function torchVariantForView(torch, view) {
        const viewerX = view.x - torch.x;
        const viewerY = view.y - torch.y;
        const distance = Math.hypot(viewerX, viewerY) || 1;
        const dirX = viewerX / distance;
        const dirY = viewerY / distance;
        const front = torch.nx * dirX + torch.ny * dirY;
        if (front >= 0.74) return "front";
        const tangentX = -torch.ny;
        const tangentY = torch.nx;
        const side = tangentX * dirX + tangentY * dirY;
        return side >= 0 ? "left" : "right";
      }

      function drawWithWallOcclusion(left, spriteWidth, correctedDistance, depth, columnStep, draw) {
        const startX = Math.max(0, Math.floor(left));
        const endX = Math.min(canvasWidth, Math.ceil(left + spriteWidth));
        if (endX <= startX) return false;

        const runs = [];
        let runStart = -1;
        for (let x = startX; x < endX; x += columnStep) {
          const depthIndex = clamp(Math.floor(x / columnStep), 0, depth.length - 1);
          const wallDistance = depth[depthIndex];
          const visible = !Number.isFinite(wallDistance)
            || correctedDistance <= wallDistance + SPRITE_WALL_EPSILON;
          if (visible && runStart < 0) runStart = x;
          if (!visible && runStart >= 0) {
            runs.push([runStart, x]);
            runStart = -1;
          }
        }
        if (runStart >= 0) runs.push([runStart, endX]);
        if (!runs.length) return false;

        ctx.save();
        ctx.beginPath();
        for (const run of runs) {
          ctx.rect(run[0], -canvasHeight, Math.max(columnStep, run[1] - run[0]), canvasHeight * 3);
        }
        ctx.clip();
        draw();
        ctx.restore();
        return true;
      }

      function drawWorld(view, now) {
        const width = canvasWidth;
        const height = canvasHeight;
        if (!width || !height || !ctx) return;

        const horizon = Math.round(height * 0.47);
        if (!renderTexturedSurfaces(view, horizon)) {
          const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
          ceiling.addColorStop(0, "#171127");
          ceiling.addColorStop(1, "#4c2440");
          ctx.fillStyle = ceiling;
          ctx.fillRect(0, 0, width, horizon);
          const floor = ctx.createLinearGradient(0, horizon, 0, height);
          floor.addColorStop(0, "#35283c");
          floor.addColorStop(1, "#120f1d");
          ctx.fillStyle = floor;
          ctx.fillRect(0, horizon, width, height - horizon);
        }

        ctx.fillStyle = "rgba(255,94,37,.24)";
        ctx.fillRect(0, horizon - 2, width, 4);

        const columnStep = width < 400 ? 2 : 3;
        const depth = new Array(Math.ceil(width / columnStep));
        for (let x = 0, index = 0; x < width; x += columnStep, index += 1) {
          const rayAngle = view.a - FOV / 2 + (x / width) * FOV;
          const hit = castRay(view.x, view.y, rayAngle);
          const corrected = Math.max(0.05, hit.distance * Math.cos(rayAngle - view.a));
          depth[index] = corrected;
          const wallHeight = Math.min(height * 2, (height * 0.78) / corrected);
          const top = horizon - wallHeight / 2;
          const shade = clamp(1 - corrected / 13, 0.18, 0.95);
          const sideShade = hit.side ? 0.74 : 1;
          if (textureAssets) {
            const tile = textureIndexForCell(hit.mapX, hit.mapY, 0x6d2b);
            let textureColumn = Math.floor(hit.texture * TEXTURE_TILE_SIZE);
            if ((hit.side === 0 && hit.directionX > 0) || (hit.side === 1 && hit.directionY < 0)) {
              textureColumn = TEXTURE_TILE_SIZE - 1 - textureColumn;
            }
            const atlasX = (tile % TEXTURE_COLUMNS) * TEXTURE_TILE_SIZE + textureColumn;
            const atlasY = Math.floor(tile / TEXTURE_COLUMNS) * TEXTURE_TILE_SIZE;
            ctx.drawImage(
              textureAssets.wall.image,
              atlasX,
              atlasY,
              1,
              TEXTURE_TILE_SIZE,
              x,
              top,
              columnStep + 1,
              wallHeight
            );
            const darkness = clamp(1 - shade * sideShade, 0.05, 0.82);
            ctx.fillStyle = `rgba(11,4,8,${darkness})`;
            ctx.fillRect(x, top, columnStep + 1, wallHeight);
            if (corrected < 4.5) {
              ctx.fillStyle = `rgba(255,78,27,${0.08 * shade})`;
              ctx.fillRect(x, top, 1, wallHeight);
            }
          } else {
            const stripe = hit.texture > 0.48 && hit.texture < 0.54 ? 1.16 : 1;
            const r = Math.floor(125 * shade * stripe * sideShade);
            const g = Math.floor(69 * shade * stripe * sideShade);
            const b = Math.floor(92 * shade * stripe * sideShade);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, top, columnStep + 1, wallHeight);
          }
        }

        purgeExpiredExplosions(now);
        const sprites = [];
        for (const player of remotePlayers.values()) {
          if (player.seat !== localSeat() && !player.dead) {
            sprites.push({ type: "player", x: player.rx, y: player.ry, a: Number.isFinite(player.rma) ? player.rma : player.ra, seat: player.seat, distance: Math.hypot(player.rx - view.x, player.ry - view.y) });
          }
        }
        if (snapshot?.pickups) {
          for (const pickup of snapshot.pickups) {
            if (!pickup.active) continue;
            const definition = PICKUP_POSITIONS[pickup.id];
            if (definition) sprites.push({ type: definition.kind, x: definition.x, y: definition.y, id: pickup.id, distance: Math.hypot(definition.x - view.x, definition.y - view.y) });
          }
        }
        if (snapshot?.barrels) {
          for (const barrel of snapshot.barrels) {
            if (!barrel.active) continue;
            sprites.push({
              type: barrel.kind === "flame" ? "flame-barrel" : "wood-barrel",
              x: barrel.x,
              y: barrel.y,
              id: barrel.id,
              distance: Math.hypot(barrel.x - view.x, barrel.y - view.y),
            });
          }
        }
        for (const torch of DECOR_TORCHES) {
          sprites.push({
            type: "torch",
            x: torch.x,
            y: torch.y,
            id: torch.id,
            variant: torchVariantForView(torch, view),
            distance: Math.hypot(torch.x - view.x, torch.y - view.y),
          });
        }
        for (const explosion of effects.explodingBarrels.values()) {
          sprites.push({
            type: "barrel-explosion",
            x: explosion.x,
            y: explosion.y,
            id: explosion.id,
            startAt: explosion.startAt,
            distance: Math.hypot(explosion.x - view.x, explosion.y - view.y),
          });
        }
        sprites.sort((left, right) => right.distance - left.distance);

        for (const sprite of sprites) {
          const dx = sprite.x - view.x;
          const dy = sprite.y - view.y;
          const distance = Math.hypot(dx, dy);
          const relative = normaliseAngle(Math.atan2(dy, dx) - view.a);
          if (Math.abs(relative) > FOV * 0.62 || distance < 0.2) continue;
          const corrected = distance * Math.cos(relative);
          const screenX = (0.5 + relative / FOV) * width;

          if (sprite.type === "player") {
            const image = textureAssets?.playerSprites?.tinted?.[sprite.seat - 1] || textureAssets?.playerSprites?.image;
            const frame = playerSpriteFrameForView(sprite.a || 0, sprite.x, sprite.y, view.x, view.y);
            if (!image || !frame) continue;
            const drawHeight = clamp((height * 1.0126) / corrected, 28, height * 0.8574);
            const drawWidth = drawHeight * (frame.w / frame.h);
            const anchorX = frame.ax != null ? frame.ax / frame.w : 0.5;
            const anchorY = frame.ay != null ? frame.ay / frame.h : 1;
            const x = Math.round(screenX - drawWidth * anchorX);
            const floorY = Math.round(floorProjectionY(horizon, height, corrected));
            const y = Math.round(floorY - drawHeight * anchorY);
            drawWithWallOcclusion(x, drawWidth, corrected, depth, columnStep, () => {
              ctx.save();
              ctx.imageSmoothingEnabled = false;
              ctx.shadowColor = "rgba(0,0,0,.45)";
              ctx.shadowBlur = Math.max(2, drawWidth * 0.08);
              ctx.shadowOffsetY = drawHeight * 0.05;
              ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, x, y, drawWidth, drawHeight);
              const shotAt = effects.shotBySeat.get(sprite.seat) || 0;
              if (shotAt > now) {
                ctx.globalCompositeOperation = "screen";
                ctx.fillStyle = "rgba(255,224,140,.92)";
                ctx.beginPath();
                ctx.arc(x + drawWidth * 0.78, y + drawHeight * 0.42, drawWidth * 0.08, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.restore();
            });
            continue;
          }

          if (sprite.type === "health" || sprite.type === "shells") {
            const size = clamp((height * 0.25) / corrected, 10, height * 0.24);
            const pulse = 1 + Math.sin(now / 160 + (sprite.id || 0)) * 0.08;
            const drawSize = size * pulse;
            const x = screenX - drawSize / 2;
            const y = horizon + size * 0.18 - drawSize / 2;
            drawWithWallOcclusion(x, drawSize, corrected, depth, columnStep, () => {
              ctx.save();
              ctx.shadowBlur = size * 0.4;
              ctx.shadowColor = sprite.type === "health" ? "#ef5d67" : "#f5b83d";
              ctx.fillStyle = sprite.type === "health" ? "#fff7ef" : "#f5b83d";
              drawRoundRect(ctx, x, y, drawSize, drawSize, drawSize * 0.24);
              ctx.fill();
              ctx.shadowBlur = 0;
              ctx.strokeStyle = sprite.type === "health" ? "#ef5d67" : "#6f4511";
              ctx.lineWidth = Math.max(2, size * 0.1);
              if (sprite.type === "health") {
                ctx.beginPath();
                ctx.moveTo(screenX, y + drawSize * 0.2);
                ctx.lineTo(screenX, y + drawSize * 0.8);
                ctx.moveTo(x + drawSize * 0.2, y + drawSize * 0.5);
                ctx.lineTo(x + drawSize * 0.8, y + drawSize * 0.5);
                ctx.stroke();
              } else {
                ctx.beginPath();
                ctx.moveTo(x + drawSize * 0.28, y + drawSize * 0.22);
                ctx.lineTo(x + drawSize * 0.72, y + drawSize * 0.78);
                ctx.moveTo(x + drawSize * 0.72, y + drawSize * 0.22);
                ctx.lineTo(x + drawSize * 0.28, y + drawSize * 0.78);
                ctx.stroke();
              }
              ctx.restore();
            });
            continue;
          }

          if (sprite.type === "wood-barrel" || sprite.type === "flame-barrel") {
            const image = sprite.type === "wood-barrel"
              ? textureAssets?.woodBarrel?.image
              : textureAssets?.flameBarrel?.image;
            const rect = sprite.type === "wood-barrel" ? WOOD_BARREL_SPRITE : FLAME_BARREL_SPRITE;
            if (!image || !rect) continue;
            const drawHeight = clamp((height * (sprite.type === "wood-barrel" ? 0.4674 : 0.513)) / corrected, 17, height * 0.399);
            const drawWidth = drawHeight * (rect.w / rect.h);
            const x = Math.round(screenX - drawWidth / 2);
            const floorY = Math.round(floorProjectionY(horizon, height, corrected));
            const y = Math.round(floorY - drawHeight);
            drawWithWallOcclusion(x, drawWidth, corrected, depth, columnStep, () => {
              ctx.save();
              ctx.imageSmoothingEnabled = false;
              ctx.shadowColor = sprite.type === "flame-barrel" ? "rgba(255,120,38,.42)" : "rgba(0,0,0,.35)";
              ctx.shadowBlur = sprite.type === "flame-barrel" ? drawWidth * 0.12 : drawWidth * 0.05;
              ctx.shadowOffsetY = drawHeight * 0.04;
              ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, x, y, drawWidth, drawHeight);
              ctx.restore();
            });
            continue;
          }

          if (sprite.type === "torch") {
            const image = textureAssets?.torch?.image;
            const rect = TORCH_SPRITES[sprite.variant] || TORCH_SPRITES.front;
            if (!image || !rect) continue;
            const drawHeight = clamp((height * 0.45) / corrected, 16, height * 0.33);
            const drawWidth = drawHeight * (rect.w / rect.h);
            const x = screenX - drawWidth / 2;
            const y = horizon - drawHeight * 0.72;
            drawWithWallOcclusion(x, drawWidth, corrected, depth, columnStep, () => {
              ctx.save();
              ctx.shadowColor = "rgba(255,149,40,.58)";
              ctx.shadowBlur = drawWidth * 0.32;
              ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, x, y, drawWidth, drawHeight);
              ctx.restore();
            });
            continue;
          }

          if (sprite.type === "barrel-explosion") {
            const image = textureAssets?.flameBarrelExplosion?.image;
            if (!image) continue;
            const elapsed = Math.max(0, now - sprite.startAt);
            const frame = Math.min(EXPLOSION_FRAME_COUNT - 1, Math.floor(elapsed / EXPLOSION_FRAME_MS));
            const sourceX = (frame % 4) * EXPLOSION_FRAME_WIDTH;
            const sourceY = Math.floor(frame / 4) * EXPLOSION_FRAME_HEIGHT;
            const drawHeight = clamp((height * 1.05) / corrected, 56, height * 0.95);
            const drawWidth = drawHeight * (EXPLOSION_FRAME_WIDTH / EXPLOSION_FRAME_HEIGHT);
            const x = Math.round(screenX - drawWidth / 2);
            const floorY = Math.round(floorProjectionY(horizon, height, corrected));
            const y = Math.round(floorY - drawHeight);
            drawWithWallOcclusion(x, drawWidth, corrected, depth, columnStep, () => {
              ctx.save();
              ctx.shadowColor = "rgba(255,126,24,.78)";
              ctx.shadowBlur = drawWidth * 0.28;
              ctx.drawImage(image, sourceX, sourceY, EXPLOSION_FRAME_WIDTH, EXPLOSION_FRAME_HEIGHT, x, y, drawWidth, drawHeight);
              ctx.restore();
            });
          }
        }

        drawWeapon(width, height, now);
        drawRadar(width, height, view);
      }

      function drawWeapon(width, height, now) {
        const local = localPlayerState();
        if (!local || local.dead || activeMatch?.you?.role !== "player") return;
        const weapon = control.weapon;
        const motion = clamp(Math.abs(control.forward) + Math.abs(control.strafe), 0, 1);
        const bobX = Math.sin(now / 115) * width * 0.012 * motion * WEAPON_DISPLAY_SCALE;
        const bobY = Math.abs(Math.cos(now / 115)) * height * 0.016 * motion * WEAPON_DISPLAY_SCALE;
        const recoilY = effects.muzzleUntil > now ? height * 0.024 * WEAPON_DISPLAY_SCALE : 0;
        const sway = Math.sin(now / 280) * width * 0.003 * WEAPON_DISPLAY_SCALE;
        const centreX = width / 2 + bobX + sway;
        const source = WEAPON_SPRITES[weapon] || WEAPON_SPRITES[1];
        const image = textureAssets?.weapons?.image;
        if (!image || !source) {
          drawFallbackWeapon(width, height, weapon, now);
          return;
        }

        const drawWidth = width * (weapon === 2 ? 0.44 : 0.38) * WEAPON_DISPLAY_SCALE;
        const drawHeight = drawWidth * (source.h / source.w);
        const x = centreX - drawWidth / 2;
        const y = height - drawHeight * 0.88 + bobY + recoilY;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.beginPath();
        ctx.ellipse(centreX, y + drawHeight * 0.86, drawWidth * 0.32, drawHeight * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(image, source.x, source.y, source.w, source.h, x, y, drawWidth, drawHeight);
        if (effects.muzzleUntil > now) {
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = "rgba(255,236,164,.88)";
          ctx.beginPath();
          ctx.moveTo(centreX, y + drawHeight * 0.1);
          ctx.lineTo(centreX - drawWidth * 0.08, y - drawHeight * 0.12);
          ctx.lineTo(centreX, y - drawHeight * 0.02);
          ctx.lineTo(centreX + drawWidth * 0.08, y - drawHeight * 0.12);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      function drawRadar(width, height, view) {
        const size = clamp(width * 0.15, 56, 92);
        const x = width - size - 10 * renderScale;
        const y = 58 * renderScale;
        const cell = size / MAP.length;
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = "rgba(18,15,29,.8)";
        drawRoundRect(ctx, x - 5, y - 5, size + 10, size + 10, 9);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.18)";
        for (let row = 0; row < MAP.length; row += 1) {
          for (let column = 0; column < MAP[row].length; column += 1) {
            if (MAP[row][column] !== "0") ctx.fillRect(x + column * cell, y + row * cell, cell + 0.4, cell + 0.4);
          }
        }
        for (const player of remotePlayers.values()) {
          if (player.dead) continue;
          ctx.fillStyle = SEAT_COLOURS[player.seat - 1] || "#fff";
          ctx.beginPath();
          ctx.arc(x + player.rx * cell, y + player.ry * cell, Math.max(2, cell * 0.7), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + view.x * cell, y + view.y * cell);
        ctx.lineTo(x + (view.x + Math.cos(view.a) * 1.2) * cell, y + (view.y + Math.sin(view.a) * 1.2) * cell);
        ctx.stroke();
        ctx.restore();
      }

      function updateInputFromKeyboard(deltaSeconds) {
        const keyForward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0)
          - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
        const keyStrafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
        control.forward = clamp(keyForward + touchState.forward, -1, 1);
        control.strafe = clamp(keyStrafe + touchState.strafe, -1, 1);
        const turn = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
        if (turn && canControl()) control.angle = normaliseAngle(control.angle + turn * 2.7 * deltaSeconds);
        if (predicted) predicted.a = control.angle;
      }

      function updatePrediction(deltaSeconds) {
        const local = localPlayerState();
        if (!predicted || !local || local.dead || snapshot?.phase !== "playing" || !canControl()) return;
        const cosine = Math.cos(control.angle);
        const sine = Math.sin(control.angle);
        let velocityX = (cosine * control.forward - sine * control.strafe) * MOVE_SPEED;
        let velocityY = (sine * control.forward + cosine * control.strafe) * MOVE_SPEED;
        if (control.forward !== 0 && control.strafe !== 0) {
          velocityX *= Math.SQRT1_2;
          velocityY *= Math.SQRT1_2;
        }
        const nextX = predicted.x + velocityX * deltaSeconds;
        const nextY = predicted.y + velocityY * deltaSeconds;
        if (positionClear(nextX, predicted.y)) predicted.x = nextX;
        if (positionClear(predicted.x, nextY)) predicted.y = nextY;
        predicted.a = control.angle;
      }

      function animate(now) {
        if (destroyed) return;
        const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
        lastFrameAt = now;
        updateCanvasSize();
        updateInputFromKeyboard(deltaSeconds);
        updatePrediction(deltaSeconds);

        for (const player of remotePlayers.values()) {
          player.rx += (player.x - player.rx) * clamp(deltaSeconds * 9, 0, 1);
          player.ry += (player.y - player.ry) * clamp(deltaSeconds * 9, 0, 1);
          player.ra = normaliseAngle(player.ra + normaliseAngle(player.a - player.ra) * clamp(deltaSeconds * 9, 0, 1));
          const targetMovementAngle = Number.isFinite(player.ma) ? player.ma : player.a;
          if (!Number.isFinite(player.rma)) player.rma = targetMovementAngle;
          player.rma = normaliseAngle(player.rma + normaliseAngle(targetMovementAngle - player.rma) * clamp(deltaSeconds * 12, 0, 1));
        }

        const local = localPlayerState();
        const view = predicted || (local ? { x: local.x, y: local.y, a: local.a } : { x: 1.5, y: 1.5, a: 0 });
        if (root.classList.contains("is-playing")) {
          ctx.save();
          if (effects.shakeUntil > now && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            ctx.translate((Math.random() - 0.5) * 6 * renderScale, (Math.random() - 0.5) * 4 * renderScale);
          }
          drawWorld(view, now);
          ctx.restore();
          damageFlash.classList.toggle("is-visible", effects.damageUntil > now);
        }
        animationFrame = requestAnimationFrame(animate);
      }

      function sendInput(now = performance.now()) {
        if (!canControl() || document.visibilityState !== "visible") return;
        const local = localPlayerState();
        if (!local || local.dead) return;
        if (control.weapon === 2 && local.ammo <= 0) control.weapon = 1;
        const payload = {
          f: Math.round(control.forward * 100) / 100,
          s: Math.round(control.strafe * 100) / 100,
          a: Math.round(control.angle * 1000) / 1000,
          fire: control.fire,
          w: control.weapon,
        };
        const signature = `${payload.f}|${payload.s}|${payload.a}|${payload.fire ? 1 : 0}|${payload.w}`;
        const unchanged = signature === lastInputSignature;
        if (!payload.fire && unchanged && now - lastInputSentAt < INPUT_HEARTBEAT_MS) return;
        if (arcade.game.send(activeMatch.matchId, "input", payload)) {
          lastInputSignature = signature;
          lastInputSentAt = now;
        }
      }

      function runInputPump() {
        inputTimer = 0;
        if (destroyed) return;
        sendInput(performance.now());
        inputTimer = window.setTimeout(runInputPump, INPUT_INTERVAL_MS);
      }

      function startInputPump() {
        if (destroyed || inputTimer) return;
        inputTimer = window.setTimeout(runInputPump, INPUT_INTERVAL_MS);
      }

      function joinGame() {
        arcade.game.join(APP_ID);
      }

      function handleAction(action) {
        switch (action) {
          case "join":
            joinGame();
            break;
          case "ready":
            if (activeMatch) {
              arcade.display.requestFullscreen();
              arcade.game.ready(activeMatch.matchId);
            }
            break;
          case "leave":
            if (activeMatch) arcade.game.leave(activeMatch.matchId);
            arcade.display.exitFullscreen();
            break;
          case "take-control":
            if (activeMatch) arcade.game.claimControl(activeMatch.matchId);
            break;
          case "fullscreen":
            if (arcade.display.fullscreen) arcade.display.exitFullscreen();
            else arcade.display.requestFullscreen();
            break;
          case "exit-fullscreen":
            arcade.display.exitFullscreen();
            break;
          case "play-again":
            result = null;
            snapshot = null;
            latestSnapshotRevision = -1;
            predicted = null;
            joinGame();
            break;
          default:
            break;
        }
      }

      root.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-action]");
        if (actionButton) handleAction(actionButton.dataset.action);
        const weaponButton = event.target.closest("[data-weapon]");
        if (weaponButton && canControl()) {
          const weapon = Number(weaponButton.dataset.weapon);
          const local = localPlayerState();
          if (weapon === 1 || (weapon === 2 && local && local.ammo > 0)) {
            control.weapon = weapon;
            updateHud();
          } else {
            showToast("Find shotgun shells first", "warning");
          }
        }
      });

      function updateMovePointer(event) {
        const rect = movePad.getBoundingClientRect();
        const centreX = rect.left + rect.width / 2;
        const centreY = rect.top + rect.height / 2;
        const radius = rect.width * 0.34;
        let dx = event.clientX - centreX;
        let dy = event.clientY - centreY;
        const length = Math.hypot(dx, dy);
        if (length > radius) {
          dx = (dx / length) * radius;
          dy = (dy / length) * radius;
        }
        touchState.strafe = clamp(dx / radius, -1, 1);
        touchState.forward = clamp(-dy / radius, -1, 1);
        moveStick.style.transform = `translate(${dx}px, ${dy}px)`;
      }

      movePad.addEventListener("pointerdown", (event) => {
        if (!canControl()) return;
        movePad.setPointerCapture(event.pointerId);
        activePointers.set("move", event.pointerId);
        updateMovePointer(event);
        event.preventDefault();
      });
      movePad.addEventListener("pointermove", (event) => {
        if (activePointers.get("move") !== event.pointerId) return;
        updateMovePointer(event);
        event.preventDefault();
      });
      const releaseMove = (event) => {
        if (activePointers.get("move") !== event.pointerId) return;
        activePointers.delete("move");
        touchState.forward = 0;
        touchState.strafe = 0;
        moveStick.style.transform = "translate(0, 0)";
      };
      movePad.addEventListener("pointerup", releaseMove);
      movePad.addEventListener("pointercancel", releaseMove);

      let lastLookX = 0;
      lookPad.addEventListener("pointerdown", (event) => {
        if (!canControl()) return;
        lookPad.setPointerCapture(event.pointerId);
        activePointers.set("look", event.pointerId);
        lastLookX = event.clientX;
        lookPad.classList.add("is-active");
        event.preventDefault();
      });
      lookPad.addEventListener("pointermove", (event) => {
        if (activePointers.get("look") !== event.pointerId) return;
        const delta = event.clientX - lastLookX;
        lastLookX = event.clientX;
        control.angle = normaliseAngle(control.angle + delta * 0.0115);
        if (predicted) predicted.a = control.angle;
        event.preventDefault();
      });
      const releaseLook = (event) => {
        if (activePointers.get("look") !== event.pointerId) return;
        activePointers.delete("look");
        lookPad.classList.remove("is-active");
      };
      lookPad.addEventListener("pointerup", releaseLook);
      lookPad.addEventListener("pointercancel", releaseLook);

      const setFire = (value, event) => {
        if (value && !canControl()) return;
        control.fire = value;
        fireButton.classList.toggle("is-held", value);
        if (event) event.preventDefault();
      };
      fireButton.addEventListener("pointerdown", (event) => {
        fireButton.setPointerCapture(event.pointerId);
        activePointers.set("fire", event.pointerId);
        setFire(true, event);
      });
      const releaseFire = (event) => {
        if (activePointers.get("fire") !== event.pointerId) return;
        activePointers.delete("fire");
        setFire(false, event);
      };
      fireButton.addEventListener("pointerup", releaseFire);
      fireButton.addEventListener("pointercancel", releaseFire);

      const onKeyDown = (event) => {
        const gameKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Digit1", "Digit2"];
        if (!gameKeys.includes(event.code)) return;
        if (root.classList.contains("is-playing")) event.preventDefault();
        keys.add(event.code);
        if (event.code === "Space") control.fire = true;
        if (event.code === "Digit1") control.weapon = 1;
        if (event.code === "Digit2" && (localPlayerState()?.ammo || 0) > 0) control.weapon = 2;
      };
      const onKeyUp = (event) => {
        keys.delete(event.code);
        if (event.code === "Space") control.fire = false;
      };
      const onVisibility = () => {
        if (document.visibilityState !== "visible") clearControlState();
      };
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);
      document.addEventListener("visibilitychange", onVisibility);

      const stopMatch = arcade.game.onMatch((nextMatch) => acceptMatch(nextMatch));
      const stopSnapshot = arcade.game.onSnapshot((envelope) => {
        if (!activeMatch || envelope.matchId !== activeMatch.matchId) return;
        const revision = Number(envelope.revision);
        if (!Number.isFinite(revision) || revision < latestSnapshotRevision) return;
        latestSnapshotRevision = revision;
        requestedSnapshotMatchId = null;
        snapshot = envelope.payload;
        reconcileBarrelEffects(snapshot);
        syncRemotePlayers();
        reconcilePrediction();
        renderMembership();
        updateHud();
        updateView();
      });
      const stopEvent = arcade.game.onEvent((event) => {
        if (!activeMatch || event.matchId !== activeMatch.matchId) return;
        const payload = event.payload || {};
        const now = performance.now();
        if (event.name === "shot") {
          effects.shotBySeat.set(payload.seat, now + 130);
          if (payload.seat === localSeat()) effects.muzzleUntil = now + 120;
        } else if (event.name === "barrel_explode") {
          const barrel = barrelStateById(payload.id);
          if (barrel) barrel.active = false;
          effects.barrelActiveById.set(payload.id, false);
          startBarrelExplosion(payload.id, payload.x, payload.y, now, true);
        } else if (event.name === "hit") {
          if (payload.target === localSeat()) {
            effects.damageUntil = now + 210;
            effects.shakeUntil = now + 160;
          }
        } else if (event.name === "frag") {
          if (payload.self) {
            showToast(`${nameForSeat(activeMatch, payload.victim)} was caught in the blast`, payload.victim === localSeat() ? "danger" : "neutral");
          } else {
            showToast(`${nameForSeat(activeMatch, payload.killer)} fragged ${nameForSeat(activeMatch, payload.victim)}`, payload.killer === localSeat() ? "success" : "danger");
          }
        } else if (event.name === "pickup") {
          if (payload.seat === localSeat()) showToast(payload.kind === "health" ? "Health restored" : "Shotgun shells collected", "success");
        } else if (event.name === "respawn") {
          if (payload.seat === localSeat()) showToast("Back in the arena", "neutral");
        } else if (event.name === "start") {
          showToast("Fight!", "danger");
        }
      });
      const stopResult = arcade.game.onResult((envelope) => {
        if (!activeMatch || envelope.matchId !== activeMatch.matchId) return;
        result = envelope;
        clearControlState();
        updateView();
      });
      const stopError = arcade.game.onError((error) => {
        if (error.matchId && (!activeMatch || error.matchId !== activeMatch.matchId)) return;
        clearControlState();
        if (error.code === "match_not_found") {
          clearMatchState();
          showToast("That match has closed", "warning");
          return;
        }
        if (error.code === "runtime_failed") {
          showToast("The arena runtime stopped safely", "danger");
          setScreen("results");
          resultTitle.textContent = "Arena runtime stopped";
          resultList.replaceChildren();
          return;
        }
        showToast(error.message || "The command was not accepted", "warning");
      });
      const stopConnection = arcade.onConnection((status) => updateConnection(status));
      const stopFullscreen = arcade.display.onFullscreenChange((fullscreen) => {
        root.classList.toggle("is-fullscreen", Boolean(fullscreen));
        updateCanvasSize();
      });

      const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(updateCanvasSize)
        : null;
      if (resizeObserver) resizeObserver.observe(root);

      const cachedMatch = arcade.game.currentMatch();
      if (cachedMatch && cachedMatch.you?.role !== "none") {
        acceptMatch(cachedMatch);
        const cachedSnapshot = arcade.game.currentSnapshot();
        if (cachedSnapshot && cachedSnapshot.matchId === cachedMatch.matchId) {
          latestSnapshotRevision = Number(cachedSnapshot.revision) || -1;
          snapshot = cachedSnapshot.payload;
          reconcileBarrelEffects(snapshot);
          syncRemotePlayers();
          reconcilePrediction();
          updateView();
        } else if (cachedMatch.state !== "finished") {
          requestFreshSnapshot(cachedMatch.matchId);
        }
      }

      updateConnection(arcade.connectionStatus);
      startInputPump();
      animationFrame = requestAnimationFrame(animate);

      const cleanup = () => {
        if (destroyed) return;
        destroyed = true;
        stopMatch();
        stopSnapshot();
        stopEvent();
        stopResult();
        stopError();
        stopConnection();
        stopFullscreen();
        resizeObserver?.disconnect();
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("visibilitychange", onVisibility);
        window.clearTimeout(inputTimer);
        inputTimer = 0;
        window.clearTimeout(toastTimer);
        cancelAnimationFrame(animationFrame);
        clearControlState();
        remotePlayers.clear();
        predicted = null;
        snapshot = null;
        result = null;
        activeMatch = null;
        container.replaceChildren();
        if (mountedCleanup === cleanup) mountedCleanup = null;
      };
      mountedCleanup = cleanup;
      return cleanup;
    },
  };
})();

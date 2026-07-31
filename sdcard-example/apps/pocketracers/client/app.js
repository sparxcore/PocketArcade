"use strict";

(() => {
  const APP_ID = "pocketracers";
  const assetBase = new URL(".", document.currentScript.src);
  const iconUrl = new URL("../assets/icon.svg", assetBase).href;
  const startScreenUrl = new URL("../assets/start-screen.jpg", assetBase).href;
  const APP_VERSION = "1.2.0";
  const LAPS = 5;
  const INPUT_INTERVAL_MS = 75;
  const INPUT_HEARTBEAT_MS = 300;
  const MAX_EXTRAPOLATION_S = 0.12;
  const MAX_SKID_MARKS = 420;
  const SKID_LIFETIME_MS = 16000;
  const MAX_SMOKE_PARTICLES = 72;
  const SMOKE_LIFETIME_MS = 950;
  const SMOKE_MIN_INTERVAL_MS = 62;

  const TRACKS = [
    {
      name: "Sunset Oval",
      width: 184,
      description: "Fast, wide and forgiving.",
      points: [
        [-600,-250],[-350,-450],[0,-500],[350,-450],[600,-250],[650,0],
        [600,250],[350,450],[0,500],[-350,450],[-600,250],[-650,0]
      ]
    },
    {
      name: "Switchback Run",
      width: 172,
      description: "Flowing bends and a tight infield.",
      points: [
        [-650,-300],[-400,-480],[-80,-520],[220,-430],[520,-260],[650,20],
        [520,300],[220,480],[-100,520],[-380,400],[-560,180],[-300,80],
        [50,150],[260,40],[80,-120],[-260,-60],[-520,-130]
      ]
    },
    {
      name: "Clover Valley",
      width: 178,
      description: "Long arcs with rapid direction changes.",
      points: [
        [0,-560],[300,-500],[520,-300],[480,-40],[650,180],[500,440],
        [180,520],[0,350],[-180,520],[-500,440],[-650,180],[-480,-40],
        [-520,-300],[-300,-500]
      ]
    },
    {
      name: "Dockyard Dash",
      width: 154,
      description: "Narrow straights and hard corners.",
      points: [
        [-620,-420],[-100,-420],[-100,-200],[360,-200],[360,-420],[620,-420],
        [620,80],[420,80],[420,420],[-120,420],[-120,220],[-620,220]
      ]
    }
  ];

  const CARS = [
    {
      name: "Falcon GT",
      tagline: "High-speed grand tourer",
      stats: { speed: 5, acceleration: 3, handling: 3 },
      body: "#ef5350",
      trim: "#ffcbc8"
    },
    {
      name: "Bolt XR",
      tagline: "Explosive off the line",
      stats: { speed: 3, acceleration: 5, handling: 3 },
      body: "#f2c94c",
      trim: "#fff0a6"
    },
    {
      name: "Apex RS",
      tagline: "Technical corner specialist",
      stats: { speed: 3, acceleration: 3, handling: 5 },
      body: "#4f8cff",
      trim: "#c7d8ff"
    }
  ];

  const SEAT_COLOURS = ["#ef5d67", "#21b88c", "#f5b83d", "#8067ed"];

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

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function angleLerp(a, b, t) {
    let difference = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
    if (difference < -Math.PI) difference += Math.PI * 2;
    return a + difference * t;
  }

  function ordinal(value) {
    const number = Number(value) || 0;
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    if (number % 10 === 1) return `${number}st`;
    if (number % 10 === 2) return `${number}nd`;
    if (number % 10 === 3) return `${number}rd`;
    return `${number}th`;
  }

  function fitTrack(track, width, height, padding) {
    const xs = track.points.map((point) => point[0]);
    const ys = track.points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(
      (width - padding * 2) / Math.max(1, maxX - minX),
      (height - padding * 2) / Math.max(1, maxY - minY)
    );
    return {
      scale,
      offsetX: width / 2 - ((minX + maxX) / 2) * scale,
      offsetY: height / 2 - ((minY + maxY) / 2) * scale
    };
  }

  function traceTrack(context, track) {
    const points = track.points;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index][0], points[index][1]);
    }
    context.closePath();
  }

  function drawTrackPreview(canvas, track) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(120, Math.round(rect.width || 150));
    const height = Math.max(76, Math.round(rect.height || 90));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const fit = fitTrack(track, width, height, 13);
    context.save();
    context.translate(fit.offsetX, fit.offsetY);
    context.scale(fit.scale, fit.scale);
    context.lineJoin = "round";
    context.lineCap = "round";
    traceTrack(context, track);
    context.strokeStyle = "rgba(236,240,244,0.22)";
    context.lineWidth = track.width + 32;
    context.stroke();
    traceTrack(context, track);
    context.strokeStyle = "#555b62";
    context.lineWidth = track.width;
    context.stroke();
    traceTrack(context, track);
    context.strokeStyle = "rgba(255,255,255,0.32)";
    context.lineWidth = 6;
    context.setLineDash([22, 28]);
    context.stroke();
    context.restore();
  }

  function createAvatar(profile, seat, ownProfile) {
    const wrapper = element("div", "pr-avatar");
    const nickname = profile && profile.nickname ? String(profile.nickname) : `Player ${seat}`;
    const fallback = element("span", "pr-avatar-fallback", nickname.trim().charAt(0).toUpperCase() || "P");
    wrapper.append(fallback);
    let avatarUrl = profile && typeof profile.avatarUrl === "string" ? profile.avatarUrl : "";
    if (!avatarUrl && ownProfile && profile && profile.profileId === (ownProfile.profileId || ownProfile.id) &&
        typeof ownProfile.avatarUrl === "string") {
      avatarUrl = ownProfile.avatarUrl;
    }
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = `${nickname} profile avatar`;
      image.addEventListener("load", () => wrapper.dataset.loaded = "true", { once: true });
      image.addEventListener("error", () => image.remove(), { once: true });
      wrapper.append(image);
    }
    return wrapper;
  }

  function drawStatBars(container, stats) {
    for (const [label, value] of Object.entries(stats)) {
      const row = element("div", "pr-stat-row");
      row.append(element("span", "", label.charAt(0).toUpperCase() + label.slice(1)));
      const bars = element("span", "pr-stat-bars");
      for (let index = 1; index <= 5; index += 1) {
        const bar = element("i", "");
        if (index <= value) bar.dataset.on = "true";
        bars.append(bar);
      }
      row.append(bars);
      container.append(row);
    }
  }

  window.PocketArcadeApps = window.PocketArcadeApps || {};
  window.PocketArcadeApps[APP_ID] = {
    mount(container, arcade) {
      const cachedMatch = arcade.game.currentMatch();
      let matchState = cachedMatch && cachedMatch.you?.role !== "none" ? cachedMatch : null;
      const cachedSnapshot = arcade.game.currentSnapshot();
      let snapshotEnvelope = matchState && cachedSnapshot && cachedSnapshot.matchId === matchState.matchId
        ? cachedSnapshot
        : null;
      let resultEnvelope = null;
      let latestSnapshotRevision = snapshotEnvelope && Number.isFinite(snapshotEnvelope.revision)
        ? snapshotEnvelope.revision
        : -1;
      let snapshotReceivedAt = performance.now();
      let disposed = false;
      let joinPending = false;
      const stops = [];
      const retiredMatchIds = new Set();
      const retiredMatchOrder = [];
      const MAX_RETIRED_MATCHES = 8;
      const skidMarks = [];
      const smokeParticles = [];
      const lastWheels = new Map();
      let lastSmokeAt = 0;
      const visualCars = new Map();
      const activePointers = new Map();
      const selectionSentAt = new Map();
      const inputState = { left: false, right: false, throttle: false, brake: false };
      let inputTimer = null;
      let inputDirty = false;
      let lastInputSentAt = -INPUT_INTERVAL_MS;
      let lastInputHeartbeatAt = -INPUT_HEARTBEAT_MS;
      let animationFrame = 0;
      let lastFrameAt = performance.now();
      let fullscreenRequestPending = false;
      let fullscreenEntered = false;
      let fullscreenDismissed = false;
      let platformReadyRequestedForMatch = "";
      const camera = { x: 0, y: 0, zoom: 0.82, initialised: false };

      const root = element("section", "pocketracers");
      const topbar = element("div", "pr-topbar");
      const brand = element("div", "pr-brand");
      const icon = document.createElement("img");
      icon.className = "pr-icon";
      icon.src = iconUrl;
      icon.alt = "";
      brand.append(icon, element("div", "pr-title", "PocketRacers"));
      const status = element("div", "pr-status", "Choose Join to race.");
      status.setAttribute("aria-live", "polite");
      topbar.append(brand, status);

      const actions = element("div", "pr-actions");
      actions.setAttribute("aria-label", "Match actions");
      const joinButton = button("Join race", "pr-primary pr-join-button");
      const lobbyReadyButton = button("Ready to choose", "pr-primary");
      const readyButton = button("Ready to race", "pr-primary");
      const claimButton = button("Take control", "");
      const leaveButton = button("Leave", "pr-danger");
      const againButton = button("Race again", "pr-primary");
      actions.append(lobbyReadyButton, readyButton, claimButton, leaveButton, againButton);

      const splash = element("section", "pr-splash");
      const splashImage = document.createElement("img");
      splashImage.className = "pr-splash-art";
      splashImage.src = startScreenUrl;
      splashImage.alt = "PocketRacers neon circuit with three arcade racing cars";
      splashImage.decoding = "async";
      const splashActions = element("div", "pr-splash-actions");
      const splashMeta = element("div", "pr-splash-meta");
      splashMeta.append(
        element("span", "pr-meta-chip", `v${APP_VERSION}`),
        element("span", "pr-meta-chip", "2–4 players")
      );
      splashActions.append(splashMeta, joinButton);
      splash.append(splashImage, splashActions);

      const selection = element("section", "pr-selection");
      const joinSection = element("div", "pr-selection-group pr-join-stage");
      joinSection.append(
        element("h2", "pr-section-title", "Join the starting grid"),
        element("p", "pr-stage-copy", "Wait for every racer to join, then each player presses Ready to choose.")
      );
      const carSection = element("div", "pr-selection-group");
      carSection.append(element("h2", "pr-section-title", "Choose your car"));
      const carChoices = element("div", "pr-car-choices");
      carSection.append(carChoices);
      const trackSection = element("div", "pr-selection-group");
      const trackTitle = element("div", "pr-selection-heading");
      trackTitle.append(
        element("h2", "pr-section-title", "Vote for a track"),
        element("span", "pr-selection-note", "Every vote is shown. Most votes wins; ties favour the lowest-numbered track.")
      );
      const trackChoices = element("div", "pr-track-choices");
      trackSection.append(trackTitle, trackChoices);
      const confirmSection = element("div", "pr-selection-group pr-confirm-stage");
      confirmSection.append(
        element("h2", "pr-section-title", "Confirm the grid"),
        element("p", "pr-stage-copy", "Check the selected cars below. Every racer must press Ready to race before fullscreen play begins.")
      );
      selection.append(joinSection, carSection, trackSection, confirmSection);

      const lobbyPlayersPanel = element("section", "pr-lobby-players");
      lobbyPlayersPanel.append(element("h2", "pr-section-title", "Starting grid"));
      const playersList = element("div", "pr-players");
      lobbyPlayersPanel.append(playersList);
      const lobbyLayout = element("div", "pr-lobby-layout");
      lobbyLayout.append(lobbyPlayersPanel, selection);

      const raceLayout = element("div", "pr-race-layout");
      const stage = element("div", "pr-stage");
      const canvas = element("canvas", "pr-canvas");
      canvas.setAttribute("aria-label", "Top-down PocketRacers track view");
      const overlay = element("div", "pr-overlay");
      const positionText = element("div", "pr-position", "—");
      const lapText = element("div", "pr-lap", `Lap 1/${LAPS}`);
      const speedText = element("div", "pr-speed", "0");
      const trackNameText = element("div", "pr-track-hud", "Waiting for selection");
      const countdownText = element("div", "pr-countdown", "");
      overlay.append(positionText, lapText, speedText, trackNameText, countdownText);
      const standings = element("div", "pr-race-standings");
      const raceSpectators = element("div", "pr-race-spectators");
      stage.append(canvas, overlay, standings, raceSpectators);
      raceLayout.append(stage);

      const controls = element("div", "pr-controls");
      const leftButton = button("◀", "pr-control");
      const rightButton = button("▶", "pr-control");
      const throttleButton = button("ACCEL", "pr-control pr-throttle");
      const brakeButton = button("BRAKE", "pr-control pr-brake");
      leftButton.setAttribute("aria-label", "Steer left");
      rightButton.setAttribute("aria-label", "Steer right");
      throttleButton.setAttribute("aria-label", "Accelerate");
      brakeButton.setAttribute("aria-label", "Brake or reverse");
      controls.append(throttleButton, brakeButton, leftButton, rightButton);

      const help = element(
        "div",
        "pr-help",
        "Keyboard: arrows or A/D steer, W/Up accelerates, S/Down brakes. One controller tab drives each profile."
      );
      root.append(splash, topbar, lobbyLayout, raceLayout, controls, actions, help);
      container.replaceChildren(root);

      const carButtons = [];
      CARS.forEach((car, index) => {
        const choice = button("", "pr-car-choice");
        choice.dataset.car = String(index + 1);
        const visual = element("div", "pr-car-swatch");
        visual.style.setProperty("--car-body", car.body);
        visual.style.setProperty("--car-trim", car.trim);
        const details = element("div", "pr-car-details");
        details.append(
          element("div", "pr-choice-name", car.name),
          element("div", "pr-choice-description", car.tagline)
        );
        const stats = element("div", "pr-stats");
        drawStatBars(stats, car.stats);
        choice.append(visual, details, stats);
        carChoices.append(choice);
        carButtons.push(choice);
      });

      const trackButtons = [];
      TRACKS.forEach((track, index) => {
        const choice = button("", "pr-track-choice");
        choice.dataset.track = String(index + 1);
        const preview = element("canvas", "pr-track-preview");
        preview.setAttribute("aria-label", `${track.name} track preview`);
        const votes = element("div", "pr-track-votes");
        choice.append(
          preview,
          element("div", "pr-choice-name", track.name),
          element("div", "pr-choice-description", track.description),
          votes
        );
        trackChoices.append(choice);
        trackButtons.push(choice);
        choice.voteNode = votes;
        requestAnimationFrame(() => drawTrackPreview(preview, track));
      });

      function payload() {
        return snapshotEnvelope && snapshotEnvelope.payload && typeof snapshotEnvelope.payload === "object"
          ? snapshotEnvelope.payload
          : null;
      }

      function ownSeat() {
        return matchState && matchState.you?.role === "player" ? matchState.you.seat : null;
      }

      function cars() {
        const state = payload();
        return state && Array.isArray(state.cars) ? state.cars : [];
      }

      function carBySeat(seat) {
        return cars().find((car) => car.seat === seat) || null;
      }

      function ownCar() {
        return carBySeat(ownSeat());
      }

      function seatProfile(seatNumber) {
        if (!matchState || !Array.isArray(matchState.seats)) return null;
        const seat = matchState.seats.find((entry) => entry.seat === seatNumber);
        return seat && seat.player ? seat.player : null;
      }

      function isFinished() {
        return Boolean(resultEnvelope || matchState?.state === "finished" || payload()?.phase === "finished");
      }

      function canUseLobbyPhase(expectedPhase) {
        return Boolean(matchState && matchState.state === "waiting" &&
          matchState.you?.role === "player" && matchState.you.controller &&
          (payload()?.phase || "join") === expectedPhase);
      }

      function hasDrivingSeat() {
        return Boolean(
          matchState && matchState.you?.role === "player" && matchState.you.controller &&
          !isFinished() && !ownCar()?.finished
        );
      }

      function shouldShowControls() {
        if (!hasDrivingSeat()) return false;
        const phase = payload()?.phase;
        // Keep the controls mounted across delayed or transitional snapshots.
        // The platform lifecycle is sufficient to show them, while a racing
        // snapshot also prevents a brief stale lifecycle update hiding the UI.
        return phase === "arming" || matchState.state === "playing" ||
          phase === "countdown" || phase === "racing";
      }

      function canDrive() {
        // Command authority belongs to the platform match/controller state.
        // The Lua server independently ignores input outside countdown/racing,
        // so client input must not disappear merely because one snapshot is late.
        return hasDrivingSeat() && matchState.state === "playing";
      }

      function setStatus(message, kind) {
        status.textContent = message;
        status.dataset.state = kind || "";
      }

      function retireMatch(matchId) {
        if (!matchId || retiredMatchIds.has(matchId)) return;
        retiredMatchIds.add(matchId);
        retiredMatchOrder.push(matchId);
        while (retiredMatchOrder.length > MAX_RETIRED_MATCHES) {
          retiredMatchIds.delete(retiredMatchOrder.shift());
        }
      }

      function resetVisualState() {
        skidMarks.length = 0;
        smokeParticles.length = 0;
        lastWheels.clear();
        lastSmokeAt = 0;
        visualCars.clear();
        camera.initialised = false;
      }

      function clearInput(sendRelease) {
        inputState.left = false;
        inputState.right = false;
        inputState.throttle = false;
        inputState.brake = false;
        inputDirty = false;
        activePointers.clear();
        if (inputTimer !== null) {
          clearTimeout(inputTimer);
          inputTimer = null;
        }
        for (const control of [leftButton, rightButton, throttleButton, brakeButton]) {
          control.dataset.active = "false";
        }
        if (sendRelease && matchState?.matchId && matchState.you?.controller) {
          arcade.game.send(matchState.matchId, "release-input", {});
        }
      }

      function clearMatchState(retireCurrent) {
        if (retireCurrent && matchState?.matchId) retireMatch(matchState.matchId);
        clearInput(false);
        matchState = null;
        snapshotEnvelope = null;
        resultEnvelope = null;
        latestSnapshotRevision = -1;
        joinPending = false;
        platformReadyRequestedForMatch = "";
        resetVisualState();
      }

      function currentInputPayload() {
        return {
          steer: (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0),
          throttle: inputState.throttle,
          brake: inputState.brake
        };
      }

      function inputPump() {
        inputTimer = null;
        if (!canDrive() || disposed || document.hidden) {
          clearInput(false);
          return;
        }
        const now = performance.now();
        const dueChange = inputDirty && now - lastInputSentAt >= INPUT_INTERVAL_MS;
        const dueHeartbeat = now - lastInputHeartbeatAt >= INPUT_HEARTBEAT_MS;
        if (dueChange || dueHeartbeat) {
          if (arcade.game.send(matchState.matchId, "input", currentInputPayload())) {
            lastInputSentAt = now;
            lastInputHeartbeatAt = now;
            inputDirty = false;
          }
        }
        const delay = inputDirty
          ? Math.max(10, INPUT_INTERVAL_MS - (performance.now() - lastInputSentAt))
          : Math.max(25, INPUT_HEARTBEAT_MS - (performance.now() - lastInputHeartbeatAt));
        inputTimer = window.setTimeout(inputPump, delay);
      }

      function scheduleInput() {
        inputDirty = true;
        if (inputTimer === null && canDrive()) inputTimer = window.setTimeout(inputPump, 0);
      }

      function setInput(name, active) {
        if (inputState[name] === active) return;
        inputState[name] = active;
        scheduleInput();
      }

      function bindHold(control, inputName) {
        const down = (event) => {
          if (!canDrive() || activePointers.has(event.pointerId)) return;
          event.preventDefault();
          activePointers.set(event.pointerId, inputName);
          try { control.setPointerCapture(event.pointerId); } catch (_) { /* unsupported */ }
          control.dataset.active = "true";
          setInput(inputName, true);
        };
        const up = (event) => {
          if (activePointers.get(event.pointerId) !== inputName) return;
          event.preventDefault();
          activePointers.delete(event.pointerId);
          control.dataset.active = "false";
          setInput(inputName, false);
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
        bindHold(leftButton, "left"),
        bindHold(rightButton, "right"),
        bindHold(throttleButton, "throttle"),
        bindHold(brakeButton, "brake")
      ];

      function sendSelection(action, data, key, expectedPhase) {
        if (!canUseLobbyPhase(expectedPhase)) return;
        const now = performance.now();
        const previous = selectionSentAt.get(key) || -1000;
        if (now - previous < 180) return;
        selectionSentAt.set(key, now);
        if (!arcade.game.send(matchState.matchId, action, data)) {
          setStatus("Unable to update selection.", "error");
        }
      }

      carButtons.forEach((choice, index) => {
        choice.addEventListener("click", () => sendSelection("select-car", { car: index + 1 }, `car-${index}`, "car-select"));
      });
      trackButtons.forEach((choice, index) => {
        choice.addEventListener("click", () => sendSelection("select-track", { track: index + 1 }, `track-${index}`, "track-vote"));
      });

      function profileName(profile, seat) {
        return profile?.nickname ? String(profile.nickname) : `Player ${seat}`;
      }

      function renderPlayers() {
        playersList.replaceChildren();
        const gameCars = cars();
        const phase = payload()?.phase || "join";
        const localSeat = ownSeat();
        const seats = [...(matchState?.seats || [])].sort((a, b) => {
          if (a.seat === localSeat) return -1;
          if (b.seat === localSeat) return 1;
          return a.seat - b.seat;
        });

        for (const seat of seats) {
          const seatColour = SEAT_COLOURS[(seat.seat - 1) % SEAT_COLOURS.length];
          if (!seat.player) {
            if (matchState?.state !== "waiting") continue;
            const item = element("div", "pr-player is-open");
            item.style.setProperty("--seat-colour", seatColour);
            const openAvatar = element("div", "pr-avatar pr-avatar-open", String(seat.seat));
            const info = element("div", "pr-player-info");
            info.append(
              element("div", "pr-player-name", "Open Seat"),
              element("div", "pr-player-meta", "Waiting for racer")
            );
            item.append(openAvatar, info);
            playersList.append(item);
            continue;
          }

          const car = gameCars.find((entry) => entry.seat === seat.seat);
          const item = element("div", "pr-player");
          item.style.setProperty("--seat-colour", seatColour);
          if (seat.seat === localSeat) item.dataset.self = "true";
          item.append(createAvatar(seat.player, seat.seat, arcade.profile));
          const info = element("div", "pr-player-info");
          const name = element("div", "pr-player-name", profileName(seat.player, seat.seat));
          let meta = "Joined";
          if (phase === "join") {
            meta = car?.lobbyReady ? "Ready to choose ✓" : "Waiting to choose";
          } else if (phase === "car-select") {
            if (seat.seat === localSeat && car?.carSelected) {
              meta = `Selected ${CARS[(car.car || 1) - 1]?.name || "a car"}`;
            } else {
              meta = car?.carSelected ? "Car selected ✓" : "Choosing car…";
            }
          } else if (phase === "track-vote") {
            meta = car?.trackVoted
              ? `Voted: ${TRACKS[(car.trackVote || 1) - 1]?.name || "Track"}`
              : "Choosing track…";
          } else if (phase === "confirm" || phase === "arming") {
            const model = CARS[(car?.car || 1) - 1] || CARS[0];
            meta = `${car?.raceReady ? "Ready to race ✓" : "Waiting for final Ready"} · ${model.name}`;
          } else if (car?.finished) {
            meta = `${ordinal(car.place)} · Finished · ${car.points || 0} pts`;
          } else {
            meta = `${ordinal(car?.place || seat.seat)} · Lap ${car?.lap || 1}/${LAPS}${car?.offTrack ? " · Off track" : ""}`;
          }
          info.append(name, element("div", "pr-player-meta", meta));
          const chip = element("span", "pr-seat-chip", String(seat.seat));
          item.append(info, chip);
          playersList.append(item);
        }

        for (const spectator of matchState?.spectators || []) {
          const item = element("div", "pr-player is-spectator");
          item.append(createAvatar(spectator, "S", arcade.profile));
          const info = element("div", "pr-player-info");
          info.append(element("div", "pr-player-name", profileName(spectator, "S")));
          item.append(info);
          playersList.append(item);
        }

        if (!playersList.children.length) {
          playersList.append(element("div", "pr-player-meta", "Waiting for racers…"));
        }
      }

      function renderRaceSpectators() {
        raceSpectators.replaceChildren();
        for (const spectator of matchState?.spectators || []) {
          const pill = element("div", "pr-spectator-pill");
          pill.append(createAvatar(spectator, "S", arcade.profile));
          pill.append(element("span", "pr-spectator-name", profileName(spectator, "S")));
          raceSpectators.append(pill);
        }
        raceSpectators.classList.toggle("pr-hidden", !raceSpectators.children.length);
      }

      function renderStandings() {
        standings.replaceChildren();
        const ranked = [...cars()].sort((a, b) => (a.place || 99) - (b.place || 99));
        for (const car of ranked) {
          const profile = seatProfile(car.seat);
          const row = element("div", "pr-standing-row");
          if (car.seat === ownSeat()) row.dataset.self = "true";
          const place = element("span", "pr-standing-place", String(car.place || "–"));
          place.style.setProperty("--seat-colour", SEAT_COLOURS[(car.seat - 1) % SEAT_COLOURS.length]);
          const label = element("span", "pr-standing-name", profileName(profile, car.seat));
          const lap = element("span", "pr-standing-lap", car.finished ? "FIN" : `L${car.lap || 1}`);
          row.append(place, label, lap);
          standings.append(row);
        }
      }

      function renderSelection() {
        const state = payload();
        const phase = state?.phase || "join";
        const me = ownCar();
        const selectedCar = me?.carSelected ? me.car : 0;
        const selectedTrack = me?.trackVoted ? me.trackVote : 0;
        joinSection.classList.toggle("pr-hidden", phase !== "join");
        carSection.classList.toggle("pr-hidden", phase !== "car-select");
        trackSection.classList.toggle("pr-hidden", phase !== "track-vote");
        confirmSection.classList.toggle("pr-hidden", phase !== "confirm" && phase !== "arming");
        const carSelectable = canUseLobbyPhase("car-select");
        const trackSelectable = canUseLobbyPhase("track-vote");
        carButtons.forEach((choice, index) => {
          choice.dataset.selected = String(index + 1 === selectedCar);
          choice.disabled = !carSelectable;
        });
        trackButtons.forEach((choice, index) => {
          choice.dataset.selected = String(index + 1 === selectedTrack);
          choice.disabled = !trackSelectable;
          choice.voteNode.replaceChildren();
          for (const car of cars()) {
            if (!car.trackVoted || car.trackVote !== index + 1) continue;
            const profile = seatProfile(car.seat);
            const vote = element("span", "pr-track-voter", profileName(profile, car.seat).charAt(0).toUpperCase());
            vote.title = `${profileName(profile, car.seat)} voted for ${TRACKS[index].name}`;
            vote.style.setProperty("--seat-colour", SEAT_COLOURS[(car.seat - 1) % SEAT_COLOURS.length]);
            choice.voteNode.append(vote);
          }
        });
      }

      function winnerSummary() {
        const raceCars = [...cars()].sort((a, b) => (a.place || 99) - (b.place || 99));
        const winner = raceCars.find((car) => car.place === 1);
        if (!winner) return "Race finished";
        return `${profileName(seatProfile(winner.seat), winner.seat)} wins · ${winner.points || 0} points`;
      }

      function syncFullscreen(activeRace) {
        if (!arcade.display) return;
        if (activeRace) {
          if (!arcade.display.fullscreen && !fullscreenRequestPending && !fullscreenDismissed) {
            fullscreenRequestPending = Boolean(arcade.display.requestFullscreen());
          }
        } else {
          fullscreenRequestPending = false;
          fullscreenEntered = false;
          fullscreenDismissed = false;
          if (arcade.display.fullscreen) arcade.display.exitFullscreen();
        }
        root.classList.toggle("fullscreen", Boolean(arcade.display.fullscreen));
      }

      function renderUi() {
        const state = payload();
        const role = matchState?.you?.role || "none";
        const platformState = matchState?.state || "none";
        const phase = state?.phase || "join";
        const controller = Boolean(matchState?.you?.controller);
        const finished = isFinished();
        const own = ownCar();
        // Enter fullscreen as soon as every racer has completed the second
        // confirmation. The Lua `arming` phase is the first authoritative point
        // where that is true, and it occurs before the platform Ready transition.
        // Keeping arming fullscreen also avoids a brief embedded flash while the
        // firmware changes the match lifecycle from waiting to playing.
        const racePresentation = Boolean(matchState && !finished &&
          (phase === "arming" || phase === "countdown" || phase === "racing"));
        const activeRace = Boolean(matchState && !finished && platformState === "playing" &&
          (phase === "countdown" || phase === "racing"));

        syncFullscreen(racePresentation);
        root.classList.toggle("is-start", !matchState);
        root.classList.toggle("is-lobby", Boolean(matchState && !racePresentation && !finished));
        root.classList.toggle("is-race-presentation", racePresentation);
        root.classList.toggle("is-finished", finished);
        root.classList.toggle("is-spectator", role === "spectator");
        splash.classList.toggle("pr-hidden", Boolean(matchState));
        topbar.classList.toggle("pr-hidden", !matchState || racePresentation);
        actions.classList.toggle("pr-hidden", !matchState || racePresentation);
        joinButton.disabled = joinPending || arcade.connectionStatus !== "connected";
        joinButton.textContent = joinPending ? "Joining…" : "Join race";
        lobbyReadyButton.classList.toggle("pr-hidden", !matchState || role !== "player" ||
          platformState !== "waiting" || phase !== "join");
        readyButton.classList.toggle("pr-hidden", !matchState || role !== "player" ||
          platformState !== "waiting" || phase !== "confirm");
        claimButton.classList.toggle("pr-hidden", !matchState || role !== "player" || controller || finished);
        leaveButton.classList.toggle("pr-hidden", !matchState || finished);
        againButton.classList.toggle("pr-hidden", !finished);
        lobbyLayout.classList.toggle("pr-hidden", !matchState || racePresentation || finished);
        selection.classList.toggle("pr-hidden", !matchState || role !== "player" || platformState !== "waiting");
        lobbyPlayersPanel.classList.toggle("pr-hidden", !matchState || racePresentation || finished);
        raceLayout.classList.toggle("pr-hidden", !racePresentation && !finished);
        controls.classList.toggle("pr-hidden", !shouldShowControls());
        help.classList.toggle("pr-hidden", !matchState || racePresentation || finished);
        const drivingEnabled = canDrive();
        root.classList.toggle("can-drive", drivingEnabled);
        throttleButton.disabled = !drivingEnabled;
        brakeButton.disabled = !drivingEnabled;
        leftButton.disabled = !drivingEnabled;
        rightButton.disabled = !drivingEnabled;

        const occupied = matchState?.seats?.filter((seat) => seat.player).length || 0;
        const ownMatchSeat = matchState?.seats?.find((seat) => seat.seat === ownSeat());
        lobbyReadyButton.disabled = Boolean(own?.lobbyReady || occupied < 2);
        lobbyReadyButton.textContent = own?.lobbyReady ? "Ready to choose ✓" : "Ready to choose";
        readyButton.disabled = Boolean(own?.raceReady);
        readyButton.textContent = own?.raceReady ? "Ready to race ✓" : "Ready to race";
        if (phase === "arming" && platformState === "waiting" && role === "player" && controller &&
            !ownMatchSeat?.ready && platformReadyRequestedForMatch !== matchState.matchId) {
          if (arcade.game.ready(matchState.matchId)) {
            platformReadyRequestedForMatch = matchState.matchId;
          }
        }

        if (!matchState) {
          setStatus(arcade.connectionStatus === "connected" ? "Choose Join to race." : "Reconnecting…", "");
        } else if (finished) {
          setStatus(winnerSummary(), "ok");
        } else if (role === "spectator") {
          setStatus(activeRace ? "Spectating race" : "Waiting for the race", "");
        } else if (!controller) {
          setStatus("This tab is observing your car", "");
        } else if (platformState === "waiting") {
          if (phase === "join") {
            setStatus(occupied < 2 ? "Waiting for another racer…" : "Everyone presses Ready to choose", "");
          } else if (phase === "car-select") {
            setStatus(own?.carSelected ? "Waiting for the other car choices…" : "Choose your car", "");
          } else if (phase === "track-vote") {
            setStatus(own?.trackVoted ? "Waiting for the remaining votes…" : "Vote for a circuit", "");
          } else if (phase === "confirm") {
            setStatus(own?.raceReady ? "Waiting for final confirmations…" : "Confirm your car and press Ready to race", "");
          } else if (phase === "arming") {
            setStatus("All racers confirmed — preparing fullscreen…", "ok");
          } else {
            setStatus("Preparing lobby…", "");
          }
        } else if (phase === "countdown") {
          setStatus("Race starting", "ok");
        } else if (phase === "racing") {
          setStatus(own?.offTrack ? "Off track — reduced grip and speed" : "Race in progress", own?.offTrack ? "warn" : "ok");
        } else {
          setStatus("Preparing grid…", "");
        }

        const track = TRACKS[(state?.trackId || 1) - 1];
        trackNameText.textContent = state?.trackId ? track.name : "Waiting for selection";
        positionText.textContent = own?.place ? ordinal(own.place) : "—";
        lapText.textContent = `Lap ${own?.lap || 1}/${state?.laps || LAPS}`;
        const speed = own ? Math.sqrt((own.vx || 0) ** 2 + (own.vy || 0) ** 2) : 0;
        speedText.textContent = `${Math.round(speed)} km/h`;
        countdownText.textContent = phase === "countdown"
          ? String(Math.max(1, Math.ceil((state?.countdownMs || 0) / 1000)))
          : "";
        renderSelection();
        renderPlayers();
        renderStandings();
        renderRaceSpectators();
      }

      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(300, Math.round(rect.width));
        const height = Math.max(280, Math.round(rect.height));
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        return { width, height, dpr };
      }

      function smoothedCars(now, deltaSeconds) {
        const authoritative = cars();
        const activeSeats = new Set();
        const output = [];
        const ageSeconds = clamp((now - snapshotReceivedAt) / 1000, 0, MAX_EXTRAPOLATION_S);
        for (const car of authoritative) {
          activeSeats.add(car.seat);
          const targetX = (car.x || 0) + (car.vx || 0) * ageSeconds;
          const targetY = (car.y || 0) + (car.vy || 0) * ageSeconds;
          const targetHeading = (car.heading || 0) + (car.yaw || 0) * ageSeconds;
          let visual = visualCars.get(car.seat);
          if (!visual) {
            visual = { ...car, x: targetX, y: targetY, heading: targetHeading };
            visualCars.set(car.seat, visual);
          } else {
            visual.x += (visual.vx || 0) * deltaSeconds;
            visual.y += (visual.vy || 0) * deltaSeconds;
            visual.heading = angleLerp(visual.heading || 0,
              (visual.heading || 0) + (visual.yaw || 0) * deltaSeconds, 1);
            const error = Math.hypot(targetX - visual.x, targetY - visual.y);
            if (error > 150 || car.finished !== visual.finished) {
              visual.x = targetX;
              visual.y = targetY;
              visual.heading = targetHeading;
            } else {
              const response = car.seat === ownSeat() ? 8.5 : 6.5;
              const correction = 1 - Math.exp(-response * deltaSeconds);
              visual.x = lerp(visual.x, targetX, correction);
              visual.y = lerp(visual.y, targetY, correction);
              visual.heading = angleLerp(visual.heading || 0, targetHeading, correction);
            }
            const velocityResponse = 1 - Math.exp(-10 * deltaSeconds);
            visual.vx = lerp(visual.vx || 0, car.vx || 0, velocityResponse);
            visual.vy = lerp(visual.vy || 0, car.vy || 0, velocityResponse);
            visual.yaw = lerp(visual.yaw || 0, car.yaw || 0, velocityResponse);
            visual.roll = lerp(visual.roll || 0, car.roll || 0, velocityResponse);
            visual.skid = lerp(visual.skid || 0, car.skid || 0, velocityResponse);
            for (const key of ["seat", "car", "trackVote", "connected", "lap", "progress", "place",
              "offTrack", "finished", "finishTimeMs", "points"]) {
              visual[key] = car[key];
            }
          }
          output.push(visual);
        }
        for (const seat of visualCars.keys()) {
          if (!activeSeats.has(seat)) visualCars.delete(seat);
        }
        return output;
      }

      function focusCar(raceCars) {
        const own = raceCars.find((car) => car.seat === ownSeat());
        if (own) return own;
        return [...raceCars].sort((a, b) => (a.place || 99) - (b.place || 99))[0] || null;
      }

      function drawStartLine(context, track) {
        const a = track.points[0];
        const b = track.points[1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.hypot(dx, dy) || 1;
        const nx = -dy / length;
        const ny = dx / length;
        const rows = 8;
        const size = track.width / rows;
        for (let index = 0; index < rows; index += 1) {
          context.fillStyle = index % 2 ? "#1e2227" : "#f1f3f5";
          context.beginPath();
          context.arc(a[0] + nx * (-track.width / 2 + size * (index + 0.5)),
            a[1] + ny * (-track.width / 2 + size * (index + 0.5)), size * 0.48, 0, Math.PI * 2);
          context.fill();
        }
      }

      function drawTrack(context, track) {
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        traceTrack(context, track);
        context.strokeStyle = "rgba(15,18,20,0.72)";
        context.lineWidth = track.width + 44;
        context.stroke();
        traceTrack(context, track);
        context.strokeStyle = "#d8dadd";
        context.lineWidth = track.width + 22;
        context.stroke();
        traceTrack(context, track);
        context.strokeStyle = "#4d5359";
        context.lineWidth = track.width;
        context.stroke();
        traceTrack(context, track);
        context.strokeStyle = "rgba(255,255,255,0.16)";
        context.lineWidth = 3;
        context.setLineDash([28, 34]);
        context.stroke();
        context.setLineDash([]);
        drawStartLine(context, track);
        context.restore();
      }

      function wheelPositions(car) {
        const cos = Math.cos(car.heading || 0);
        const sin = Math.sin(car.heading || 0);
        const rightX = -sin;
        const rightY = cos;
        const rearX = (car.x || 0) - cos * 18;
        const rearY = (car.y || 0) - sin * 18;
        return [
          { x: rearX + rightX * 12, y: rearY + rightY * 12 },
          { x: rearX - rightX * 12, y: rearY - rightY * 12 }
        ];
      }

      function updateSkidMarks(raceCars, now) {
        const localSeat = ownSeat();
        for (const car of raceCars) {
          if (car.seat !== localSeat) continue;
          const wheels = wheelPositions(car);
          const previous = lastWheels.get(car.seat);
          const speed = Math.hypot(car.vx || 0, car.vy || 0);
          // Rubber marks are laid only on the road. Off-road slip produces dust
          // instead, which avoids black lines floating across the grass.
          if (previous && !car.offTrack && car.skid > 0.31 && speed > 48 &&
              now - previous.time >= 34) {
            for (let index = 0; index < 2; index += 1) {
              const distance = Math.hypot(wheels[index].x - previous.wheels[index].x,
                wheels[index].y - previous.wheels[index].y);
              if (distance >= 1.5 && distance < 34) {
                skidMarks.push({
                  x1: previous.wheels[index].x,
                  y1: previous.wheels[index].y,
                  x2: wheels[index].x,
                  y2: wheels[index].y,
                  born: now,
                  strength: clamp((car.skid - 0.18) / 0.82, 0.2, 1)
                });
              }
            }
          }
          lastWheels.set(car.seat, { wheels, time: now });
        }
        while (skidMarks.length > MAX_SKID_MARKS ||
          (skidMarks.length && now - skidMarks[0].born > SKID_LIFETIME_MS)) {
          skidMarks.shift();
        }
      }

      function updateSmoke(car, now) {
        while (smokeParticles.length && now - smokeParticles[0].born > SMOKE_LIFETIME_MS) {
          smokeParticles.shift();
        }
        if (!car || car.finished || car.seat !== ownSeat()) return;
        const speed = Math.hypot(car.vx || 0, car.vy || 0);
        const tyreSmoke = !car.offTrack
          ? clamp(((car.skid || 0) - 0.38) / 0.62, 0, 1) * clamp(speed / 105, 0, 1)
          : 0;
        const dust = car.offTrack
          ? clamp(speed / 125, 0, 1) * (0.28 + clamp((car.skid || 0) * 0.45, 0, 0.45))
          : 0;
        const strength = Math.max(tyreSmoke, dust);
        if (strength < 0.12 || now - lastSmokeAt < SMOKE_MIN_INTERVAL_MS / Math.max(0.55, strength)) {
          return;
        }
        lastSmokeAt = now;
        const wheels = wheelPositions(car);
        const cos = Math.cos(car.heading || 0);
        const sin = Math.sin(car.heading || 0);
        const count = strength > 0.62 ? 2 : 1;
        for (let index = 0; index < count; index += 1) {
          const wheel = wheels[(smokeParticles.length + index) % 2];
          smokeParticles.push({
            x: wheel.x - cos * 3,
            y: wheel.y - sin * 3,
            vx: (car.vx || 0) * 0.055 - cos * (5 + Math.random() * 4) + (Math.random() - 0.5) * 8,
            vy: (car.vy || 0) * 0.055 - sin * (5 + Math.random() * 4) + (Math.random() - 0.5) * 8,
            born: now,
            size: 5 + strength * 5 + Math.random() * 3,
            strength,
            dust: car.offTrack
          });
        }
        while (smokeParticles.length > MAX_SMOKE_PARTICLES) smokeParticles.shift();
      }

      function drawSkidMarks(context, now) {
        context.save();
        context.lineCap = "round";
        context.lineWidth = 3.2;
        for (const mark of skidMarks) {
          const age = clamp((now - mark.born) / SKID_LIFETIME_MS, 0, 1);
          context.strokeStyle = `rgba(17,19,21,${(1 - age) * 0.52 * mark.strength})`;
          context.beginPath();
          context.moveTo(mark.x1, mark.y1);
          context.lineTo(mark.x2, mark.y2);
          context.stroke();
        }
        context.restore();
      }

      function drawSmoke(context, now) {
        context.save();
        for (const particle of smokeParticles) {
          const age = clamp((now - particle.born) / SMOKE_LIFETIME_MS, 0, 1);
          const ageSeconds = (now - particle.born) / 1000;
          const alpha = (1 - age) * (1 - age) * 0.24 * particle.strength;
          const x = particle.x + particle.vx * ageSeconds;
          const y = particle.y + particle.vy * ageSeconds;
          const radius = particle.size * (1 + age * 1.45);
          context.fillStyle = particle.dust
            ? `rgba(178,153,112,${alpha * 0.9})`
            : `rgba(220,224,226,${alpha})`;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      function drawCar(context, car) {
        const model = CARS[(car.car || 1) - 1] || CARS[0];
        const seatColour = SEAT_COLOURS[((car.seat || 1) - 1) % SEAT_COLOURS.length];
        const velocityAngle = Math.atan2(car.vy || 0, car.vx || 0);
        let slip = velocityAngle - (car.heading || 0);
        while (slip > Math.PI) slip -= Math.PI * 2;
        while (slip < -Math.PI) slip += Math.PI * 2;
        if (Math.hypot(car.vx || 0, car.vy || 0) < 20) slip = 0;
        const visualYaw = clamp(slip * 0.22, -0.18, 0.18);
        const roll = clamp(car.roll || 0, -0.7, 0.7);
        const steeringVisual = clamp((car.yaw || 0) * 0.22, -0.38, 0.38);

        context.save();
        context.translate(car.x || 0, car.y || 0);
        context.rotate(car.heading || 0);

        context.save();
        context.translate(-3, 5 + roll * 7);
        context.rotate(visualYaw * 0.35);
        context.fillStyle = "rgba(0,0,0,0.34)";
        context.beginPath();
        context.ellipse(0, 0, 31, 18 - Math.abs(roll) * 2, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();

        const drawWheel = (x, y, steer) => {
          context.save();
          context.translate(x, y);
          context.rotate(steer);
          context.fillStyle = "#101214";
          context.fillRect(-7, -4, 14, 8);
          context.fillStyle = "#6b7075";
          context.fillRect(-4, -2, 8, 4);
          context.restore();
        };
        drawWheel(17, -14, steeringVisual);
        drawWheel(17, 14, steeringVisual);
        drawWheel(-17, -14, 0);
        drawWheel(-17, 14, 0);

        context.save();
        context.translate(0, roll * 6);
        context.rotate(visualYaw);
        context.transform(1, roll * 0.035, 0, 1 - Math.abs(roll) * 0.035, 0, 0);

        context.fillStyle = model.body;
        context.strokeStyle = "rgba(255,255,255,0.24)";
        context.lineWidth = 1.5;
        context.beginPath();
        if (car.car === 1) {
          context.moveTo(29, 0); context.lineTo(19, -13); context.lineTo(-21, -14);
          context.lineTo(-29, -9); context.lineTo(-29, 9); context.lineTo(-21, 14);
          context.lineTo(19, 13); context.closePath();
        } else if (car.car === 2) {
          context.moveTo(25, 0); context.lineTo(16, -15); context.lineTo(-18, -16);
          context.lineTo(-27, -10); context.lineTo(-27, 10); context.lineTo(-18, 16);
          context.lineTo(16, 15); context.closePath();
        } else {
          context.moveTo(27, 0); context.lineTo(17, -16); context.lineTo(-20, -17);
          context.lineTo(-30, -11); context.lineTo(-30, 11); context.lineTo(-20, 17);
          context.lineTo(17, 16); context.closePath();
        }
        context.fill();
        context.stroke();

        context.fillStyle = model.trim;
        context.beginPath();
        context.moveTo(12, -10); context.lineTo(5, -11); context.lineTo(-9, -10);
        context.lineTo(-13, -5); context.lineTo(-13, 5); context.lineTo(-9, 10);
        context.lineTo(5, 11); context.lineTo(12, 10); context.closePath();
        context.fill();

        context.fillStyle = "#1b2a38";
        context.beginPath();
        context.moveTo(10, -8); context.lineTo(4, -9); context.lineTo(-4, -8);
        context.lineTo(-4, 8); context.lineTo(4, 9); context.lineTo(10, 8); context.closePath();
        context.fill();

        context.fillStyle = seatColour;
        context.fillRect(-18, -2.5, 38, 5);
        context.fillStyle = "rgba(255,255,255,0.55)";
        context.fillRect(17, -9, 5, 4);
        context.fillRect(17, 5, 5, 4);
        context.fillStyle = "rgba(100,0,0,0.72)";
        context.fillRect(-27, -9, 4, 5);
        context.fillRect(-27, 4, 4, 5);

        if (car.car === 1) {
          context.fillStyle = "#20252a";
          context.fillRect(-31, -15, 5, 30);
        } else if (car.car === 3) {
          context.strokeStyle = seatColour;
          context.lineWidth = 2;
          context.strokeRect(-22, -14, 39, 28);
        }

        const shade = Math.abs(roll) * 0.34;
        if (shade > 0.01) {
          context.fillStyle = `rgba(0,0,0,${shade})`;
          context.fillRect(-29, roll > 0 ? -17 : 0, 58, 17);
        }
        context.restore();
        context.restore();
      }

      function drawFrame(now) {
        if (disposed) return;
        const frame = resizeCanvas();
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        context.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        context.fillStyle = "#274a31";
        context.fillRect(0, 0, frame.width, frame.height);

        const state = payload();
        const track = TRACKS[((state?.trackId || 1) - 1 + TRACKS.length) % TRACKS.length];
        const deltaSeconds = clamp((now - lastFrameAt) / 1000, 0, 0.05);
        lastFrameAt = now;
        const raceCars = smoothedCars(now, deltaSeconds);
        const focus = focusCar(raceCars);

        if (focus) {
          const speed = Math.hypot(focus.vx || 0, focus.vy || 0);
          const speedRatio = clamp(speed / 320, 0, 1);
          const targetZoom = lerp(1.16, 0.67, speedRatio);
          if (!camera.initialised) {
            camera.x = focus.x || 0;
            camera.y = focus.y || 0;
            camera.zoom = targetZoom;
            camera.initialised = true;
          }
          const cameraResponse = 1 - Math.exp(-4.2 * deltaSeconds);
          camera.x = lerp(camera.x, focus.x || 0, cameraResponse);
          camera.y = lerp(camera.y, focus.y || 0, cameraResponse);
          camera.zoom = lerp(camera.zoom, targetZoom, 1 - Math.exp(-2.1 * deltaSeconds));
        } else if (!camera.initialised) {
          camera.x = 0;
          camera.y = 0;
          camera.zoom = 0.64;
          camera.initialised = true;
        }

        const baseScale = Math.min(frame.width, frame.height) / 920;
        const scale = baseScale * camera.zoom;
        context.save();
        context.translate(frame.width / 2, frame.height / 2);
        context.scale(scale, scale);
        context.translate(-camera.x, -camera.y);

        context.fillStyle = "rgba(255,255,255,0.035)";
        for (let x = -1100; x <= 1100; x += 90) {
          for (let y = -850; y <= 850; y += 90) {
            context.fillRect(x + ((y / 90) % 2) * 25, y, 3, 3);
          }
        }
        drawTrack(context, track);
        updateSkidMarks(raceCars, now);
        updateSmoke(focus, now);
        drawSkidMarks(context, now);
        drawSmoke(context, now);
        const sortedCars = [...raceCars].sort((a, b) => (a.y || 0) - (b.y || 0));
        for (const car of sortedCars) drawCar(context, car);
        context.restore();

        animationFrame = requestAnimationFrame(drawFrame);
      }

      const keyMap = {
        ArrowLeft: "left", a: "left", A: "left",
        ArrowRight: "right", d: "right", D: "right",
        ArrowUp: "throttle", w: "throttle", W: "throttle",
        ArrowDown: "brake", s: "brake", S: "brake"
      };
      const onKeyDown = (event) => {
        const input = keyMap[event.key];
        if (!input) return;
        event.preventDefault();
        if (!event.repeat) setInput(input, true);
      };
      const onKeyUp = (event) => {
        const input = keyMap[event.key];
        if (!input) return;
        event.preventDefault();
        setInput(input, false);
      };
      const onVisibilityChange = () => {
        if (document.hidden) clearInput(true);
      };
      const onBlur = () => clearInput(true);
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", onBlur);

      function requestJoin(errorMessage) {
        clearMatchState(true);
        joinPending = true;
        if (!arcade.game.join(APP_ID)) {
          joinPending = false;
          setStatus(errorMessage, "error");
        }
        renderUi();
      }

      joinButton.addEventListener("click", () => requestJoin("Unable to request a race."));
      againButton.addEventListener("click", () => requestJoin("Unable to request a new race."));
      lobbyReadyButton.addEventListener("click", () => {
        if (!canUseLobbyPhase("join") || !arcade.game.send(matchState.matchId, "lobby-ready", {})) {
          setStatus("Unable to confirm the lobby.", "error");
        }
      });
      readyButton.addEventListener("click", () => {
        if (!canUseLobbyPhase("confirm") || !arcade.game.send(matchState.matchId, "race-ready", {})) {
          setStatus("Unable to confirm the race.", "error");
        }
      });
      claimButton.addEventListener("click", () => {
        if (!matchState || !arcade.game.claimControl(matchState.matchId)) {
          setStatus("Unable to claim controls.", "error");
        }
      });
      leaveButton.addEventListener("click", () => {
        clearInput(true);
        if (matchState && !arcade.game.leave(matchState.matchId)) setStatus("Unable to leave race.", "error");
      });

      if (arcade.display?.onFullscreenChange) {
        stops.push(arcade.display.onFullscreenChange((fullscreen) => {
          fullscreenRequestPending = false;
          if (fullscreen) {
            fullscreenEntered = true;
          } else if (fullscreenEntered && matchState?.state === "playing" &&
              (payload()?.phase === "countdown" || payload()?.phase === "racing")) {
            fullscreenDismissed = true;
          }
          root.classList.toggle("fullscreen", Boolean(fullscreen));
        }));
        root.classList.toggle("fullscreen", Boolean(arcade.display.fullscreen));
      }

      stops.push(arcade.game.onMatch((nextMatch) => {
        if (!nextMatch?.matchId || retiredMatchIds.has(nextMatch.matchId)) return;
        const role = nextMatch.you?.role;
        const syntheticClosed = nextMatch.state === "closed" && role === "none";
        if (role === "none") {
          if (!matchState || nextMatch.matchId === matchState.matchId) {
            if (!syntheticClosed) retireMatch(nextMatch.matchId);
            clearMatchState(false);
            renderUi();
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
          resetVisualState();
        }
        const previousController = Boolean(matchState?.you?.controller);
        const previousMatchId = matchState?.matchId;
        matchState = nextMatch;
        joinPending = false;
        if (role !== "player" || !nextMatch.you?.controller || nextMatch.state !== "playing") {
          clearInput(false);
        }
        if (nextMatch.state !== "finished" && nextMatch.you?.controller &&
            (nextMatch.matchId !== previousMatchId || !previousController)) {
          arcade.game.requestSnapshot(nextMatch.matchId);
        }
        renderUi();
      }));

      stops.push(arcade.game.onSnapshot((nextSnapshot) => {
        if (!nextSnapshot || nextSnapshot.appId !== APP_ID || !matchState ||
            nextSnapshot.matchId !== matchState.matchId) return;
        const revision = Number(nextSnapshot.revision);
        if (!Number.isFinite(revision) || revision < latestSnapshotRevision) return;
        latestSnapshotRevision = revision;
        snapshotEnvelope = nextSnapshot;
        snapshotReceivedAt = performance.now();
        renderUi();
      }));

      stops.push(arcade.game.onEvent((event) => {
        if (!event || !matchState || event.matchId !== matchState.matchId) return;
        if (event.name === "go") setStatus("GO!", "ok");
      }));

      stops.push(arcade.game.onResult((result) => {
        if (!result || !matchState || result.matchId !== matchState.matchId) return;
        resultEnvelope = result;
        clearInput(false);
        renderUi();
      }));

      stops.push(arcade.game.onError((error) => {
        if (error?.matchId && (!matchState || error.matchId !== matchState.matchId)) return;
        if (!error?.matchId) joinPending = false;
        if (error?.code === "match_not_found") {
          clearMatchState(true);
        }
        if (error?.code === "rate_limited" || error?.code === "queue_full") {
          clearInput(true);
        }
        setStatus(error?.message ? String(error.message) : "Game operation rejected.", "error");
        renderUi();
      }));

      stops.push(arcade.onConnection((connection) => {
        if (connection !== "connected") {
          clearInput(false);
          clearMatchState(false);
          setStatus("Reconnecting…", "");
          renderUi();
        }
      }));

      if (matchState?.matchId && matchState.state !== "finished") {
        arcade.game.requestSnapshot(matchState.matchId);
      }
      renderUi();
      animationFrame = requestAnimationFrame(drawFrame);

      return () => {
        disposed = true;
        for (const stop of stops) stop();
        for (const unbind of unbindControls) unbind();
        clearInput(false);
        cancelAnimationFrame(animationFrame);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onBlur);
        skidMarks.length = 0;
        smokeParticles.length = 0;
        lastWheels.clear();
        lastSmokeAt = 0;
        visualCars.clear();
        if (arcade.display?.fullscreen) arcade.display.exitFullscreen();
        container.replaceChildren();
      };
    }
  };
})();

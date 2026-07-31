PocketArcade Visual & Interaction Style Guide
Version: 1.2
Target platform: PocketArcade firmware 0.3.0 browser-hosted applications

This guide defines a consistent visual and interaction language for PocketArcade games and apps. It is designed to make new developments feel like members of the same product family without forcing every game to look identical.
---

1. Design goals
1.1 Visual goal

Every PocketArcade app should feel:
Playful: bold shapes, tactile controls, expressive feedback and small moments of celebration.
Readable: one obvious action at a time, strong contrast and clear hierarchy.
Controllable: When within the PocketArcade UI or Fullscreen, the main game-field and controls for the player must be available without scrolling.
Responsive: comfortable on phones, tablets and fullscreen desktop browsers moving non-game-field elements maintaining play-field and controls focus.
Shared: player identity and multiplayer state should only be visible without dominating the game.
Lightweight: no remote fonts, CDNs, analytics or large runtime downloads.
Authoritative: visual state follows server snapshots; transient effects follow server events.
The style should be recognisable as PocketArcade, while each game keeps its own board, world, characters and signature accent graphics.
1.2 Flow goal

Every PocketArcade app should follow:
Logical: There should be a logical flow to each app which brings the player along in the journey to start play and finish.
Open: When loading the Game should have a Splash screen, with Name, version, player counts and Join button.
Start: Game Lobby to show users and spectators, ready up/leave controls
Play: The game area and controls takeover the main view for the duration of the game.
End: Summaries of the game, winners, losers, scores, positions and restart/close options
1.3 Standard game splash screen
Every PocketArcade game must open on a dedicated splash screen before the player joins a match. The Tic-Tac-Toe start screen is the reference implementation.
The splash screen has two separate parts:
A game-specific 4:3 hero graphic containing the PocketArcade identity, the game name and a clear visual representation of the game.
A live HTML action panel containing the player requirements, version information and the primary Join game button.
Do not bake changing interface data such as the version, player count, connection state or Join button into the image. These values must remain accessible, responsive and updateable in HTML.
Splash graphic specification
Property	Requirement
Canonical source size	`960 × 720 px`
Aspect ratio	`4:3`
Display width	`min(100%, 50rem)` in normal portrait or desktop layouts
Short-landscape display width	Up to `37rem`, occupying approximately 70% of the splash row
Format	Optimised JPEG or WebP for painted artwork; PNG only when transparency or lossless edges are required
Loading	Local package asset, eagerly loaded before joining
Cropping	The important artwork must remain safe when displayed with `object-fit: cover`
The reference `960 × 720` JPEG is approximately 135 KB. Treat about 200 KB as a practical upper target for a single splash image unless visual quality clearly requires more.
The artwork should use this composition:
PocketArcade logo or wordmark near the top;
game title as the most prominent text;
one short optional tagline;
game-specific characters, board, vehicle, arena or action as the main lower visual;
a dark PocketArcade-compatible background with controlled game-specific colour and glow;
at least 5% clear space around important logos, text and characters.
The artwork must not include the Join button, version, changing player count, connection state, detailed instructions or other live UI.
Required layout
```text
App root
├── Persistent top bar
├── Splash section
│   ├── 4:3 hero graphic
│   └── Action panel
│       ├── Short invitation or prompt
│       ├── Player/version chips
│       └── Join game button
└── Game view, initially hidden
```
The hero graphic and action panel must use the same maximum width so that they read as one component. On normal screens the action panel sits below the image. On narrow portrait screens the panel content stacks and the Join button becomes full width. On short landscape screens the image and panel sit side by side in an approximate 70/30 split.
Reference markup
Use app-specific class names. Replace `example` and the visible copy with the game’s own values.
```html
<section
  class="pocket-example__splash"
  aria-labelledby="pocket-example-splash-title"
>
  <h2 id="pocket-example-splash-title" class="pocket-example__sr-only">
    Example Game
  </h2>

  <figure class="pocket-example__splash-visual">
    <img
      class="pocket-example__splash-image"
      src="../assets/start-screen.jpg"
      alt="PocketArcade Example Game showing the game’s main characters and playfield"
      width="960"
      height="720"
      loading="eager"
      decoding="async"
      draggable="false"
    >
  </figure>

  <div class="pocket-example__splash-panel">
    <div class="pocket-example__splash-details">
      <strong class="pocket-example__splash-prompt">
        Ready to play?
      </strong>

      <div class="pocket-example__splash-chips" aria-label="Game details">
        <span class="pocket-example__chip">2–4 players</span>
        <span class="pocket-example__chip">Spectators welcome</span>
        <span class="pocket-example__chip">v1.0.0</span>
      </div>
    </div>

    <button
      class="pocket-example__button pocket-example__button--primary pocket-example__splash-join"
      type="button"
    >
      Join game
    </button>
  </div>
</section>
```
When creating the image in JavaScript, resolve it relative to the application script and give it high loading priority:
```javascript
const assetBase = new URL(".", document.currentScript.src);
const startScreenUrl = new URL("../assets/start-screen.jpg", assetBase).href;

splashImage.src = startScreenUrl;
splashImage.loading = "eager";
splashImage.decoding = "async";
splashImage.draggable = false;
if ("fetchPriority" in splashImage) splashImage.fetchPriority = "high";
```
Reference CSS
```css
.pocket-example[hidden],
.pocket-example [hidden] {
  display: none !important;
}

.pocket-example__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.pocket-example__splash {
  display: flex;
  min-height: 31rem;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  padding: clamp(.75rem, 2.5vw, 1.5rem);
}

.pocket-example__splash-visual {
  width: min(100%, 50rem);
  margin: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .15);
  border-radius: 24px;
  background: #0d081b;
  box-shadow: var(--pa-shadow-overlay);
}

.pocket-example__splash-image {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  user-select: none;
}

.pocket-example__splash-panel {
  display: flex;
  width: min(100%, 50rem);
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: .8rem;
  border: 1px solid var(--pa-line);
  border-radius: 20px;
  background: rgba(33, 28, 56, .92);
  box-shadow: var(--pa-shadow-small);
}

.pocket-example__splash-details {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: .45rem;
}

.pocket-example__splash-prompt {
  font-size: .9rem;
  line-height: 1.2;
}

.pocket-example__splash-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: .4rem;
}

.pocket-example__chip {
  padding: .32rem .58rem;
  border: 1px solid var(--pa-line);
  border-radius: 999px;
  color: var(--pa-ink);
  background: rgba(255, 255, 255, .06);
  font-size: .64rem;
  font-weight: 800;
}

.pocket-example__splash-join {
  min-width: 10rem;
  flex: 0 0 auto;
}

@media (max-width: 530px) {
  .pocket-example__splash {
    min-height: 0;
    justify-content: flex-start;
    gap: .55rem;
    padding: .55rem;
  }

  .pocket-example__splash-visual {
    border-radius: 18px;
  }

  .pocket-example__splash-panel {
    align-items: stretch;
    flex-direction: column;
    gap: .65rem;
    padding: .7rem;
    border-radius: 18px;
  }

  .pocket-example__splash-details {
    align-items: center;
    text-align: center;
  }

  .pocket-example__splash-chips {
    justify-content: center;
  }

  .pocket-example__splash-join {
    width: 100%;
  }
}

@media (max-height: 600px) and (orientation: landscape) {
  .pocket-example__splash {
    min-height: 0;
    flex-direction: row;
    align-items: stretch;
    gap: .65rem;
    padding: .6rem;
  }

  .pocket-example__splash-visual {
    width: min(70%, 37rem);
    align-self: center;
    border-radius: 18px;
  }

  .pocket-example__splash-panel {
    width: min(30%, 17rem);
    align-items: stretch;
    justify-content: center;
    flex-direction: column;
    gap: .7rem;
    border-radius: 18px;
  }

  .pocket-example__splash-details {
    align-items: center;
    text-align: center;
  }

  .pocket-example__splash-chips {
    justify-content: center;
  }

  .pocket-example__splash-join {
    width: 100%;
    min-width: 0;
  }
}
```
Splash-screen behaviour
The splash is a pre-membership screen, not the game lobby. It is shown only while the local profile has no active role in the current match.
```javascript
function renderView() {
  const joined = Boolean(
    activeMatch &&
    activeMatch.you?.role !== "none" &&
    activeMatch.state !== "closed"
  );

  splash.hidden = joined;
  gameView.hidden = !joined;
  splashJoin.disabled = pendingJoin || !isConnected();
  splashJoin.textContent = pendingJoin ? "Joining…" : "Join game";
}

splashJoin.addEventListener("click", () => {
  pendingJoin = true;
  renderView();

  if (!arcade.game.join(appId)) {
    pendingJoin = false;
    renderView();
  }
});
```
On mount, check `arcade.game.currentMatch()`. A valid cached player or spectator membership must open directly into the game view rather than briefly showing the splash screen. A closed match or a match with `you.role === "none"` must return to the splash screen.
Do not automatically enter fullscreen from the splash screen. Request PocketArcade fullscreen when active play begins or after a clear player action appropriate to the game.
Acceptance checklist
[ ] Splash artwork is exactly `4:3` and exported at `960 × 720 px`.
[ ] Artwork contains the PocketArcade identity, game name and game-specific hero visual.
[ ] Version, player requirements and Join button are live HTML, not baked into the artwork.
[ ] Hero image and action panel share the same `50rem` maximum width.
[ ] The image is not stretched or distorted.
[ ] At `530 px` width and below, the panel stacks and the Join button spans the panel width.
[ ] At `600 px` height and below in landscape, the splash changes to the 70/30 side-by-side layout.
[ ] The Join button remains visible and usable at `320 × 568 px` without horizontal scrolling.
[ ] The image is served from the game package and does not depend on the internet.
[ ] The image has useful alternative text; decorative duplicated text is not relied upon for accessibility.
[ ] Joining disables the button and changes its label to `Joining…` until authoritative match state arrives or the request fails.
[ ] A valid cached match bypasses the splash and restores the game view.

1.4 Responsive gameplay viewport and fullscreen scaling
PocketArcade games must treat the active play area as a measured layout region rather than assuming that `100vh`, a fixed board size or one set of width-only media queries will fit every device.
Tic-Tac-Toe version 1.2.2 is the reference implementation for this pattern. It combines:
a flex-column application root;
shrinkable grid and flex children using `min-width: 0` and `min-height: 0`;
the real visible browser viewport from `window.visualViewport` when available;
playfield sizing from the arena's measured width and height;
one `requestAnimationFrame` layout scheduler;
`ResizeObserver`, viewport resize and orientation listeners;
height-aware fullscreen media queries;
safe-area padding for phones and tablets;
PocketArcade shell fullscreen rather than the browser Fullscreen API.
The result is that the game field and the current player's controls remain visible without page scrolling in both the normal PocketArcade view and fullscreen.
1.4.1 Required layout priorities
During active play, lay out content in this order of importance:
The game field or arena.
Controls required for the current player to act.
Essential player or score state.
Game title chrome and connection state.
Secondary labels, subtitles, spectator detail and decorative copy.
When space becomes limited, compress, move or hide lower-priority information before reducing the game field below a useful size. Do not solve a short viewport by allowing the whole application to scroll during normal play.
The normal application structure should remain:
```text
App root
├── Game title chrome
│   ├── Game icon and title
│   ├── Optional subtitle / version
│   ├── Connection state
│   └── Fullscreen entry control in standard mode
├── Game view
│   ├── Main responsive layout
│   │   ├── Player / score rail
│   │   └── Play column
│   │       ├── Measured arena
│   │       │   └── Aspect-ratio game field
│   │       └── Contextual player controls
│   └── Membership / match controls
└── Error and toast layers
```
All containers between the application root and the measured arena must be allowed to shrink. A missing `min-height: 0` on one flex or grid child can force the page beyond the visible viewport even when the game field itself is correctly sized.
1.4.2 Application root and visible viewport
The application root should fill the space supplied by PocketArcade in standard mode. In fullscreen it should use the real visible viewport height recorded in a CSS custom property.
Do not rely only on `100vh`. Mobile browser controls, display cut-outs, virtual keyboards and orientation changes can make the visible area smaller than the layout viewport. Use `100dvh` as a CSS fallback and synchronise `window.visualViewport.height` when available.
```css
.pocket-example {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--pa-line);
  border-radius: var(--pa-radius-app);
  background: var(--pa-bg);
}

.pocket-example.is-fullscreen {
  height: var(--pa-visible-height, 100dvh);
  min-height: 0;
  max-height: var(--pa-visible-height, 100dvh);
  border-width: 0;
  border-radius: 0;
  box-shadow: none;
}

.pocket-example__game-view,
.pocket-example__main,
.pocket-example__play-column,
.pocket-example__arena {
  min-width: 0;
  min-height: 0;
}

.pocket-example__game-view {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
}

.pocket-example__main {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-columns: minmax(10rem, 13rem) minmax(0, 1fr);
  gap: .75rem;
  padding: .75rem;
}

.pocket-example.is-fullscreen .pocket-example__main {
  overflow: hidden;
}

.pocket-example__play-column {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: .65rem;
}

.pocket-example__arena {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--pa-line);
  border-radius: var(--pa-radius-panel);
  background: rgba(33, 28, 56, .78);
}
```
1.4.3 Measure the arena, not the page
The game field must be sized from the actual rectangle available inside its arena after title chrome, player information, controls, membership actions, padding and safe areas have been laid out.
Do not calculate a board from `window.innerWidth` alone. A viewport can be wide but short, especially on a phone in landscape. The limiting dimension is normally the smaller of the arena's available width and height.
For square boards, the Tic-Tac-Toe reference pattern is:
```javascript
function syncSquareFieldSize() {
  if (gameView.hidden) return;

  const rect = arena.getBoundingClientRect();
  const gutter = 20;
  const available = Math.floor(Math.min(rect.width, rect.height) - gutter);
  if (available <= 0) return;

  const size = Math.min(464, available);
  if (size === lastFieldSize) return;

  lastFieldSize = size;
  gameField.style.setProperty("--pa-field-size", `${size}px`);
}
```
```css
.pocket-example__game-field {
  width: min(var(--pa-field-size, 29rem), calc(100% - 1.25rem));
  height: min(var(--pa-field-size, 29rem), calc(100% - 1.25rem));
  max-width: none;
  flex: 0 0 auto;
  aspect-ratio: 1;
}
```
The `464px` value is the maximum design size for the Tic-Tac-Toe board, not a universal PocketArcade maximum. Each game should define a sensible maximum based on its artwork, controls and useful viewing distance.
For rectangular fields, tracks, tables or fixed-aspect canvases, preserve the game's native aspect ratio:
```javascript
const fieldAspect = 16 / 9;
const maxFieldWidth = 960;
const maxFieldHeight = 540;
const fieldGutter = 20;
let lastFieldWidth = -1;
let lastFieldHeight = -1;

function syncAspectFieldSize() {
  if (gameView.hidden) return;

  const rect = arena.getBoundingClientRect();
  const availableWidth = Math.max(0, Math.floor(rect.width - fieldGutter));
  const availableHeight = Math.max(0, Math.floor(rect.height - fieldGutter));
  if (!availableWidth || !availableHeight) return;

  const width = Math.floor(Math.min(
    maxFieldWidth,
    availableWidth,
    availableHeight * fieldAspect
  ));
  const height = Math.floor(Math.min(maxFieldHeight, width / fieldAspect));

  if (width === lastFieldWidth && height === lastFieldHeight) return;
  lastFieldWidth = width;
  lastFieldHeight = height;

  gameField.style.setProperty("--pa-field-width", `${width}px`);
  gameField.style.setProperty("--pa-field-height", `${height}px`);
}
```
```css
.pocket-example__game-field {
  width: min(var(--pa-field-width, 60rem), calc(100% - 1.25rem));
  height: min(var(--pa-field-height, 33.75rem), calc(100% - 1.25rem));
  max-width: none;
  max-height: none;
  flex: 0 0 auto;
}
```
For a canvas, update its CSS size through these variables while retaining an appropriate internal drawing-buffer resolution. For SVG, use a fixed `viewBox` and let the measured CSS box scale it. For DOM boards, keep pieces and hit areas proportional using percentages, grid tracks, `aspect-ratio`, `clamp()` and container-relative geometry.
1.4.4 One scheduled layout synchronisation path
Viewport and element-resize callbacks can fire several times during one browser frame. They must not each perform their own layout read and write.
Use one animation-frame scheduler to coalesce all layout work:
```javascript
let layoutFrame = 0;
let lastViewportHeight = -1;
let lastViewportWidth = -1;
let disposed = false;

function syncVisibleViewport() {
  const viewport = window.visualViewport;
  const height = Math.max(
    1,
    Math.round(
      viewport?.height ||
      window.innerHeight ||
      document.documentElement.clientHeight ||
      1
    )
  );
  const width = Math.max(
    1,
    Math.round(
      viewport?.width ||
      window.innerWidth ||
      document.documentElement.clientWidth ||
      1
    )
  );

  if (height !== lastViewportHeight) {
    lastViewportHeight = height;
    root.style.setProperty("--pa-visible-height", `${height}px`);
  }

  if (width !== lastViewportWidth) {
    lastViewportWidth = width;
    root.style.setProperty("--pa-visible-width", `${width}px`);
  }
}

function scheduleLayoutSync() {
  if (disposed || layoutFrame) return;

  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = 0;
    syncVisibleViewport();
    syncAspectFieldSize(); // or syncSquareFieldSize()
  });
}
```
Schedule this function after rendering when the game view becomes visible. Also schedule it from:
`window.resize`;
`window.orientationchange`;
`visualViewport.resize`;
`visualViewport.scroll`;
a `ResizeObserver` attached to the application root and arena;
PocketArcade fullscreen state changes.
```javascript
const visualViewport = window.visualViewport;
let arenaObserver = null;

window.addEventListener("resize", scheduleLayoutSync, { passive: true });
window.addEventListener("orientationchange", scheduleLayoutSync, { passive: true });
visualViewport?.addEventListener("resize", scheduleLayoutSync, { passive: true });
visualViewport?.addEventListener("scroll", scheduleLayoutSync, { passive: true });

if (typeof ResizeObserver === "function") {
  arenaObserver = new ResizeObserver(scheduleLayoutSync);
  arenaObserver.observe(root);
  arenaObserver.observe(arena);
}
```
The cleanup function must remove every listener, disconnect the observer and cancel the pending animation frame:
```javascript
return () => {
  disposed = true;
  window.removeEventListener("resize", scheduleLayoutSync);
  window.removeEventListener("orientationchange", scheduleLayoutSync);
  visualViewport?.removeEventListener("resize", scheduleLayoutSync);
  visualViewport?.removeEventListener("scroll", scheduleLayoutSync);
  arenaObserver?.disconnect();
  arenaObserver = null;
  window.cancelAnimationFrame(layoutFrame);
  layoutFrame = 0;
};
```
Do not continuously poll dimensions. Do not read geometry in the game simulation loop. Recalculate only when rendering or layout conditions can have changed.
1.4.5 Fullscreen lifecycle
Use PocketArcade's display facade. Do not call the browser Fullscreen API.
A game may request fullscreen when the player performs an explicit action that begins active play, such as Ready, Start, Race or Launch:
```javascript
function readyUp() {
  if (!activeMatch || activeMatch.you?.role !== "player") return;

  const sent = arcade.game.ready(activeMatch.matchId);
  if (!sent) return;

  arcade.display?.requestFullscreen?.();
}
```
Do not request fullscreen from `mount()`. Do not force fullscreen merely because the player joined a lobby or opened the splash screen.
Synchronise a root modifier from authoritative shell display state:
```javascript
function syncFullscreen(value) {
  const isFullscreen = Boolean(value);
  root.classList.toggle("is-fullscreen", isFullscreen);
  fullscreenButton.hidden = isFullscreen;
  resultExitButton.hidden = !isFullscreen;
  scheduleLayoutSync();
}

const stopFullscreen = arcade.display?.onFullscreenChange?.((value) => {
  syncFullscreen(value);
}) || (() => {});

syncFullscreen(arcade.display?.fullscreen);
```
The application's own fullscreen-entry button should normally be hidden while fullscreen is active because PocketArcade provides the shell-owned Exit fullscreen control. Do not create a second permanent exit control over the game field. A contextual result or menu action may also call `arcade.display.exitFullscreen()` when returning to a non-playing view.
1.4.6 Default game title chrome
The game title chrome is the app-owned top bar containing the game icon, game name, optional subtitle or version, connection state and fullscreen entry control.
The default rule is:
show the game title chrome in standard mode;
continue showing it in fullscreen mode;
hide the app's fullscreen-entry button while fullscreen is active;
reserve the top-right area for PocketArcade's shell-owned Exit fullscreen control;
compress secondary title chrome before hiding essential game content.
```css
.pocket-example__topbar {
  position: relative;
  z-index: 5;
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .65rem .8rem;
  border-bottom: 1px solid var(--pa-line);
  background: rgba(21, 18, 38, .82);
}

.pocket-example.is-fullscreen .pocket-example__topbar {
  padding-top: max(.5rem, env(safe-area-inset-top));
  padding-right: max(7.5rem, calc(5rem + env(safe-area-inset-right)));
}

.pocket-example.is-fullscreen .pocket-example__fullscreen-entry {
  display: none;
}
```
The title chrome should remain visually stable when entering fullscreen. Do not replace it with a game-specific navigation bar or move match actions into it. It remains app identity and connection chrome, not a turn-control area.
At narrow widths, hide or shorten secondary content while retaining the icon, title and connection indication:
```css
@media (max-width: 530px) {
  .pocket-example__subtitle {
    display: none;
  }

  .pocket-example__connection-label {
    font-size: .64rem;
  }
}
```
1.4.7 Optional chrome-hidden immersive fullscreen
Some games benefit from a more immersive fullscreen presentation, including racers, first-person games, action games and full-screen canvas experiences. These games may hide their app-owned game title chrome only while fullscreen is active.
This is an explicit game design choice, not the default. Use a clear modifier such as `fullscreen-chrome-hidden` or `is-immersive` rather than tying the behaviour to a screen width.
```javascript
const immersiveFullscreen = true; // Game design setting, not viewport detection.

function syncFullscreen(value) {
  const isFullscreen = Boolean(value);
  root.classList.toggle("is-fullscreen", isFullscreen);
  root.classList.toggle(
    "is-immersive",
    isFullscreen && immersiveFullscreen
  );
  fullscreenButton.hidden = isFullscreen;
  scheduleLayoutSync();
}
```
```css
.pocket-example.is-fullscreen.is-immersive .pocket-example__topbar {
  display: none;
}

.pocket-example.is-fullscreen.is-immersive .pocket-example__main {
  padding-top: max(.5rem, env(safe-area-inset-top));
  padding-right: max(3.75rem, calc(3.25rem + env(safe-area-inset-right)));
}
```
Even when title chrome is hidden:
PocketArcade's shell-owned Exit fullscreen control must remain visible and operable;
the Escape key must continue to exit on keyboards;
no critical game control may occupy the shell exit safe area;
connection loss and errors must remain visible through an in-game status, toast or overlay;
the game must not recreate, cover or disable the shell exit control;
fullscreen must still end automatically when the shell closes or changes application.
Because the exit control belongs to the PocketArcade shell, app-scoped CSS must not attempt to restyle it.
1.4.8 Shell exit treatment when title chrome is hidden
When normal title chrome is visible, the shell may use its standard labelled Exit fullscreen control within the reserved top-right area.
When an app uses chrome-hidden immersive fullscreen, the PocketArcade shell should switch that control to a compact semi-transparent icon treatment so that it remains discoverable without dominating the game.
Required immersive exit behaviour:
shell-owned and always above app content;
at least `44 × 44 px` interactive size;
positioned using top and right safe-area insets;
icon-only visually, with `aria-label="Exit fullscreen"` and a tooltip or accessible title;
semi-transparent dark PocketArcade surface at rest;
stronger opacity and border contrast on hover, focus and active states;
a visible keyboard focus outline;
never fully hidden, timed out or dependent on hover;
must not use an ambiguous close icon if it could be mistaken for closing the game.
Illustrative shell-level CSS:
```css
.pa-shell-fullscreen-exit--immersive {
  position: fixed;
  z-index: 10000;
  top: max(.5rem, env(safe-area-inset-top));
  right: max(.5rem, env(safe-area-inset-right));
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .24);
  border-radius: 14px;
  color: #fffaf2;
  background: rgba(21, 18, 38, .58);
  box-shadow: 0 8px 20px rgba(0, 0, 0, .22);
  opacity: .78;
  cursor: pointer;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.pa-shell-fullscreen-exit--immersive:hover,
.pa-shell-fullscreen-exit--immersive:focus-visible,
.pa-shell-fullscreen-exit--immersive:active {
  border-color: rgba(255, 255, 255, .52);
  background: rgba(21, 18, 38, .82);
  opacity: 1;
}

.pa-shell-fullscreen-exit--immersive:focus-visible {
  outline: 3px solid rgba(255, 244, 188, .92);
  outline-offset: 3px;
}
```
This is a platform-shell requirement. Until the display facade or manifest exposes a formal title-chrome preference, a game may hide only its own top bar; it must not assume it can directly change the shell exit presentation.
1.4.9 Responsive width and height states
Use width and height media queries together. Width-only breakpoints are not enough for fullscreen phones and tablets.
Recommended adaptation sequence:
Below approximately `760px` width, move the player rail above the arena and arrange player cards in a compact row or grid.
Below approximately `530px` width, hide subtitles and secondary player state, reduce gaps and allow action buttons to span available width.
Below approximately `720px` fullscreen height, reduce title-bar height, panel padding, rail gaps and control-panel height.
Below approximately `560px` height in landscape, return to a narrow side player rail and wide play column; hide rail headings and secondary status text.
Keep the game field and current controls visible throughout these transitions.
```css
@media (max-width: 760px) {
  .pocket-example__main {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .pocket-example__player-rail {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-height: 720px) {
  .pocket-example.is-fullscreen .pocket-example__topbar {
    min-height: 48px;
    padding-block: .42rem;
  }

  .pocket-example.is-fullscreen .pocket-example__main {
    gap: .45rem;
    padding: .45rem;
  }

  .pocket-example.is-fullscreen .pocket-example__controls {
    min-height: 58px;
    padding: .5rem .7rem;
  }
}

@media (max-height: 560px) and (orientation: landscape) {
  .pocket-example.is-fullscreen .pocket-example__main {
    grid-template-columns: minmax(8rem, 10.5rem) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .pocket-example.is-fullscreen .pocket-example__player-rail {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .pocket-example.is-fullscreen .pocket-example__secondary-player-state,
  .pocket-example.is-fullscreen .pocket-example__rail-heading,
  .pocket-example.is-fullscreen .pocket-example__spectator-heading {
    display: none;
  }
}
```
These values are starting points, not a substitute for testing the actual game. A game with driving controls, a card hand or a wide track may need different breakpoints while following the same priority order.
1.4.10 Safe areas and overlays
Fullscreen layouts must account for display notches, rounded corners and shell controls:
```css
.pocket-example.is-fullscreen .pocket-example__topbar {
  padding-top: max(.5rem, env(safe-area-inset-top));
}

.pocket-example.is-fullscreen .pocket-example__membership {
  padding-bottom: max(.55rem, env(safe-area-inset-bottom));
}
```
Keep the top-right shell exit reserve clear in both title-chrome modes. Toasts, score badges, pause controls, steering buttons and other critical interactions must not overlap it.
Overlays should be positioned inside the measured arena so they scale and centre with the play region. Result overlays may temporarily cover the field after play has ended, but waiting and turn information should not permanently obscure the game.
1.4.11 Performance and stability rules
Compare new dimensions with the last applied dimensions before writing CSS variables.
Batch geometry reads and style writes in one scheduled animation frame.
Observe the smallest useful containers rather than the entire document.
Do not rebuild the board merely because its CSS size changed.
Do not run layout measurement from `on_tick`, snapshot interpolation or animation loops.
Schedule a layout sync after splash-to-game, lobby-to-playing, result and fullscreen transitions.
Skip field measurement while the game view is hidden because hidden elements have no useful rectangle.
Disconnect observers and remove listeners during cleanup.
Keep a CSS fallback so the game remains usable where `visualViewport` or `ResizeObserver` is unavailable.
1.4.12 Review checklist: gameplay scaling and fullscreen
[ ] The game field is sized from the arena's measured width and height, not viewport width alone.
[ ] The game field preserves its intended aspect ratio.
[ ] Every shrinking flex or grid ancestor uses appropriate `min-width: 0` and `min-height: 0`.
[ ] The standard play view keeps the game field and current controls available without page scrolling.
[ ] Fullscreen uses `--pa-visible-height` from `visualViewport.height` with a `100dvh` fallback.
[ ] Resize, orientation, visual viewport and observed-element changes share one animation-frame scheduler.
[ ] Layout listeners, observers and animation frames are released during cleanup.
[ ] Fullscreen is requested after an explicit play-related action, never unconditionally from `mount()`.
[ ] The default game title chrome remains visible in standard and fullscreen modes.
[ ] The app's fullscreen-entry button is hidden while the shell-owned fullscreen exit is active.
[ ] Fullscreen title chrome reserves the top-right shell exit safe area.
[ ] Chrome-hidden immersive fullscreen is a deliberate game setting rather than an automatic width breakpoint.
[ ] In chrome-hidden fullscreen, the shell exit remains visible as a semi-transparent accessible icon control.
[ ] No app control, score or toast overlaps the shell exit control or device safe areas.
[ ] Short landscape layouts compress secondary information before reducing the field or hiding player controls.
[ ] The layout has been tested at a minimum of `320 × 568 px`, `568 × 320 px`, common tablet portrait and landscape sizes, and desktop fullscreen.
[ ] Tests include mobile browser chrome expanding/collapsing and an orientation change during active play.

---

2. Core visual language
2.1 Shape language
Use rounded, friendly geometry throughout:
Main app container: 24–28 px radius in normal view; square edges in fullscreen.
Panels and control groups: 20–24 px radius.
Player pills and cards: 12–16 px radius.
Buttons: 12–14 px radius.
Small chips and status badges: fully rounded or 9–12 px radius.
Game pieces: sculpted silhouettes with highlights and shadows rather than plain circles.
Avoid sharp corners, thin wireframe interfaces or flat grey rectangles unless the grey treatment specifically represents a spectator, unavailable state or neutral information.
2.2 Depth and materials
PocketArcade uses soft, toy-like depth:
Slightly raised controls with a lower shadow edge.
Soft inner highlights on active surfaces.
Layered panels rather than heavy glassmorphism.
Light game boards and play surfaces against a dark shell.
Decorative gradients should clarify hierarchy, not cover the entire interface.
Recommended shadow levels:
```css
--pa-shadow-small: 0 8px 20px rgba(0, 0, 0, .18);
--pa-shadow-panel: 0 16px 30px rgba(0, 0, 0, .24);
--pa-shadow-piece: 0 5px 10px rgba(0, 0, 0, .24);
--pa-shadow-overlay: 0 24px 54px rgba(0, 0, 0, .38);
```
2.3 Background treatment
The shared shell uses a deep purple-black base with restrained radial colour:
```css
background:
  radial-gradient(circle at 20% 0%, rgba(128, 103, 237, .24), transparent 34rem),
  radial-gradient(circle at 100% 80%, rgba(239, 93, 103, .16), transparent 30rem),
  #151226;
```
Game-specific accent colours may replace the radial highlights, but the base should remain dark enough to frame bright boards, arenas and controls.
---
3. Colour system
3.1 Shared neutral tokens
```css
--pa-bg: #151226;
--pa-panel: #211c38;
--pa-panel-raised: #2c2548;
--pa-ink: #fffaf2;
--pa-muted: #bdb7ce;
--pa-line: rgba(255, 255, 255, .11);
--pa-board: #fffdf8;
--pa-board-edge: #d7cbb8;
--pa-off-white: #fffdf7;
--pa-spectator: #7f7a8d;
--pa-spectator-dark: #5b5668;
--pa-danger: #ef5d67;
--pa-success: #21b88c;
--pa-gold: #f5b83d;
```
3.2 Example player palettes

Use the same seat order across games unless the game has a strong reason not to:

Seat	Name	Base	Dark	Soft
1	Coral	`#ef5d67`	`#b62f49`	`#ffd3d0`
2	Emerald	`#21b88c`	`#08775f`	`#c8f6df`
3	Gold	`#f5b83d`	`#b66d08`	`#fff0ae`
4	Violet	`#8067ed`	`#5136b6`	`#ded6ff`
5	Azure	`#3699e8`	`#1764a5`	`#cceaff`
6	Tangerine	`#f47b35`	`#b84712`	`#ffd8bd`
7	Rose	`#df4f9a`	`#9e2869`	`#ffd0e6`
8	Lime	`#86c83f`	`#4e8419`	`#e2f5bd`


Each seat should have:
a base colour for the main identity;
a dark tone for outlines and depth;
a soft tone for yards, zones, backgrounds or selection areas.
Never communicate seat identity through colour alone. Pair it with a name, avatar, number, shape or position.

3.3 Active-turn highlight
The current player's main action panel should use a gold treatment rather than changing every control:
```css
background: linear-gradient(
  135deg,
  rgba(255, 244, 188, .34),
  rgba(166, 122, 18, .28) 35%,
  rgba(56, 43, 14, .90) 100%
);
border-color: rgba(248, 214, 101, .88);
box-shadow:
  inset 0 0 0 2px rgba(255, 236, 164, .24),
  inset 0 1px 0 rgba(255, 255, 255, .18),
  0 0 0 1px rgba(251, 225, 128, .24),
  0 20px 34px rgba(118, 84, 18, .24);
```
When it is not the local player's turn, return the panel to the normal dark neutral treatment.

3.4 Inactive controls
Do not grey-wash an entire control. Preserve its material and identity.
Use one or more of:
a hollow ring or neutral symbol;
cursor change;
reduced glow;
a clear label such as “Waiting”;
`aria-disabled="true"` while keeping the visual surface intact.
Avoid applying opacity to the whole control, because it can make off-white surfaces look muddy or grey.
---
4. Typography
Use a system-first rounded stack:
```css
font-family: ui-rounded, "Trebuchet MS", system-ui, sans-serif;
```
Do not load remote fonts.
Recommended scale:
Use	Size	Weight
App title	`1.05–1.15rem`	700–800
Section or result title	`1.25–1.4rem`	700–800
Primary instruction	`0.9–1rem`	700–800
Player name	`0.8–0.9rem`	700
Body/status text	`0.72–0.82rem`	400–600
Labels and kickers	`0.58–0.68rem`	700–800
Use uppercase sparingly for short action prompts such as ROLL, READY or YOUR TURN. Do not use uppercase for long instructions.

---
5. Standard app anatomy
A typical PocketArcade game should use this structure:
```text
App root
├── Top bar
│   ├── Game icon and title
│   └── Connection / fullscreen controls
├── Main layout
│   ├── Player rail
│   └── Game arena
├── Contextual control panel
└── Lobby / membership bar
```
5.1 App root
Responsibilities:
Scope all CSS below one app-specific class.
Provide the dark shared background.
Hold fullscreen and responsive layout states.
Prevent styles leaking into the PocketArcade shell.
Naming pattern:
```css
.pocket-example { }
.pocket-example\_\_topbar { }
.pocket-example\_\_arena { }
.pocket-example\_\_controls { }
.pocket-example.is-paused { }
```

5.2 Top bar
The top bar should contain only persistent app-level information:
icon;
app name;
optional short subtitle;
connection state;
optional fullscreen toggle.
Keep the top-right PocketArcade fullscreen exit safe area clear. Do not place critical controls underneath it.

5.3 Player rail
Player cards should be compact and always lead with the local viewing order:
the local player's pill first;
other occupied players in seat order;
open seats while the match is waiting;
spectators after active play begins.
Recommended player card contents:
avatar or initials pill;
player name;
short status or progress;
seat number, ready tick or compact state marker.
Open seats should be labelled simply Open Seat. Do not include the seat colour in the visible name.
Once a match is underway and no longer accepts players:
hide empty player seats;
show spectators as neutral grey pills/cards;
show only their avatar and name in compact layouts;
never style spectators with a player-seat colour.

5.4 Game arena / Game Field
The arena is the visual focus. It should:
use the maximum available area;
preserve its aspect ratio;
remain legible from 320 px width upward;
avoid unnecessary text overlays over the playfield;
avoid scaling too small;
keep transient messages near an edge or in a toast layer.
Use SVG for boards, tracks and scalable geometric scenes. Use HTML/CSS for panels, controls and overlays.

5.5 Contextual control panel
The lower control panel should answer three questions:
What can I do now?
Is it my turn?
What happens if I press this control?
Use:
one main control or control cluster;
a strong instruction title;
one short supporting sentence;
a gold active-turn treatment when local input is valid.
Do not repeat board information in a centre overlay when the same information is already shown in the lower panel or player rail.
5.6 Lobby bar
Use the bottom membership bar for actions that affect the match rather than the game turn:
Join game
Ready up
Take control
Leave match
Play another match
Primary and secondary actions must be visually distinct.
---
6. Component specifications
6.1 Primary button
```css
min-height: 40px;
padding: 9px 15px;
border-radius: 13px;
font-weight: 800;
color: white;
background: linear-gradient(135deg, #8067ed, #b153a4);
box-shadow: 0 8px 20px rgba(87, 60, 167, .28);
```
Use for the single main action in a region. Avoid presenting several identical primary buttons together.
6.2 Secondary button
Use a dark translucent surface with a subtle border:
```css
border: 1px solid var(--pa-line);
color: var(--pa-ink);
background: rgba(255, 255, 255, .07);
```
6.3 Avatar pill
Circular.
Seat-coloured for active players.
Grey for spectators and neutral members.
Initials fallback must remain visible if the image is absent or fails.
Avatar images use `object-fit: cover`.
6.4 Game piece
Pieces should have at least three visual layers:
shadow;
seat-coloured body with darker outline;
highlight or label.
Selectable pieces should glow or pulse without changing their actual board-position transform. Apply selection animation to an inner visual group, not the outer positioned SVG group.
6.5 Dice or randomiser controls
A dice control should use a rendered face rather than font glyphs or emoji.
Recommended states:
Unrolled: off-white face with a hollow centre ring.
Rolling: animated face values.
Rolled: authoritative result.
Inactive: retain the off-white face; use the ring or label rather than a grey overlay.
6.6 Toasts
Use toasts for short transient outcomes:
capture;
bonus turn;
safe landing;
goal/home arrival;
recoverable command error.
Guidelines:
one sentence or less;
visible for roughly 1.2–2.4 seconds;
placed away from critical controls;
use `aria-live="polite"`;
colour may reflect event meaning, but text remains required.
6.7 Waiting overlay
A waiting overlay may cover the game arena before play, but it should not hide membership controls.
Include:
game icon or compact illustration;
short title;
one sentence explaining the next action.
6.8 Result overlay
A result overlay may be more celebratory:
winner name or placement;
trophy or game-specific symbol;
validated wins value when supplied by the result payload;
one clear “Play another match” action.
---
7. State language
Every app must visually distinguish these conditions.
State	Required treatment
Not joined	Join action and short introduction
Waiting	Occupied/open seats, ready state, no active-play controls
Ready	Clear ready acknowledgement; cannot imply readiness can be withdrawn
Playing, local turn	Gold control-panel highlight and enabled main action
Playing, other turn	Neutral panel and clear spectator-style instruction
Controller in another tab	Disable commands and offer Take control
Spectator	Neutral grey identity; no command controls
Reconnecting	Preserve human-readable context but do not send commands with stale match IDs
Finished	Result overlay and new-match action
Runtime failed	Stop input and offer a fresh join
Match not found	Clear local match state; never retry the old match ID
The same UI must tolerate lifecycle reversal, including `playing → waiting → playing` after membership changes.
---
8. Motion system
Motion should explain state changes rather than constantly decorate the interface.
8.1 Timing
Motion	Duration
Button response	120–180 ms
Panel/state transition	180–260 ms
Piece hop per step	90–150 ms
Dice roll	500–700 ms
Capture/send-home	650–950 ms
Safe-square effect	700–1,100 ms
Goal/home success	800–1,300 ms

Result celebration	3–5 seconds
8.2 Easing
Use energetic but controlled easing:
```css
cubic-bezier(.2, .82, .2, 1)
cubic-bezier(.16, .82, .32, 1)
ease-in-out
```
8.3 Signature feedback patterns
Valid selection
gentle pulse;
white outline;
seat-coloured glow.
Movement
short hops between authoritative positions;
never teleport unless reduced motion is enabled.
Capture or impact
quick spin or arc;
small board shake;
burst particles;
clear toast.
Safe state
shield/star graphic;
expanding ring;
one pawn bounce;
tile pulse.
Goal or home
upward burst;
warm gold highlight;
short success message.
Victory
confetti or game-specific particles;
celebratory overlay;
do not obscure the result action for the full animation.
8.4 Reduced motion
Respect `prefers-reduced-motion: reduce`:
remove repeated pulsing;
shorten movement to a simple fade/scale;
avoid board shake and large spinning motion;
retain clear state changes and text feedback.
---
9. Responsive behaviour
9.1 Wide layout
Recommended main layout:
```css
grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
```
Player rail at the side.
Arena fills remaining space.
Control panel spans the lower width.
9.2 Narrow layout
At approximately 760 px and below:
move the player rail into a four-column row;
place it below or above the arena consistently;
reduce avatar and card size;
hide secondary player details before hiding player names;
keep controls large enough for touch.
At approximately 430 px and below:
shorten instructions;
allow membership buttons to share available width;
keep primary action text readable;
avoid horizontal scrolling.
9.3 Touch targets
Preferred target: 44 × 44 px.
Absolute minimum for compact controls: 38 × 38 px.
Do not depend on hover.
Support pointer cancellation and visibility changes for held controls.
---
10. Accessibility
Every PocketArcade app should provide:
visible focus outlines;
semantic buttons rather than clickable generic elements;
`aria-label` for icon-only controls and board pieces;
`aria-live` for transient status;
text or icon support for colour-coded state;
sufficient contrast against dark panels;
initials fallback for avatars;
reduced-motion support;
no important instructions placed only inside animation.
Insert all player-controlled values using `textContent` or equivalent safe DOM methods.
---
11. Technical implementation rules
The visual system must sit on top of the PocketArcade game contract rather than replacing it.
11.1 CSS scoping
Every selector must begin below the app root:
```css
.pocket-example { }
.pocket-example\_\_board { }
.pocket-example\_\_player-card { }
```
Never style `body`, generic `button`, generic `.card`, or PocketArcade shell classes globally.
11.2 Asset policy
Use package-relative assets only.
Capture the asset base while the script evaluates.
Do not use remote fonts, CDNs or internet-hosted images.
Load assets before realtime play.
Keep SVG icons and vector effects compact.
11.3 Authoritative rendering
Snapshots contain recoverable full state.
Events trigger transient visual effects.
Commands express intent only.
Reject snapshots, events, results and errors for a different active `matchId`.
Reset the revision watermark whenever `matchId` changes.
Treat `you.role === "none"` and the client-only `closed` state as authoritative local cleanup signals.
11.4 Cleanup
The `mount()` cleanup function must:
unsubscribe every callback;
remove document listeners;
cancel timers and animation frames;
cancel active Web Animations;
stop audio and sensors;
release large buffers;
clear match-specific visual state.
11.5 Fullscreen
Enter fullscreen when active play benefits from it, normally after an explicit Ready or Play action. Do not request fullscreen automatically from `mount()`.
Use responsive sizing because the supplied container changes dimensions when fullscreen changes.
11.6 Performance
Avoid rebuilding large DOM trees every animation frame.
Use SVG groups for board pieces and effects.
Keep particle counts bounded.
Avoid filters on many moving elements simultaneously.
Do not use expensive layout reads inside tight animation loops.
Keep all effects recoverable if an event is missed; the next snapshot remains the truth.
---
12. Reusable starter tokens
Use app-specific names while keeping the shared values:
```css
.pocket-example {
  --pa-bg: #151226;
  --pa-panel: #211c38;
  --pa-panel-raised: #2c2548;
  --pa-ink: #fffaf2;
  --pa-muted: #bdb7ce;
  --pa-line: rgba(255, 255, 255, .11);

  --pa-seat-1: #ef5d67;
  --pa-seat-1-dark: #b62f49;
  --pa-seat-1-soft: #ffd3d0;
  --pa-seat-2: #21b88c;
  --pa-seat-2-dark: #08775f;
  --pa-seat-2-soft: #c8f6df;
  --pa-seat-3: #f5b83d;
  --pa-seat-3-dark: #b66d08;
  --pa-seat-3-soft: #fff0ae;
  --pa-seat-4: #8067ed;
  --pa-seat-4-dark: #5136b6;
  --pa-seat-4-soft: #ded6ff;

  --pa-radius-app: 26px;
  --pa-radius-panel: 22px;
  --pa-radius-card: 16px;
  --pa-radius-control: 13px;

  position: relative;
  display: flex;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--pa-radius-app);
  color: var(--pa-ink);
  background: var(--pa-bg);
  font-family: ui-rounded, "Trebuchet MS", system-ui, sans-serif;
}
```
A complete starter token stylesheet is supplied alongside this guide.
---
13. Naming convention
Use BEM-like component names scoped by the application ID:
```text
.pocket-racer
.pocket-racer\_\_topbar
.pocket-racer\_\_player-card
.pocket-racer\_\_arena
.pocket-racer\_\_controls
.pocket-racer\_\_primary-button
.pocket-racer\_\_toast

.is-current
.is-visible
.is-legal
.is-disabled
.is-spectator
.is-reconnecting
```
Rules:
Components use `\_\_`.
Local states use `is-`.
Seat identity uses `.seat-1` through `.seat-4`.
Avoid deeply nested selectors.
Avoid names tied to one screen size.
---
14. Writing style
PocketArcade copy should be short, active and friendly.
Preferred:
“Roll the dice”
“Choose a glowing pawn”
“Ready — waiting for rivals”
“Take control here”
“That match has closed”
Avoid:
long rules paragraphs during play;
technical transport language;
blame-oriented errors;
ambiguous labels such as “OK” when a specific action is available.
Use player names where it adds useful context, but keep game state understandable without them.
---
15. Do and do not
Do
Use the shared dark shell and four-seat palette.
Give the game itself a distinctive board, arena or character style.
Highlight only the local actionable region.
Keep player identity visible.
Use server events for short effects.
Use snapshots for all recoverable state.
Provide clear waiting, spectator and controller states.
Test at 320 px width and fullscreen.
Do not
Cover the playfield with permanent turn boxes.
Grey out controls by fading their entire surface.
Use emoji as the only rendering for dice, cards or critical game symbols.
Animate positioned SVG groups in a way that overwrites their placement transform.
Show empty player seats during active play.
Style spectators with active seat colours.
depend on hover, external assets or a browser fullscreen permission prompt.
send commands from stale match state.
---
16. App review checklist
Visual consistency
[ ] Dark PocketArcade shell and light/clear play surface.
[ ] Shared four-player palette where applicable.
[ ] Rounded panels, controls and identity pills.
[ ] Local turn highlighted with gold, not a global colour wash.
[ ] Open seats labelled “Open Seat”.
[ ] Spectators rendered in neutral grey.
[ ] Important state is not communicated by colour alone.
Interaction
[ ] One obvious main action at a time.
[ ] Touch targets are at least 38 px, preferably 44 px.
[ ] Inactive controls retain their material and identity.
[ ] Controller-in-another-tab state is visible.
[ ] All transient events have concise feedback.
[ ] Reduced-motion behaviour is present.
Responsive layout
[ ] Wide player rail and narrow player row both work.
[ ] Board or arena remains legible at 320 px.
[ ] No important control sits beneath the shell fullscreen exit area.
[ ] No horizontal scrolling is required.
PocketArcade integration
[ ] All CSS is app-scoped.
[ ] No internet dependencies.
[ ] Every incoming envelope checks `matchId`.
[ ] Revision state resets on a new match.
[ ] `you.role === "none"` clears local state.
[ ] Connection loss prevents stale commands.
[ ] Cleanup releases subscriptions, timers, animations and listeners.
[ ] Final visual state is broadcast before `match.finish()`.
---
17. Recommended source hierarchy
When a design decision conflicts with platform behaviour, use this order:
PocketArcade firmware/game-package contract.
Authoritative game rules and snapshot model.
Accessibility and input reliability.
This shared style guide.
Game-specific visual flair.
The style system should make the platform clearer, never conceal or contradict authoritative state.

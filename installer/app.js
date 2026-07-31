const boardsContainer = document.querySelector("#boards");
const versionLabel = document.querySelector("#version");

function definition(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  return wrapper;
}

function boardCard(board) {
  const article = document.createElement("article");
  article.className = "board-card";

  const badge = document.createElement("span");
  badge.className = `status status--${board.status}`;
  badge.textContent = board.status;

  const heading = document.createElement("h3");
  heading.textContent = board.name;

  const details = document.createElement("dl");
  details.append(
    definition("Flash", board.hardware.flash),
    definition("PSRAM", board.hardware.psram),
    definition("microSD", board.hardware.sdCard),
  );

  const notes = document.createElement("p");
  notes.className = "notes";
  notes.textContent = board.notes;

  if (board.status === "provisional") {
    const caution = document.createElement("p");
    caution.className = "profile-caution";
    caution.textContent =
      "Provisional profile: verify the board model and PCB revision before flashing.";
    article.append(badge, heading, details, notes, caution);
  } else {
    article.append(badge, heading, details, notes);
  }

  const installer = document.createElement("esp-web-install-button");
  installer.setAttribute("manifest", board.manifest);

  const activate = document.createElement("button");
  activate.slot = "activate";
  activate.type = "button";
  activate.textContent = "Connect and install";

  const unsupported = document.createElement("p");
  unsupported.slot = "unsupported";
  unsupported.className = "unsupported";
  unsupported.textContent =
    "Web Serial is unavailable. Open this page in desktop Chrome or Edge.";

  const notAllowed = document.createElement("p");
  notAllowed.slot = "not-allowed";
  notAllowed.className = "unsupported";
  notAllowed.textContent =
    "Serial access requires this installer to be served over HTTPS.";

  installer.append(activate, unsupported, notAllowed);
  article.append(installer);
  return article;
}

async function loadBoards() {
  try {
    const response = await fetch("boards.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalogue = await response.json();
    versionLabel.textContent = `Firmware ${catalogue.version}`;
    boardsContainer.replaceChildren(...catalogue.boards.map(boardCard));
  } catch (error) {
    boardsContainer.innerHTML = "";
    const message = document.createElement("p");
    message.className = "load-error";
    message.textContent =
      "Board profiles could not be loaded. Please refresh the page or try again later.";
    boardsContainer.append(message);
    console.error("Unable to load PocketArcade board profiles", error);
  }
}

loadBoards();

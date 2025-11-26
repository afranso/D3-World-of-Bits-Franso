// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./_leafletWorkaround.ts";
import _luck from "./_luck.ts";

declare global {
  // global move function for controllers
  // (top-level declaration to satisfy TS)
  // eslint-disable-next-line no-var
  var __game_move: ((di: number, dj: number) => void) | undefined;
}

// === Simple UI setup ===
const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
document.body.append(controlPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

// Victory overlay
const overlay = document.createElement("div");
overlay.id = "victoryOverlay";
overlay.style.display = "none";
overlay.innerHTML = `
  <div id="victoryCard">
    <h2>Victory!</h2>
    <p id="victoryText"></p>
    <button id="restartButton">Restart</button>
  </div>
`;
document.body.append(overlay);

// === Game constants ===
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const RENDER_RADIUS = 12;
const INTERACT_RANGE = 3;

const TOKEN_SPAWN_PROBABILITY = 0.12;
const TARGET_VALUE_NOTIFY = 8;
const TARGET_MAX_TOKEN = 32;

const FALLBACK_LATLNG = leaflet.latLng(36.997936938057016, -122.05703507501151);

// === Player state ===
let PLAYER_START_LATLNG = FALLBACK_LATLNG;
let playerLatLng = PLAYER_START_LATLNG;
// tell TypeScript these will be assigned in setupMap()
let map!: leaflet.Map;
let playerMarker!: leaflet.Marker;
let playerPoints = 0;
let heldToken: number | null = null;

// movement mode: "gps" | "buttons"
let movementMode: "gps" | "buttons" = "gps";

// === Flyweight: only modified cells are stored here ===
const modifiedCells = new Map<string, number | null>();

// === Helpers ===
function cellKey(i: number, j: number) {
  return `${i},${j}`;
}

function latLngToCell(lat: number, lng: number) {
  const dlat = lat - PLAYER_START_LATLNG.lat;
  const dlng = lng - PLAYER_START_LATLNG.lng;
  return {
    i: Math.floor(dlat / TILE_DEGREES),
    j: Math.floor(dlng / TILE_DEGREES),
  };
}

function cellBounds(i: number, j: number) {
  return leaflet.latLngBounds(
    [
      PLAYER_START_LATLNG.lat + i * TILE_DEGREES,
      PLAYER_START_LATLNG.lng + j * TILE_DEGREES,
    ],
    [
      PLAYER_START_LATLNG.lat + (i + 1) * TILE_DEGREES,
      PLAYER_START_LATLNG.lng + (j + 1) * TILE_DEGREES,
    ],
  );
}

function randomFast() {
  try {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] / 0xffffffff;
  } catch {
    return Math.random();
  }
}

function canInteract(i: number, j: number) {
  const p = latLngToCell(playerLatLng.lat, playerLatLng.lng);
  return (
    Math.abs(i - p.i) <= INTERACT_RANGE &&
    Math.abs(j - p.j) <= INTERACT_RANGE
  );
}

// === Simple UI update ===
function updateStatus() {
  const holding = heldToken === null
    ? "Empty hand"
    : `Holding token: ${heldToken}`;
  statusPanelDiv.innerHTML = `${holding} — Points: ${playerPoints}`;

  // movement toggle + new game button
  ensureControlButtons();

  if (heldToken !== null && heldToken >= TARGET_VALUE_NOTIFY) {
    if (!document.getElementById("notify")) {
      const alert = document.createElement("div");
      alert.id = "notify";
      alert.textContent = `High token (${heldToken})!`;
      statusPanelDiv.append(alert);
    }
  } else {
    const n = document.getElementById("notify");
    if (n) n.remove();
  }
}

// === Flyweight + Memento: get token for a cell ===
function getCellToken(i: number, j: number): number | null {
  const key = cellKey(i, j);

  if (modifiedCells.has(key)) {
    return modifiedCells.get(key)!;
  }

  let token: number | null = null;

  if (randomFast() < TOKEN_SPAWN_PROBABILITY) {
    token = 2 ** (1 + Math.floor(randomFast() * 5));
  }

  modifiedCells.set(key, token);
  return token;
}

// === Memento save ===
function saveCell(i: number, j: number, value: number | null) {
  modifiedCells.set(cellKey(i, j), value);
  saveGameState();
}

// === Render one cell ===
function renderCell(i: number, j: number) {
  const token = getCellToken(i, j);
  const bounds = cellBounds(i, j);

  const rect = leaflet.rectangle(bounds, {
    color: "#444",
    weight: 1,
    fillOpacity: token ? 0.6 : 0.0,
    fillColor: token ? "#f1c40f" : undefined,
  }).addTo(map);

  const lat = PLAYER_START_LATLNG.lat + (i + 0.5) * TILE_DEGREES;
  const lng = PLAYER_START_LATLNG.lng + (j + 0.5) * TILE_DEGREES;

  const icon = leaflet.divIcon({
    className: "cell-div-icon",
    html: token !== null
      ? `<div class="cell-label token">${token}</div>`
      : `<div class="cell-label empty"></div>`,
    iconSize: [0, 0],
  });

  const label = leaflet.marker([lat, lng], { icon, interactive: false }).addTo(
    map,
  );

  rect.on("click", () => {
    if (!canInteract(i, j)) return;

    const newToken = getCellToken(i, j);

    if (heldToken === null) {
      if (newToken !== null) {
        heldToken = newToken;
        saveCell(i, j, null);
        playerPoints++;
      }
    } else {
      if (newToken === null) {
        saveCell(i, j, heldToken);
        heldToken = null;
      } else if (newToken === heldToken) {
        const merged = heldToken * 2;
        saveCell(i, j, null);
        heldToken = merged;
        playerPoints += 2;
      }
    }

    checkVictory();
    updateStatus();
    saveGameState();
    map.removeLayer(rect);
    map.removeLayer(label);
    renderCell(i, j);
  });

  if (!canInteract(i, j)) {
    rect.setStyle({ dashArray: "4", opacity: 0.5 });
    label.getElement()?.classList.add("muted");
  }
}

// === Render visible cells ===
interface MapWithLayers extends leaflet.Map {
  _layers: Record<string, leaflet.Layer>;
}

function renderVisibleCells() {
  const c = latLngToCell(playerLatLng.lat, playerLatLng.lng);

  const mapWithLayers = map as MapWithLayers;

  for (const layer of Object.values(mapWithLayers._layers)) {
    if (
      layer instanceof leaflet.Rectangle ||
      (layer instanceof leaflet.Marker && layer !== playerMarker)
    ) {
      map.removeLayer(layer);
    }
  }

  for (let di = -RENDER_RADIUS; di <= RENDER_RADIUS; di++) {
    for (let dj = -RENDER_RADIUS; dj <= RENDER_RADIUS; dj++) {
      renderCell(c.i + di, c.j + dj);
    }
  }
}

// === Movement Controller Facade ===
interface MovementController {
  start(): void;
  stop(): void;
}

let movementController: MovementController | null = null;

// === Button movement controller ===
class ButtonMovementController implements MovementController {
  private keyHandler = (ev: KeyboardEvent) => {
    if (overlay.style.display === "block") return;
    switch (ev.key) {
      case "ArrowUp":
      case "w":
      case "W":
        move(1, 0);
        ev.preventDefault();
        break;
      case "ArrowDown":
      case "s":
      case "S":
        move(-1, 0);
        ev.preventDefault();
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        move(0, -1);
        ev.preventDefault();
        break;
      case "ArrowRight":
      case "d":
      case "D":
        move(0, 1);
        ev.preventDefault();
        break;
    }
  };

  start() {
    globalThis.addEventListener("keydown", this.keyHandler);
  }
  stop() {
    globalThis.removeEventListener("keydown", this.keyHandler);
  }
}

// === Geo movement controller ===
class GeoMovementController implements MovementController {
  private watchId: number | null = null;

  start() {
    if (!navigator.geolocation) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        playerLatLng = leaflet.latLng(lat, lng);

        // only re-center map when in GPS mode; keep dragging available
        if (movementMode === "gps") {
          map.setView(playerLatLng, GAMEPLAY_ZOOM_LEVEL, { animate: false });
          playerMarker.setLatLng(playerLatLng);
        }

        renderVisibleCells();
        saveGameState();
      },
      (err) => {
        console.warn("GPS error", err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000,
      },
    );
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

// === Map setup ===
function setupMap() {
  map = leaflet.map(mapDiv, {
    center: PLAYER_START_LATLNG,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: true,
  });

  leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);

  playerMarker = leaflet.marker(playerLatLng, { interactive: false }).addTo(
    map,
  );

  renderVisibleCells();
  updateStatus();

  // map dragging updates player only in button mode
  map.on("moveend", () => {
    if (movementMode === "buttons") {
      playerLatLng = map.getCenter();
      playerMarker.setLatLng(playerLatLng);
      renderVisibleCells();
      saveGameState();
    } else {
      // GPS mode: do not treat map moves as player moves
    }
  });

  const PAN_TILES = 1;
  function localMove(di: number, dj: number) {
    map.setView(
      [
        map.getCenter().lat + di * TILE_DEGREES * PAN_TILES,
        map.getCenter().lng + dj * TILE_DEGREES * PAN_TILES,
      ],
      GAMEPLAY_ZOOM_LEVEL,
      { animate: false },
    );
  }

  // expose move for controllers
  globalThis.__game_move = localMove;

  // attach restart button already in overlay (victory)
  document.getElementById("restartButton")?.addEventListener(
    "click",
    restartGame,
  );
}

// === Victory ===
function showVictoryScreen() {
  const vt = document.getElementById("victoryText");
  if (vt) {
    vt.textContent =
      `You crafted a ${heldToken} token! Points: ${playerPoints}`;
  }
  overlay.style.display = "block";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.background = "white";
  overlay.style.zIndex = "1000";
}

function checkVictory() {
  if (heldToken !== null && heldToken >= TARGET_MAX_TOKEN) {
    showVictoryScreen();
  }
}

// === New Game / Restart ===
function restartGame() {
  overlay.style.display = "none";
  playerPoints = 0;
  heldToken = null;
  modifiedCells.clear();
  // reset start to current playerLatLng (so grid recenters at current spot)
  PLAYER_START_LATLNG = playerLatLng.clone();
  map.setView(PLAYER_START_LATLNG, GAMEPLAY_ZOOM_LEVEL, { animate: false });
  playerLatLng = PLAYER_START_LATLNG.clone();
  playerMarker.setLatLng(playerLatLng);
  renderVisibleCells();
  updateStatus();
  saveGameState();
}

// === Control panel buttons ===
function ensureControlButtons() {
  // add New Game button and Movement toggle inside control panel
  if (!document.getElementById("newGameButton")) {
    const btn = document.createElement("button");
    btn.id = "newGameButton";
    btn.textContent = "New Game";
    btn.style.marginRight = "8px";
    btn.addEventListener("click", () => {
      // confirm
      if (confirm("Start a new game? This will erase saved progress.")) {
        clearSavedState();
        location.reload();
      }
    });
    controlPanelDiv.appendChild(btn);
  }

  if (!document.getElementById("movementToggle")) {
    const t = document.createElement("button");
    t.id = "movementToggle";
    t.addEventListener("click", () => {
      toggleMovementMode();
    });
    controlPanelDiv.appendChild(t);
  }

  // update movement toggle label
  const toggle = document.getElementById("movementToggle") as
    | HTMLButtonElement
    | null;
  if (toggle) {
    toggle.textContent = movementMode === "gps"
      ? "Movement: GPS"
      : "Movement: Keys";
  }
}

// === Movement mode switching ===
function setMovementMode(mode: "gps" | "buttons", persist = true) {
  if (movementController) {
    movementController.stop();
    movementController = null;
  }

  movementMode = mode;

  if (mode === "gps") {
    movementController = new GeoMovementController();
  } else {
    movementController = new ButtonMovementController();
  }

  movementController.start();

  // keys should be disabled when in gps mode (we already remove/add handlers)
  // ensure map dragging remains available in both modes

  updateStatus();

  if (persist) {
    saveGameState();
  }
}

function toggleMovementMode() {
  const next = movementMode === "gps" ? "buttons" : "gps";
  setMovementMode(next);
}

// expose move function for button controller to call via global (cleaner wiring)
function move(di: number, dj: number) {
  const fn = globalThis.__game_move;
  if (fn) fn(di, dj);
}

// === Geolocation start ===
function getPosition(timeout = 5000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject("No geolocation");
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout,
      enableHighAccuracy: true,
    });
  });
}

// === Persistence (localStorage) ===
const STORAGE_KEY = "mygame_state_v1";

function serializeState() {
  // convert modifiedCells to array
  const cells: Array<[string, number | null]> = [];
  for (const [k, v] of modifiedCells) cells.push([k, v]);
  return JSON.stringify({
    PLAYER_START_LATLNG: {
      lat: PLAYER_START_LATLNG.lat,
      lng: PLAYER_START_LATLNG.lng,
    },
    playerLatLng: { lat: playerLatLng.lat, lng: playerLatLng.lng },
    playerPoints,
    heldToken,
    modifiedCells: cells,
    movementMode,
  });
}

function saveGameState() {
  try {
    const s = serializeState();
    localStorage.setItem(STORAGE_KEY, s);
  } catch (e) {
    console.warn("Failed to save state", e);
  }
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

function loadGameState(): boolean {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return false;
    const obj = JSON.parse(s);

    if (obj.PLAYER_START_LATLNG) {
      PLAYER_START_LATLNG = leaflet.latLng(
        obj.PLAYER_START_LATLNG.lat,
        obj.PLAYER_START_LATLNG.lng,
      );
    }
    if (obj.playerLatLng) {
      playerLatLng = leaflet.latLng(obj.playerLatLng.lat, obj.playerLatLng.lng);
    } else {
      playerLatLng = PLAYER_START_LATLNG.clone();
    }

    playerPoints = typeof obj.playerPoints === "number" ? obj.playerPoints : 0;
    heldToken = typeof obj.heldToken === "number" ? obj.heldToken : null;

    modifiedCells.clear();
    if (Array.isArray(obj.modifiedCells)) {
      for (const [k, v] of obj.modifiedCells) {
        modifiedCells.set(k, v);
      }
    }

    movementMode = obj.movementMode === "buttons" ? "buttons" : "gps";
    return true;
  } catch (e) {
    console.warn("Failed to load state", e);
    return false;
  }
}

// === Startup ===
(async () => {
  // attempt to restore saved game
  const hasSaved = loadGameState();

  if (!hasSaved) {
    try {
      const pos = await getPosition(7000);
      PLAYER_START_LATLNG = leaflet.latLng(
        pos.coords.latitude,
        pos.coords.longitude,
      );
    } catch {
      PLAYER_START_LATLNG = FALLBACK_LATLNG;
    }
    playerLatLng = PLAYER_START_LATLNG.clone();
  } else {
    // if saved, PLAYER_START_LATLNG and playerLatLng are already set
  }

  setupMap();

  // ensure control buttons present and reflect mode
  ensureControlButtons();

  // start correct movement controller
  setMovementMode(movementMode, false);

  // center map appropriately
  map.setView(playerLatLng, GAMEPLAY_ZOOM_LEVEL, { animate: false });
  playerMarker.setLatLng(playerLatLng);

  renderVisibleCells();
  updateStatus();

  // if we restored from saved state, redraw and ensure persisted state up-to-date
  saveGameState();
})();

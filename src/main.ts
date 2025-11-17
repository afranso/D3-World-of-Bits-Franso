// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./_leafletWorkaround.ts";
import _luck from "./_luck.ts";

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

  map.on("moveend", () => {
    playerLatLng = map.getCenter();
    playerMarker.setLatLng(playerLatLng);
    renderVisibleCells();
  });

  const PAN_TILES = 1;
  function move(di: number, dj: number) {
    map.setView(
      [
        map.getCenter().lat + di * TILE_DEGREES * PAN_TILES,
        map.getCenter().lng + dj * TILE_DEGREES * PAN_TILES,
      ],
      GAMEPLAY_ZOOM_LEVEL,
      { animate: false },
    );
  }

  addEventListener("keydown", (ev) => {
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
  });

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

function restartGame() {
  overlay.style.display = "none";
  playerPoints = 0;
  heldToken = null;
  modifiedCells.clear();
  map.setView(PLAYER_START_LATLNG, GAMEPLAY_ZOOM_LEVEL, { animate: false });
  playerLatLng = PLAYER_START_LATLNG;
  playerMarker.setLatLng(playerLatLng);
  renderVisibleCells();
  updateStatus();
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

(async () => {
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
  setupMap();
})();

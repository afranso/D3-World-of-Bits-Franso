// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./_leafletWorkaround.ts";
import _luck from "./_luck.ts";

const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
document.body.append(controlPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

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

const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const RENDER_RADIUS = 12;
const INTERACT_RANGE = 3;
const TOKEN_SPAWN_PROBABILITY = 0.12;
const TARGET_VALUE_NOTIFY = 8;
const TARGET_MAX_TOKEN = 32;
const FALLBACK_LATLNG = leaflet.latLng(36.997936938057016, -122.05703507501151);

let PLAYER_START_LATLNG: leaflet.LatLng = FALLBACK_LATLNG;
let playerLatLng: leaflet.LatLng = PLAYER_START_LATLNG;
let map: leaflet.Map;
let playerMarker: leaflet.Marker;
let playerPoints = 0;
let heldToken: number | null = null;

type CellInfo = {
  i: number;
  j: number;
  value: number | null;
  rect: leaflet.Rectangle;
  label?: leaflet.Marker;
};
const cellMap = new Map<string, CellInfo>();

function cellKey(i: number, j: number) {
  return `${i},${j}`;
}

function latLngToCell(lat: number, lng: number) {
  const dlat = lat - PLAYER_START_LATLNG.lat;
  const dlng = lng - PLAYER_START_LATLNG.lng;
  const i = Math.floor(dlat / TILE_DEGREES);
  const j = Math.floor(dlng / TILE_DEGREES);
  return { i, j };
}

function cellToBounds(i: number, j: number) {
  const sw = [
    PLAYER_START_LATLNG.lat + i * TILE_DEGREES,
    PLAYER_START_LATLNG.lng + j * TILE_DEGREES,
  ] as [number, number];
  const ne = [
    PLAYER_START_LATLNG.lat + (i + 1) * TILE_DEGREES,
    PLAYER_START_LATLNG.lng + (j + 1) * TILE_DEGREES,
  ] as [number, number];
  return leaflet.latLngBounds([sw, ne]);
}

function ephemeralRandom(): number {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] / 0xffffffff;
    }
  } catch {
    /* ignore */
  }
  return Math.random();
}

function canInteract(i: number, j: number) {
  const p = latLngToCell(playerLatLng.lat, playerLatLng.lng);
  return Math.abs(i - p.i) <= INTERACT_RANGE &&
    Math.abs(j - p.j) <= INTERACT_RANGE;
}

function updateStatusPanel() {
  const holding = heldToken === null
    ? "Empty hand"
    : `Holding token: ${heldToken}`;
  statusPanelDiv.innerHTML = `${holding} — Points: ${playerPoints}`;
  if (heldToken !== null && heldToken >= TARGET_VALUE_NOTIFY) {
    if (!document.getElementById("notify")) {
      const notify = document.createElement("div");
      notify.id = "notify";
      notify.textContent = `High token (${heldToken})!`;
      statusPanelDiv.appendChild(notify);
    }
  } else {
    const n = document.getElementById("notify");
    if (n) n.remove();
  }
}

function createLabelMarker(i: number, j: number, value: number | null) {
  const lat = PLAYER_START_LATLNG.lat + (i + 0.5) * TILE_DEGREES;
  const lng = PLAYER_START_LATLNG.lng + (j + 0.5) * TILE_DEGREES;
  const content = value === null
    ? `<div class="cell-label empty"></div>`
    : `<div class="cell-label token">${value}</div>`;
  const icon = leaflet.divIcon({
    className: "cell-div-icon",
    html: content,
    iconSize: [0, 0],
  });
  return leaflet.marker([lat, lng], { icon, interactive: false });
}

function renderCell(i: number, j: number) {
  const bounds = cellToBounds(i, j);
  const rect = leaflet.rectangle(bounds, {
    color: "#444",
    weight: 1,
    fillOpacity: 0.0,
  }).addTo(map);
  const key = cellKey(i, j);

  const hasToken = ephemeralRandom() < TOKEN_SPAWN_PROBABILITY;
  let val: number | null = null;
  if (hasToken) val = 2 ** (1 + Math.floor(ephemeralRandom() * 5));

  const label = createLabelMarker(i, j, val);
  label.addTo(map);

  const info: CellInfo = { i, j, value: val, rect, label };
  cellMap.set(key, info);

  function refresh() {
    if (info.value !== null) {
      rect.setStyle({ fillColor: "#f1c40f", fillOpacity: 0.6 });
    } else rect.setStyle({ fillOpacity: 0.0 });
    if (!canInteract(i, j)) {
      rect.setStyle({ dashArray: "4", opacity: 0.5 });
      info.label?.getElement()?.classList.add("muted");
    } else {
      rect.setStyle({ dashArray: undefined, opacity: 1.0 });
      info.label?.getElement()?.classList.remove("muted");
    }
    const el = info.label?.getElement();
    if (el) {
      el.innerHTML = info.value === null
        ? `<div class="cell-label empty"></div>`
        : `<div class="cell-label token">${info.value}</div>`;
    }
  }
  refresh();

  rect.on("click", () => {
    if (!canInteract(i, j)) return;
    if (heldToken === null) {
      if (info.value !== null) {
        heldToken = info.value;
        info.value = null;
        playerPoints++;
        refresh();
        updateStatusPanel();
        checkVictory();
      }
    } else {
      if (info.value === null) {
        info.value = heldToken;
        heldToken = null;
        refresh();
        updateStatusPanel();
      } else if (info.value === heldToken) {
        const newVal = heldToken * 2;
        info.value = null;
        heldToken = newVal;
        playerPoints += 2;
        refresh();
        updateStatusPanel();
        checkVictory();
      }
    }
  });
}

function renderVisibleCells() {
  const c = latLngToCell(playerLatLng.lat, playerLatLng.lng);
  const desired = new Set<string>();
  for (let di = -RENDER_RADIUS; di <= RENDER_RADIUS; di++) {
    for (let dj = -RENDER_RADIUS; dj <= RENDER_RADIUS; dj++) {
      const i = c.i + di;
      const j = c.j + dj;
      const key = cellKey(i, j);
      desired.add(key);
      if (!cellMap.has(key)) renderCell(i, j);
    }
  }
  for (const [k, c] of Array.from(cellMap.entries())) {
    if (!desired.has(k)) {
      map.removeLayer(c.rect);
      if (c.label) map.removeLayer(c.label);
      cellMap.delete(k);
    }
  }
}

function setupMapAndRender() {
  map = leaflet.map(mapDiv, {
    center: PLAYER_START_LATLNG,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: false,
  });

  leaflet
    .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>',
    })
    .addTo(map);

  playerMarker = leaflet.marker(playerLatLng, { interactive: false });
  playerMarker.addTo(map);

  renderVisibleCells();
  updateStatusPanel();

  map.on("moveend", () => {
    playerLatLng = map.getCenter();
    playerMarker.setLatLng(playerLatLng);
    renderVisibleCells();
  });

  const PAN_TILES = 1;
  function panByTiles(di: number, dj: number) {
    const newLat = map.getCenter().lat + di * TILE_DEGREES * PAN_TILES;
    const newLng = map.getCenter().lng + dj * TILE_DEGREES * PAN_TILES;
    map.setView([newLat, newLng], GAMEPLAY_ZOOM_LEVEL, { animate: false });
  }

  globalThis.addEventListener("keydown", (ev) => {
    if (overlay.style.display === "block") return;
    switch (ev.key) {
      case "ArrowUp":
      case "w":
      case "W":
        panByTiles(1, 0);
        ev.preventDefault();
        break;
      case "ArrowDown":
      case "s":
      case "S":
        panByTiles(-1, 0);
        ev.preventDefault();
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        panByTiles(0, -1);
        ev.preventDefault();
        break;
      case "ArrowRight":
      case "d":
      case "D":
        panByTiles(0, 1);
        ev.preventDefault();
        break;
    }
  });

  const restartButton = document.getElementById("restartButton");
  if (restartButton) {
    restartButton.addEventListener("click", () => restartGame());
  }
}

function checkVictory() {
  if (heldToken !== null && heldToken >= TARGET_MAX_TOKEN) showVictoryScreen();
}

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

function restartGame() {
  overlay.style.display = "none";
  playerPoints = 0;
  heldToken = null;
  for (const [, c] of Array.from(cellMap.entries())) {
    map.removeLayer(c.rect);
    if (c.label) map.removeLayer(c.label);
  }
  cellMap.clear();
  playerLatLng = PLAYER_START_LATLNG.clone();
  map.setView(playerLatLng, GAMEPLAY_ZOOM_LEVEL, { animate: false });
  playerMarker.setLatLng(playerLatLng);
  renderVisibleCells();
  updateStatusPanel();
}

function getCurrentPositionPromise(
  timeout = 5000,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("No geolocation"));
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout,
      maximumAge: 0,
    };
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

(async () => {
  try {
    const pos = await getCurrentPositionPromise(7000);
    PLAYER_START_LATLNG = leaflet.latLng(
      pos.coords.latitude,
      pos.coords.longitude,
    );
  } catch {
    PLAYER_START_LATLNG = FALLBACK_LATLNG;
  }
  playerLatLng = PLAYER_START_LATLNG.clone();
  setupMapAndRender();
})();

declare global {
  var cellMap: Map<string, CellInfo> | undefined;
  var heldToken: number | null | undefined;
}
globalThis.cellMap = cellMap;
globalThis.heldToken = heldToken;

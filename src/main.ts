// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style

// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images

// Import our luck function
import luck from "./_luck.ts";

// Create basic UI elements

const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
document.body.append(controlPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

// Fallback classroom location (used if geolocation is unavailable)
const FALLBACK_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const RENDER_RADIUS = 60; // how many cells to render visually (makes the world look filled)
const INTERACT_RANGE = 3; // how many cells away the player can act
const TOKEN_SPAWN_PROBABILITY = 0.12; // deterministic via luck
const TARGET_VALUE_NOTIFY = 8; // notify when player holds this value or higher

// We'll set origin to the player's current location (or fallback)
let ORIGIN_LATLNG: leaflet.LatLng = FALLBACK_LATLNG;

// Create the map variable; we'll initialize it after we have the location
let map: leaflet.Map;

// Add player marker variable
let playerMarker: leaflet.Marker;

// Game state
let playerPoints = 0;
let heldToken: number | null = null;

// token storage keyed by "i,j"
type CellInfo = {
  i: number;
  j: number;
  value: number | null; // null if no token
  rect: leaflet.Rectangle;
  label?: leaflet.Marker;
};
const cellMap = new Map<string, CellInfo>();

function cellKey(i: number, j: number) {
  return `${i},${j}`;
}

function canInteract(i: number, j: number) {
  return Math.abs(i) <= INTERACT_RANGE && Math.abs(j) <= INTERACT_RANGE;
}

function updateStatusPanel() {
  const holding = heldToken === null
    ? "Empty hand"
    : `Holding token: ${heldToken}`;
  statusPanelDiv.innerHTML = `${holding} — Points: ${playerPoints}`;
  if (heldToken !== null && heldToken >= TARGET_VALUE_NOTIFY) {
    const notify = document.createElement("div");
    notify.id = "notify";
    notify.textContent = `You have a high-value token (${heldToken})!`;
    // keep single notify element
    if (!document.getElementById("notify")) statusPanelDiv.appendChild(notify);
  } else {
    const n = document.getElementById("notify");
    if (n) n.remove();
  }
}

// Create or update a label marker for a cell so contents are visible without clicking
function createLabelMarker(i: number, j: number, value: number | null) {
  const lat = ORIGIN_LATLNG.lat + (i + 0.5) * TILE_DEGREES;
  const lng = ORIGIN_LATLNG.lng + (j + 0.5) * TILE_DEGREES;
  const content = value === null
    ? `<div class="cell-label empty"></div>`
    : `<div class="cell-label token">${value}</div>`;

  const icon = leaflet.divIcon({
    className: "cell-div-icon",
    html: content,
    iconSize: [0, 0],
  });

  const marker = leaflet.marker([lat, lng], { icon, interactive: false });
  return marker;
}

// Render a single cell and attach interaction handlers
function renderCell(i: number, j: number) {
  const origin = ORIGIN_LATLNG;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  const rect = leaflet.rectangle(bounds, {
    color: "#444",
    weight: 1,
    fillOpacity: 0.0,
  }).addTo(map);

  const key = cellKey(i, j);

  // Determine deterministic initial token using only i,j as seed to be stable across loads
  const seed = `${i},${j},token`;
  const hasToken = luck(seed) < TOKEN_SPAWN_PROBABILITY;
  const initialValue = hasToken
    ? 2 ** (1 + Math.floor(luck(`${i},${j},value`) * 3)) // values: 2,4,8
    : null;

  const label = createLabelMarker(i, j, initialValue);
  label.addTo(map);

  const info: CellInfo = {
    i,
    j,
    value: initialValue,
    rect,
    label,
  };
  cellMap.set(key, info);

  // Tooltip to show coordinates and token value (optional, contents already visible)
  rect.bindTooltip(() => {
    const valText = info.value === null ? "empty" : `token ${info.value}`;
    return `${i},${j} — ${valText}`;
  });

  // style updater (updates rectangle and label content/visibility)
  function refreshStyle() {
    if (info.value !== null) {
      info.rect.setStyle({ fillColor: "#f1c40f", fillOpacity: 0.6 });
    } else {
      info.rect.setStyle({ fillOpacity: 0.0 });
    }
    // show whether interactable
    if (!canInteract(i, j)) {
      info.rect.setStyle({ dashArray: "4", opacity: 0.5 });
      if (info.label) info.label.getElement()?.classList.add("muted");
    } else {
      info.rect.setStyle({ dashArray: undefined, opacity: 1.0 });
      if (info.label) info.label.getElement()?.classList.remove("muted");
    }
    // update label HTML to reflect current value
    if (info.label) {
      const el = info.label.getElement();
      if (el) {
        if (info.value === null) {
          el.innerHTML = `<div class="cell-label empty"></div>`;
        } else {
          el.innerHTML = `<div class="cell-label token">${info.value}</div>`;
        }
      }
    }
  }
  refreshStyle();

  // Handle clicks for pick/place/craft
  rect.on("click", () => {
    // Only allow interaction when in range
    if (!canInteract(i, j)) {
      // small feedback: briefly flash border
      info.rect.setStyle({ color: "#ff0000" });
      setTimeout(() => info.rect.setStyle({ color: "#444" }), 250);
      return;
    }

    if (heldToken === null) {
      // Try to pick up a token from the cell
      if (info.value !== null) {
        heldToken = info.value;
        info.value = null;
        playerPoints++; // picking up yields a point
        refreshStyle();
        updateStatusPanel();
      } else {
        // nothing to pick up
      }
    } else {
      // Player is holding a token: attempt to place or craft
      if (info.value === null) {
        // place token into cell
        info.value = heldToken;
        heldToken = null;
        refreshStyle();
        updateStatusPanel();
      } else if (info.value === heldToken) {
        // craft: consume both and create a doubled token into the player's hand
        const newValue = heldToken * 2;
        // remove token from cell and update hand to doubled value
        info.value = null;
        heldToken = newValue;
        playerPoints += 2; // reward crafting more than pickup
        refreshStyle();
        updateStatusPanel();
      } else {
        // can't place onto unequal token; give small feedback
        info.rect.setStyle({ color: "#ff7f50" });
        setTimeout(() => info.rect.setStyle({ color: "#444" }), 300);
      }
    }
  });
}

function renderGrid() {
  // Clear any previous cells (if re-rendering)
  cellMap.forEach((c) => {
    try {
      map.removeLayer(c.rect);
      if (c.label) map.removeLayer(c.label);
    } catch {
      // ignore
    }
  });
  cellMap.clear();

  for (let i = -RENDER_RADIUS; i <= RENDER_RADIUS; i++) {
    for (let j = -RENDER_RADIUS; j <= RENDER_RADIUS; j++) {
      renderCell(i, j);
    }
  }
}

function setupMapAndRender() {
  // Create the map (element with id "map" is defined in index.html)
  map = leaflet.map(mapDiv, {
    center: ORIGIN_LATLNG,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    scrollWheelZoom: false,
    attributionControl: false,
  });

  // Populate the map with a background tile layer
  leaflet
    .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
    .addTo(map);

  // Add a marker to represent the player
  playerMarker = leaflet.marker(ORIGIN_LATLNG);
  playerMarker.bindTooltip("That's you!");
  playerMarker.addTo(map);

  // Render the grid now that we have an origin
  renderGrid();

  // Initial status
  updateStatusPanel();

  // Keep player marker centered (optional visual)
  map.setView(ORIGIN_LATLNG, GAMEPLAY_ZOOM_LEVEL, { animate: false });
  playerMarker.setLatLng(ORIGIN_LATLNG);
}

// Try to get the player's current location, fall back to classroom coords on failure
function getCurrentPositionPromise(
  timeout = 5000,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
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
    ORIGIN_LATLNG = leaflet.latLng(pos.coords.latitude, pos.coords.longitude);
  } catch {
    // Keep fallback location
    ORIGIN_LATLNG = FALLBACK_LATLNG;
  }

  setupMapAndRender();
})();

// Expose some helpers to window for debugging in the browser console
// (handy for testing; can be removed later)
declare global {
  var cellMap: Map<string, unknown> | undefined;
  var heldToken: number | null | undefined;
  var pick: ((i: number, j: number) => number | null) | undefined;
}

globalThis.cellMap = cellMap;
globalThis.heldToken = heldToken;
globalThis.pick = (i: number, j: number) => {
  const k = cellKey(i, j);
  const c = cellMap.get(k);
  if (!c) return null;
  if (heldToken === null && c.value !== null && canInteract(i, j)) {
    heldToken = c.value;
    c.value = null;
    // update label immediately
    if (c.label) {
      const el = c.label.getElement();
      if (el) el.innerHTML = `<div class="cell-label empty"></div>`;
    }
    updateStatusPanel();
    return heldToken;
  }
  return null;
};

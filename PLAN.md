# D3: World of Bits

## Game Design Vision

{a few-sentence description of the game mechanics}

## Technologies

- TypeScript for most game code, little to no explicit HTML, and all CSS collected in common `style.css` file
- Deno and Vite for building
- GitHub Actions + GitHub Pages for deployment automation

## Assignments

## D3.a: Core mechanics (token collection and crafting)

Key technical challenge: Can you assemble a map-based user interface using the Leaflet mapping framework?

### Steps

- [x] create a basic leaflet map on screen
- [x] add the player's current location via browser geolocation (with a classroom fallback)
- [x] draw a grid of rectangles on the map using loops
- [x] render grid cells of fixed size (~0.0001 degrees per side)
- [x] deterministically generate tokens in cells using the provided luck function
- [x] make the contents of each cell visible without clicking (DivIcon labels or similar)
- [x] allow cells to be clicked to exercise game mechanics (pick/place/craft)
- [x] enforce interaction range so only cells within ~3 blocks are interactable
- [x] implement a single-item inventory (player can hold at most one token)
- [x] picking up a token removes it from the cell and increments points
- [x] placing a token onto an equal-valued token crafts a doubled token into the player's hand
- [x] clearly display whether the player holds a token and its value, plus current points
- [x] notify the player when they hold a sufficiently high-value token (e.g. 8)
- [x] render enough cells (render radius) so the map visually appears filled to the viewport edges
- [x] keep token spawning consistent across page loads via deterministic hashing seeds

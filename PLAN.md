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

### D3.a: Steps

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

## D3.b: Globe-spanning gameplay

Key technical challenge: Can I add a movement mechanic on the Leaflet map while maintaining much of the original code?

### D3.b: Steps

- [x] Assign the player character as the location marker
- [x] Save the original location of the player once and do not update the location again based on actual current location (This is so the player can move around without the game constantly sending them back to their starting point)
- [x] Add function that moves player character when player scrolls around on the map (player character stays in the center of the screen)
- [x] Make only the cells near the player character interactable (within a 3 cell raidus)
- [x] Make cells out of view memoryless: cells with tokens previously collected by player can hold tokens again when out of view
- [x] Add a token that is a value higher than the previous highest token (32 perhaps) that players need to craft up to
- [x] Add a victory screen for when players reach the new token max
- [x] Add a restart button on the victory screen that starts a new game from the beginning

## D3.c: Object Persistence

Key technical challenge: Can I give modified cells memory so that they can save their state even when off screen?

### D3.c: Steps

- [x] Apply the Flyweight pattern so off-screen cells use no memory unless modified
- [x] Use the Memento (or similar) pattern to save modified cell states when they scroll off-screen
- [x] Restore saved cell states when they come back into view
- [x] Make the map appear to remember cell states even when cells are not visible
- [x] Store cell data separately from coordinates so a Map can track modified cells
- [x] Rebuild the visible map from scratch whenever the view changes instead of moving existing objects

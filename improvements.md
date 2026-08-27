# Improvements

## Unfixed Performance Issues

### HIGH

- **H4: VIDEOS cache unbounded growth** - `VIDEOS[creatorId]`, `VIDEOS["_ch_"+id]`, and `VIDEOS["_myint_"+id]` entries never clear except on full logout. Every creator, channel filter, and video detail page adds entries. On a TV with ~1-2 GB RAM, this creeps up over a long session. Needs eviction strategy or size cap.

### MEDIUM

- **M1: DOM rebuilt from scratch** - ✅ Channel switch updates grid in-place instead of full rebuild* - `renderBrowse()` and `showCreator()` destroy and recreate every DOM node on each call (navigation, channel switch). Event delegation mitigates listener cost but the innerHTML swap is still expensive. Virtual DOM diff or fragment reuse would help.
- **M2: handleKey DOM query** - ✅ Cached, re-queries only on view change* - every non-player keypress runs `querySelectorAll('[tabindex="0"], button, input, select, a')` across the entire current view, then filters on `offsetParent`. With 100+ cards, this adds latency. Cache the query result and invalidate on view change.
- **M4: Scripts load synchronously** - ✅ All scripts have `defer`* - all `<script>` tags in `index.html` `<head>` are render-blocking. `shaka-player.compiled.js` (~1MB) is the worst. Use `defer` or lazy-load for `qrcode.js` (only needed during login).
- **M6: Shaka destroy() never called** - ✅ Called in `stop()`* - `stop()` calls `_player.unload()` but never `_player.destroy()`. On repeated init/stop cycles (quality fallback), Shaka resources accumulate. Needs async destroy lifecycle.

### LOW

- L1: login-debug panel - ✅ cleared on each startLogin()
- L2: _populateCCList - ✅ cached button array, no querySelectorAll in click handlers
- L3: `videoEl.onclick =` overwrites other click handlers (minor - we own the element)
- L4: `Object.hasOwn` slightly slower than `hasOwnProperty` (already correct, just micro-opt)
- L5: Redundant player null-checks - ✅ removed
- L6: 8s search timeout race - ✅ removed
- L7: HD picker dedup - ✅ uses height + label key
- L8: Toast timer - ✅ null-guarded with local ref

---

## Remote Key Mappings - Implemented

| Key           | Code     | Action                                      | Status |
| ------------- | -------- | ------------------------------------------- | ------ |
| **Home**      | 36       | Browse (or direct to creator if only 1 sub) | ✅     |
| **Exit**      | 445      | Back to browse from any view                | ✅     |
| **Info**      | 457      | Toggle geek panel in player                 | ✅     |
| **CC**        | 46 ('C') | Toggle subtitles on/off in player           | ✅     |
| **Page Up**   | 33       | Focus previous sibling element              | ✅     |
| **Page Down** | 34       | Focus next sibling element                  | ✅     |
| **Red**       | 403      | Open settings overlay                       | ✅     |
| **Green**     | 404      | Focus search input                          | ✅     |
| **Yellow**    | 405      | Reserved (no-op)                            | ✅     |
| **Blue**      | 406      | Reserved (no-op)                            | ✅     |
| **0**         | 48       | Jump to 10th creator in browse              | ✅     |
| **1-9**       | 49-57    | Jump to 1st-9th creator in browse           | ✅     |



---

## API Reference Notes (verified via Charles captures Aug 2026)

### Comment badges - how to resolve badge IDs to icons

- **Comment response** (GET /api/v3/comment?blogPost=ID&limit=20&sortBy=createdAt&sortDirection=DESC): badges live on **`c.user.badges`** as plain **ID strings** (e.g. `"69fbc351bb18dc6b2256987b"`). Comment-level `c.badges` may not exist.
- **Resolve IDs to images**: `POST /api/v3/achievement/perks` with JSON body `{"ids":["69fbc351...", ...]}` (batch, any count). Response is an array of:
  `{ id, type:"badge", code?, title, image: { width, height, path: "https://pbs.floatplane.com/user_badge/global/292506251304365_1778200006797.png", childImages: [...] } }`
- **No direct ID-to-URL formula** - the mapping only exists in the perks response. Cache id->image.path.
- **Image host**: `pbs.floatplane.com` (already whitelisted in appinfo.json access).
- Implemented in `js/views/details.js` (`_loadBadges` / `_badgeIcons`) + `js/api.js` (`getBadgePerks`).

### Other verified endpoints (from captures)

- `GET /api/v3/comment` requires sortBy/sortDirection to return the badge-bearing shape.
- `POST /api/v3/achievement/perks` - 200, returns badge definitions.
- `GET /api/v3/user/achievement` - 403 w/o auth; returns user's achievements (NOT used for comment badges; commenter badges may not be in your list).
- `/api/v3/user/badges` and `/api/v3/plan/badges` - **do not exist** (404).

### webOS gotcha

- `Object.hasOwn()` crashes webOS Chrome 68 - use `Object.prototype.hasOwnProperty.call(obj, k)`. build.ps1 guard (line 6-12) fails the build on any `Object.hasOwn`.

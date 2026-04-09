# EPY IPTV Player

A Single Page Application (SPA) Web IPTV Player designed to stream free IPTV channels while sporting a polished, modern, dark-themed UI. 

## Features

- **Live Stream Playback:** Integrates `hls.js` to parse and stream HTTP Live Streaming (.m3u8) endpoints beautifully, with native `<video>` fallback for environments natively supporting HLS (like Safari).
- **M3U Playlist Parsing:** Automatically decodes and loads global M3U lists (defaults to the `Free-TV/IPTV` repository).
- **Stream Status Scanning:** Actively background-scans loaded stream URLs to rapidly distinguish between "working" and "broken" endpoints, visualizing status using interactive green indicators or grey strikethrough elements.
- **Smart Caching:** Avoids long and repetitive resource-heavy checks by locally backing up a list of known "working" streams inside the device.
- **Favourites Management:** Allows users to save working streams as "Favourites" for immediate access in a quick-launch bar above the main video interface.
- **Real-time Search:** A dynamic search box to instantly filter channels by name as you type.

## Required Configuration:

To allow state persistence across browser refreshes—such as remembering which streams are operational and preserving users' "favourite" channels—the SPA is configured to communicate with the host device's filesystem via specific REST interfaces (`/system/file` and `/system/upload`).

For this ecosystem to work flawlessly, **the file manager (SD Card) must has the following directory:**

> `/sdcard/storage/iptv`

### Associated Files:
*   **`working.json`**: When a stream scan completes, the application extracts the functional URLs and pushes them here. On application start, the SPA checks for this file. If it exists, it bypasses the heavy initialization scan and directly updates the UI based on known working states.
*   **`saving.json`**: This file houses the list of custom channels a user has actively chosen to "Save". It is fetched whenever the player loads to reconstruct the user's customized horizontal favourites list.

### Big shoutout to https://github.com/free-tv/iptv
Change PLAYLIST_URL in index.html to one from https://github.com/Free-TV/IPTV/tree/master/playlists if you want to use a more specific playlist.
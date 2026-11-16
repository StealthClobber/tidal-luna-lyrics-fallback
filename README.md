# Lyrics Fallback for Tidal Luna

A [Tidal Luna](https://github.com/Inrixia/TidaLuna) plugin that shows lyrics when TIDAL's own don't show up.

TIDAL's current client only shows its **Lyrics** button in the now-playing view when the track is linked to lyrics on TIDAL's side, so many tracks get none. This plugin replaces TIDAL's **Lyrics** tab with its own, for every track: same place (beside **Credits**), same look, but with synced lyrics from [LRCLIB](https://lrclib.net), and TIDAL's own for tracks LRCLIB doesn't have.

The lyrics show where TIDAL's own would be: in its side panel, with the cover moved left. (TIDAL only makes room for that panel while one of its tabs is open, so the plugin keeps TIDAL's own Lyrics tab, or else **Credits**, open underneath, hidden, and turns it off when you close the lyrics.)

The panel:

- Uses lyrics from [LRCLIB](https://lrclib.net), a free open lyrics database, and TIDAL's own for tracks LRCLIB doesn't have. (TIDAL's can come first instead, but their timings are often off.)
- Looks like TIDAL's own lyrics view. With synced lyrics it highlights the line being sung and scrolls along; click a line to jump to it, or scroll yourself and it stops following for a few seconds.
- Follows the track as songs change, and loads the next track's lyrics before it starts.

## Installing

1. Open **Luna Settings → Plugin Store** and paste this link into the **Install from URL** box:

   ```
   https://github.com/StealthClobber/tidal-luna-lyrics-fallback/releases/download/latest/store.json
   ```

2. The store appears in the list. Click **@stealth/lyrics-fallback** in it to install.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Open automatically | On | Like TIDAL, open on the lyrics whenever the now-playing view opens. Picking another tab or closing the lyrics keeps them closed until the view is opened again. |
| TIDAL's lyrics first | Off | On tries TIDAL's own lyrics before LRCLIB. |

## License

[AGPL-3.0](LICENSE), from the [luna-template](https://github.com/Inrixia/luna-template).

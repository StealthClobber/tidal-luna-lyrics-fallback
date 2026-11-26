# Lyrics Fallback for Tidal Luna

A [Tidal Luna](https://github.com/Inrixia/TidaLuna) plugin that shows lyrics when TIDAL's own don't show up.

TIDAL's current client only shows its **Lyrics** in the now-playing view when the track is linked to lyrics on TIDAL's side, so many tracks get none at all. This plugin replaces TIDAL's **Lyrics** tab with its own, for every track: same place (beside **Credits**), same look, but with synced lyrics from [LRCLIB](https://lrclib.net), and TIDAL's own when LRCLIB has no synced lyrics for the track.

I've also found TIDAL's lyrics to be improperly synced sometimes when LRCLIB's aren't, so that's an added benefit of replacing them with LRCLIB.

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
| TIDAL's lyrics first | Off | On prefers TIDAL's own lyrics over LRCLIB's. Synced lyrics still win over plain ones either way. |

## License

[AGPL-3.0](LICENSE), from the [luna-template](https://github.com/Inrixia/luna-template).

import { redux, TidalApi, type MediaItem } from "@luna/lib";

/** One line of lyrics. `time` is in seconds and only set for synced lyrics. */
export type Line = { time?: number; text: string };

export type Lyrics = {
	lines: Line[];
	/** Every line has a time, so the panel can follow the song. */
	synced: boolean;
	/** Where the lyrics came from, shown in the panel. */
	source: string;
	rightToLeft?: boolean;
	/** LRCLIB marks some tracks as instrumental (no lyrics at all). */
	instrumental?: boolean;
};

/** "[mm:ss.xx]" style timestamps. A line may have several ("[00:12.00][01:30.50]Chorus"). */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/** LRC text into lines. Metadata tags ([ar:...], [length:...]) are dropped. Undefined if no line has a time. */
export const parseLrc = (lrc: string): Line[] | undefined => {
	const lines: Line[] = [];
	for (const raw of lrc.split(/\r?\n/)) {
		const times: number[] = [];
		TIMESTAMP.lastIndex = 0;
		let match: RegExpExecArray | null;
		let end = 0;
		while ((match = TIMESTAMP.exec(raw)) !== null && match.index === end) {
			times.push(Number(match[1]) * 60 + Number(match[2].replace(":", ".")));
			end = TIMESTAMP.lastIndex;
		}
		if (times.length === 0) continue;
		const text = raw.slice(end).trim();
		for (const time of times) lines.push({ time, text });
	}
	if (lines.length === 0) return;
	return lines.sort((a, b) => a.time! - b.time!);
};

const plain = (text: string): Line[] => text.split(/\r?\n/).map((line) => ({ text: line.trim() }));

/** Synced lines from LRC text if it has any, else the plain text. */
const toLyrics = (source: string, lrc: string | null | undefined, text: string | null | undefined, rightToLeft?: boolean): Lyrics | undefined => {
	const synced = lrc ? parseLrc(lrc) : undefined;
	if (synced?.some((line) => line.text !== "")) return { lines: synced, synced: true, source, rightToLeft };
	if (text?.trim()) return { lines: plain(text), synced: false, source, rightToLeft };
};

/** "MUSIXMATCH" into "Musixmatch". */
const titleCase = (name: string) => (name === name.toUpperCase() ? name.charAt(0) + name.slice(1).toLowerCase() : name);

type V2Track = {
	included?: {
		type: string;
		attributes?: { text?: string | null; lrcText?: string | null; direction?: string; provider?: { name?: string } };
	}[];
};

/**
 * TIDAL's own lyrics, the way its current client loads them (the OpenAPI
 * "lyrics" relationship on the track), then TIDAL's older lyrics endpoint.
 * TIDAL may have lyrics its UI doesn't show, so these are tried first.
 */
export const fromTidal = async (mediaItem: MediaItem): Promise<Lyrics | undefined> => {
	try {
		const { countryCode } = redux.store.getState().session;
		const track = await TidalApi.fetch<V2Track>(`https://openapi.tidal.com/v2/tracks/${mediaItem.id}?countryCode=${countryCode}&include=lyrics`);
		for (const item of track?.included ?? []) {
			if (item.type !== "lyrics" || !item.attributes) continue;
			const { lrcText, text, direction, provider } = item.attributes;
			const lyrics = toLyrics(`TIDAL${provider?.name ? ` (${titleCase(provider.name)})` : ""}`, lrcText, text, direction === "RIGHT_TO_LEFT");
			if (lyrics) return lyrics;
		}
	} catch {
		// Fall through to the older endpoint.
	}
	try {
		const old = await mediaItem.lyrics();
		if (old) return toLyrics(`TIDAL${old.lyricsProvider ? ` (${old.lyricsProvider})` : ""}`, old.subtitles, old.lyrics, old.isRightToLeft);
	} catch {
		// No TIDAL lyrics.
	}
};

type LrclibTrack = {
	trackName: string;
	artistName: string;
	duration: number;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
};

const LRCLIB = "https://lrclib.net/api";

const lrclib = async <T>(path: string, params: Record<string, string>): Promise<T | undefined> => {
	const res = await fetch(`${LRCLIB}/${path}?${new URLSearchParams(params)}`);
	if (res.status === 404) return;
	if (!res.ok) throw new Error(`LRCLIB ${res.status} ${res.statusText}`);
	return res.json();
};

/** Lowercase, without "(feat. ...)", "- Remastered 2011" and punctuation, for comparing titles. */
const simplify = (value: string) =>
	value
		.toLowerCase()
		.replace(/\s*[([].*?(feat|ft\.|with|remaster|version|edit|mix|live)[^)\]]*[)\]]/g, "")
		.replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const fromLrclibTrack = (track: LrclibTrack): Lyrics | undefined => {
	if (track.instrumental) return { lines: [], synced: false, source: "LRCLIB", instrumental: true };
	return toLyrics("LRCLIB", track.syncedLyrics, track.plainLyrics);
};

/**
 * Lyrics from LRCLIB (lrclib.net), a free open lyrics database with synced
 * lyrics. An exact lookup by title, artist, album and length first, then a
 * search, keeping the closest match in length.
 */
export const fromLrclib = async (mediaItem: MediaItem): Promise<Lyrics | undefined> => {
	const item = mediaItem.tidalItem;
	const title = item.version ? `${item.title} (${item.version})` : item.title;
	const artist = item.artist?.name ?? item.artists?.[0]?.name;
	if (!title || !artist) return;
	const duration = mediaItem.duration ?? item.duration;

	const exact = await lrclib<LrclibTrack>("get", {
		track_name: title,
		artist_name: artist,
		...(item.album?.title ? { album_name: item.album.title } : {}),
		...(duration ? { duration: String(Math.round(duration)) } : {}),
	});
	const exactLyrics = exact && fromLrclibTrack(exact);
	if (exactLyrics) return exactLyrics;

	const results = (await lrclib<LrclibTrack[]>("search", { track_name: item.title, artist_name: artist })) ?? [];
	const wanted = simplify(item.title);
	const candidates = results
		.filter((track) => simplify(track.trackName) === wanted || simplify(track.trackName).startsWith(wanted))
		// Within 10s of TIDAL's length, if TIDAL gave one.
		.filter((track) => !duration || Math.abs(track.duration - duration) <= 10)
		.sort((a, b) => {
			// Synced lyrics first, then the closest length.
			const synced = Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
			return synced || (duration ? Math.abs(a.duration - duration) - Math.abs(b.duration - duration) : 0);
		});
	for (const track of candidates) {
		const lyrics = fromLrclibTrack(track);
		if (lyrics) return lyrics;
	}
};

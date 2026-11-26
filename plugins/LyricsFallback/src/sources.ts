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
	// A synced exact match is the best there is. An exact instrumental is kept as it is:
	// the search below uses the bare title and would find the vocal version's lyrics.
	if (exactLyrics?.synced || exactLyrics?.instrumental) return exactLyrics;

	// The exact match can be plain text while a synced copy of the song is listed
	// under a slightly different title or album, which only the search finds.
	let results: LrclibTrack[];
	try {
		results = (await lrclib<LrclibTrack[]>("search", { track_name: item.title, artist_name: artist })) ?? [];
	} catch (error) {
		// Lyrics already in hand beat an error from the extra lookup.
		if (exactLyrics) return exactLyrics;
		throw error;
	}
	const wanted = simplify(item.title);
	const lengthOff = (track: LrclibTrack) => (duration ? Math.abs(track.duration - duration) : 0);
	const candidates = results
		.filter((track) => simplify(track.trackName) === wanted || simplify(track.trackName).startsWith(wanted))
		// Within 10s of TIDAL's length, if TIDAL gave one.
		.filter((track) => lengthOff(track) <= SEARCH_LENGTH_SLACK)
		// Synced lyrics first, then the closest length.
		.sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || lengthOff(a) - lengthOff(b));

	// Replacing a plain exact match needs a synced copy of the same cut (nearly the same length):
	// another cut's timings could be worse than TIDAL's own.
	const syncedSlack = exactLyrics ? UPGRADE_LENGTH_SLACK : SEARCH_LENGTH_SLACK;
	for (const track of candidates) {
		const lyrics = fromLrclibTrack(track);
		if (lyrics?.synced && lengthOff(track) <= syncedSlack) return lyrics;
	}
	// No synced copy: the exact match, else the best plain search result.
	if (exactLyrics) return exactLyrics;
	for (const track of candidates) {
		const lyrics = fromLrclibTrack(track);
		if (lyrics) return lyrics;
	}
};

/** How far (seconds) a search result's length may be from TIDAL's to count as the same song. */
const SEARCH_LENGTH_SLACK = 10;
/** How far it may be to replace a plain exact match with its synced lyrics: the same cut, give or take rounding. */
const UPGRADE_LENGTH_SLACK = 2;

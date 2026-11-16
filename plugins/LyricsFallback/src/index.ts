import { ReactiveStore, Tracer, type LunaUnload } from "@luna/core";
import { MediaItem } from "@luna/lib";

import { Panel, type Placement } from "./panel";
import { fromLrclib, fromTidal, type Lyrics } from "./sources";

export const { trace } = Tracer("[LyricsFallback]");
export const unloads = new Set<LunaUnload>();

export const storage = await ReactiveStore.getPluginStorage("LyricsFallback", {
	/** Open the lyrics by themselves when the now-playing view opens, like TIDAL does with its own. */
	autoOpen: true,
	/** Try TIDAL's own lyrics before LRCLIB. Off by default: TIDAL's timings are often off, LRCLIB's usually right. */
	tidalFirst: false,
});

export { Settings } from "./Settings";

/** Our Lyrics tab replaces TIDAL's: this class on the page hides TIDAL's Lyrics buttons. */
document.body.classList.add("lf-replace");
unloads.add(() => document.body.classList.remove("lf-replace"));

/** TIDAL's elements this plugin works with (all from TIDAL's own data-test attributes). */
const NOW_PLAYING = '[data-test="new-now-playing"]';
/** TIDAL's own Lyrics button: the wide-window one, or the narrow-window one. */
const TIDAL_LYRICS_BUTTON = '[data-test="toggle-lyrics"], [data-test="mobile-toggle-lyrics"]';
const CLOSE_BUTTON = '[data-test="new-now-playing-close"]';
const CREDITS_BUTTON = '[data-test="toggle-credits"]';
const FOOTER = '[data-test="footer-player"]';
const OUR_BUTTON = "lyrics-fallback-toggle";

/**
 * The now-playing view that's showing. TIDAL keeps two sections marked
 * new-now-playing (a fullscreen one and the normal one) and only the one in
 * use has the header with the Credits button, so that's the one picked.
 */
const findNowPlaying = () => {
	for (const view of document.querySelectorAll(NOW_PLAYING)) {
		const credits = view.querySelector(CREDITS_BUTTON);
		if (credits && view.getClientRects().length > 0) return view;
	}
};

/** How long after we click one of TIDAL's tabs before its on/off state can be trusted (ms). */
const TAB_SETTLE = 2000;

// #region Lyrics
/** How long one lyrics source gets before the next is tried (ms). */
const SOURCE_TIMEOUT = 10000;
const cache = new Map<string, Promise<Lyrics | undefined>>();

/** The track's lyrics: TIDAL's, then LRCLIB's (or the other way round). Undefined if neither has any. */
const lyricsFor = (mediaItem: MediaItem) => {
	const key = String(mediaItem.id);
	let lyrics = cache.get(key);
	if (lyrics === undefined) {
		lyrics = (async () => {
			const sources = storage.tidalFirst ? [fromTidal, fromLrclib] : [fromLrclib, fromTidal];
			let failure: unknown;
			for (const source of sources) {
				try {
					// A source that hangs mustn't keep the next one from being tried.
					const found = await Promise.race([
						source(mediaItem),
						new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${source.name} timed out`)), SOURCE_TIMEOUT)),
					]);
					if (found) return found;
				} catch (error) {
					failure = error;
					trace.warn.withContext(`Getting lyrics from ${source.name}`)(error);
				}
			}
			if (failure) throw failure;
		})();
		cache.set(key, lyrics);
		// Don't keep failures (a dropped connection), so opening the panel again retries.
		lyrics.catch(() => cache.delete(key));
	}
	return lyrics;
};
/** Forget found lyrics (the source order changed), and reload the open panel. */
export const reloadLyrics = () => {
	cache.clear();
	if (panel.isOpen && current) void load(current);
};
// #endregion

// #region Panel
let current: MediaItem | undefined;

/**
 * Whether it's a song (not a music video). Read from TIDAL's own details for
 * the item: Luna's contentType can say "video" for a song right after TIDAL
 * starts (it checks the playback's video quality for null, and TIDAL leaves it unset then).
 */
const isSong = (mediaItem: MediaItem) => (mediaItem.tidalItem?.contentType ?? mediaItem.contentType) === "track";

/**
 * TIDAL opens the now-playing view on its Lyrics tab, then keeps whichever tab
 * the user picks until the view closes. This is set once the user picks
 * another tab (or closes our lyrics), and cleared when the view closes, so the
 * lyrics open by themselves the same way.
 */
let userChoseOtherTab = false;
/** Whether the now-playing view was open the last time we looked. */
let viewWasOpen = false;
/** The view closed while we had Credits on under the lyrics, so TIDAL will reopen it on Credits. */
let creditsLeftOn = false;

/**
 * TIDAL's side panel slot: where its Credits, Similar tracks and Lyrics tabs
 * show, with the cover moved left to make room. The lyrics go over it.
 */
const SIDE_PANEL = '[class*="_panelWrapper_"]';

/**
 * TIDAL only makes room for its side panel while one of its own tabs is open,
 * so the lyrics need a tab open underneath them (hidden by them). That's
 * TIDAL's own Lyrics tab if it's already open (it opens on it by itself),
 * otherwise Credits, which we turn on. Closing the lyrics turns off whichever
 * it was. True while we're the reason Credits is on.
 */
let borrowedCredits = false;
/** Set while we click one of TIDAL's tabs ourselves, so the header listener ignores that click. */
let clickingTab = false;
/** When we last clicked one of TIDAL's tabs. TIDAL takes about a second to show a tab as on. */
let lastTabClick = 0;
const creditsButton = () => findNowPlaying()?.querySelector<HTMLElement>(CREDITS_BUTTON) ?? undefined;
const tidalLyricsButton = () => findNowPlaying()?.querySelector<HTMLElement>(TIDAL_LYRICS_BUTTON) ?? undefined;
const isOn = (button: Element | undefined) => button?.getAttribute("aria-pressed") === "true";
const clickTab = (button: HTMLElement | undefined) => {
	if (!button) return;
	clickingTab = true;
	lastTabClick = performance.now();
	try {
		button.click();
	} finally {
		clickingTab = false;
	}
};
const clickCredits = () => clickTab(creditsButton());
/** Turn off the tab under the lyrics, if it's one the user didn't pick: Credits we turned on, or TIDAL's hidden Lyrics tab. */
const returnCredits = () => {
	if (borrowedCredits && isOn(creditsButton())) clickCredits();
	borrowedCredits = false;
	if (isOn(tidalLyricsButton())) clickTab(tidalLyricsButton());
};

/** Over TIDAL's side panel, or (before it has appeared) the right half of the view, below its header and above the player bar. */
const place = (): Placement | undefined => {
	const nowPlaying = findNowPlaying();
	if (!nowPlaying) return;
	const view = nowPlaying.getBoundingClientRect();
	const slot = [...nowPlaying.querySelectorAll(SIDE_PANEL)].map((el) => el.getBoundingClientRect()).find((rect) => rect.width > 100);
	if (slot) {
		return {
			container: nowPlaying,
			top: slot.top - view.top,
			left: slot.left - view.left,
			width: slot.width,
			// Not under the player bar.
			height: Math.min(slot.height, (document.querySelector(FOOTER)?.getBoundingClientRect().top ?? window.innerHeight) - slot.top - 16),
		};
	}
	const header = nowPlaying.querySelector(CREDITS_BUTTON)?.closest("header")?.getBoundingClientRect();
	const footer = document.querySelector(FOOTER)?.getBoundingClientRect();
	const top = (header ? header.bottom : view.top + 72) + 8;
	// The view can reach below the window, under the player bar.
	const bottom = Math.min(view.bottom, window.innerHeight, footer && footer.top > top ? footer.top : Infinity) - 16;
	// The right half, or nearly all of it when the view is too narrow to split.
	const left = view.width > 900 ? view.left + view.width / 2 : view.left + 16;
	const width = view.right - (view.width > 900 ? 24 : 16) - left;
	return {
		container: nowPlaying,
		top: top - view.top,
		left: left - view.left,
		width: Math.max(width, 240),
		height: Math.max(bottom - top, 120),
	};
};

/** Close the lyrics. `byUser`: they stay closed (like picking another tab) until the view is next opened. */
const closePanel = (byUser = true) => {
	if (byUser) userChoseOtherTab = true;
	panel.close();
	returnCredits();
	syncButton();
};
const panel = new Panel(unloads, place);
unloads.add(() => {
	if (panel.isOpen) returnCredits();
});

/** Fill the panel with the current track's lyrics. */
const load = async (mediaItem: MediaItem) => {
	panel.show({ message: "Looking for lyrics..." });
	try {
		const lyrics = await lyricsFor(mediaItem);
		if (mediaItem !== current) return; // The track changed while loading.
		if (lyrics?.instrumental) panel.show({ message: "This track is instrumental." });
		else if (lyrics) panel.show({ lyrics });
		else panel.show({ message: "No lyrics found for this track on TIDAL or LRCLIB." });
	} catch (error) {
		if (mediaItem !== current) return;
		panel.show({ message: "Couldn't load lyrics. Close and reopen to try again." });
		trace.err.withContext("Loading lyrics")(error);
	}
};

const openPanel = () => {
	if (!current) return;
	userChoseOtherTab = false;
	const credits = creditsButton();
	// Credits or TIDAL's own Lyrics tab already open: the lyrics go over it. Otherwise turn Credits on.
	if (credits && !isOn(credits) && !isOn(tidalLyricsButton())) {
		clickCredits();
		borrowedCredits = true;
	}
	panel.open();
	void load(current);
	syncButton();
};
// #endregion

// #region Button and now-playing view
/** Header buttons whose clicks we already listen to, so another of TIDAL's tabs closes the panel. */
const watchedHeaders = new WeakSet<Element>();

/**
 * Keeps our Lyrics button in the now-playing view's header (beside Credits)
 * when it's wanted, and the panel closed when that view isn't open.
 */
const syncButton = () => {
	ensureCurrent();
	const nowPlaying = findNowPlaying();
	const credits = nowPlaying?.querySelector<HTMLElement>(CREDITS_BUTTON);
	const tidalButton = nowPlaying?.querySelector(TIDAL_LYRICS_BUTTON);
	let ours = document.querySelector<HTMLButtonElement>(`[data-test="${OUR_BUTTON}"]`);

	const isTrack = current !== undefined && isSong(current);
	const wanted = !!credits && isTrack;

	if (!!nowPlaying !== viewWasOpen) {
		viewWasOpen = !!nowPlaying;
		if (!nowPlaying) {
			// The view closed. TIDAL keeps its tab for next time (Credits, if we had it on),
			// and opens on Lyrics again next time.
			userChoseOtherTab = false;
			creditsLeftOn = panel.isOpen && borrowedCredits;
			panel.close();
			borrowedCredits = false;
		}
	}

	if (!wanted) {
		ours?.remove();
		// A video started: no lyrics for those.
		if (nowPlaying && panel.isOpen && !isTrack) closePanel(false);
		return;
	}

	if (!ours) {
		ours = document.createElement("button");
		ours.dataset.test = OUR_BUTTON;
		ours.addEventListener("click", () => (panel.isOpen ? closePanel() : openPanel()));
	}
	// Look like TIDAL's own header buttons. Only touched when different: changing the text
	// replaces its text node, which would wake the page observer again every frame.
	const label = "Lyrics";
	// Without TIDAL's "pressed" class, which Credits has while we borrow it; ours gets its own pressed look.
	const className = credits.className.replace(/\s*_toggleButtonActive_\S+/g, "");
	if (ours.className !== className) ours.className = className;
	if (ours.textContent !== label) ours.textContent = label;
	ours.title = "Lyrics from the Lyrics Fallback plugin";
	ours.setAttribute("aria-pressed", String(panel.isOpen));
	// In a narrow window (576px or less) TIDAL hides the row Credits is in and keeps only
	// its icon buttons (where its own Lyrics button moves too), so ours goes there instead.
	const creditsShown = credits.getClientRects().length > 0;
	const actions = nowPlaying!.querySelector(CLOSE_BUTTON)?.closest('[class*="_actionButtons_"]');
	if (creditsShown || !actions) {
		if (credits.nextElementSibling !== ours) credits.after(ours);
	} else if (actions.firstElementChild !== ours) actions.prepend(ours);

	const header = credits.closest("header");
	if (header && !watchedHeaders.has(header)) {
		watchedHeaders.add(header);
		// Runs before TIDAL's own click handling (which listens further up the page).
		header.addEventListener("click", (event) => {
			if (clickingTab) return;
			const button = (event.target as HTMLElement).closest("button");
			if (!button || button.dataset.test === OUR_BUTTON || !button.hasAttribute("aria-pressed")) return;
			userChoseOtherTab = true;
			if (!panel.isOpen) return;
			// Credits is already on under the lyrics: just uncover it, rather than TIDAL turning it off.
			if (button.dataset.test === "toggle-credits" && borrowedCredits) event.stopPropagation();
			// Any other tab: TIDAL switches to it, so Credits needn't be turned off first.
			borrowedCredits = false;
			panel.close();
			syncButton();
		});
	}

	const settled = performance.now() - lastTabClick > TAB_SETTLE;
	// The lyrics are open but no tab is under them any more (TIDAL drops its Lyrics tab
	// for a track without lyrics): turn Credits on to keep the room for them.
	if (panel.isOpen && settled && !header?.querySelector('[aria-pressed="true"]:not([data-test="' + OUR_BUTTON + '"])')) {
		clickCredits();
		borrowedCredits = true;
	}
	// TIDAL opened on its (hidden) Lyrics tab but ours aren't opening by themselves: turn it off.
	if (!panel.isOpen && settled && isOn(tidalButton ?? undefined) && (!storage.autoOpen || userChoseOtherTab)) {
		clickTab(tidalButton as HTMLElement);
	}

	if (panel.isOpen || !storage.autoOpen || userChoseOtherTab || !current) {
		// Reopened on the Credits we left on, but the lyrics aren't opening by themselves: turn it back off.
		if (creditsLeftOn && !panel.isOpen && (!storage.autoOpen || userChoseOtherTab)) {
			creditsLeftOn = false;
			clickCredits();
		}
		return;
	}
	// Like TIDAL opening on its Lyrics tab. If TIDAL reopened on the Credits we left on,
	// it's ours again, to turn off when the lyrics close.
	if (creditsLeftOn) borrowedCredits = isOn(credits);
	creditsLeftOn = false;
	openPanel();
};
export const refresh = () => syncButton();

/** Check the page after TIDAL changes it, at most once a frame. */
let queued = 0;
const observer = new MutationObserver(() => {
	if (queued) return;
	queued = requestAnimationFrame(() => {
		queued = 0;
		syncButton();
	});
});
observer.observe(document.body, { childList: true, subtree: true });
unloads.add(() => {
	observer.disconnect();
	cancelAnimationFrame(queued);
	document.querySelector(`[data-test="${OUR_BUTTON}"]`)?.remove();
});
// #endregion

/**
 * The playing track, if we don't know it yet. When the plugin loads with TIDAL
 * (before playback is set up) the first lookup finds nothing, and no track
 * change comes until the next song, so it's asked again while the page changes.
 */
let lookingUp = false;
const ensureCurrent = () => {
	if (current || lookingUp) return;
	lookingUp = true;
	MediaItem.fromPlaybackContext()
		.then(onTrack)
		.catch(() => {})
		.finally(() => setTimeout(() => (lookingUp = false), 1000));
};

const onTrack = (mediaItem: MediaItem | undefined) => {
	if (mediaItem === undefined || mediaItem === current) return;
	current = mediaItem;
	if (panel.isOpen) {
		if (isSong(mediaItem)) void load(mediaItem);
		else panel.close();
	}
	syncButton();
};

MediaItem.onMediaTransition(unloads, onTrack);
ensureCurrent();
// Have the next track's lyrics ready before it starts.
MediaItem.onPreload(unloads, (mediaItem) => {
	if (isSong(mediaItem)) void lyricsFor(mediaItem).catch(() => {});
});

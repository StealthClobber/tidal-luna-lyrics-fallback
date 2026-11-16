import type { LunaUnloads } from "@luna/core";
import { PlayState, redux, StyleTag } from "@luna/lib";

import type { Lyrics } from "./sources";

/** What the panel shows: lyrics, or a message while loading or when none were found. */
export type PanelContent = { lyrics: Lyrics } | { message: string };

/** How long after the user scrolls the lyrics before the panel follows the song again (ms). */
const MANUAL_SCROLL_PAUSE = 4000;
/** Lines switch this much before their timestamp (seconds), so the highlight doesn't lag the voice. */
const LEAD = 0.15;
/** Where the sung line is kept, as a share of the panel's height from the top (TIDAL's own value). */
const LINE_POSITION = 0.25;
/** Lines further than this from the sung one all look the same (TIDAL's own value). */
const MAX_DISTANCE = 3;

/**
 * Where the song is, in seconds. TIDAL plays through a <video> element; the one
 * playing has the exact position. While paused, TIDAL's last saved position is
 * used (it saves it when pausing and seeking, not while playing).
 */
const playPosition = () => {
	for (const media of document.querySelectorAll<HTMLMediaElement>("video, audio")) {
		if (!media.paused && !media.ended) return media.currentTime;
	}
	const { latestCurrentTime, latestCurrentTimeSyncTimestamp, playbackState } = redux.store.getState().playbackControls as {
		latestCurrentTime?: number;
		latestCurrentTimeSyncTimestamp?: number;
		playbackState?: string;
	};
	const saved = latestCurrentTime ?? 0;
	if (playbackState === "PLAYING" && latestCurrentTimeSyncTimestamp) return saved + (Date.now() - latestCurrentTimeSyncTimestamp) / 1000;
	return saved;
};

/**
 * TIDAL's own lyrics look (its now-playing lyrics stylesheet), rebuilt under
 * our own names: TIDAL's class names change with every TIDAL update.
 */
const CSS = `
#lyrics-fallback-panel {
	position: absolute;
	z-index: 3;
	box-sizing: border-box;
	container-type: inline-size;
	color: #fff;
}
#lyrics-fallback-panel[hidden] { display: none; }
#lyrics-fallback-panel .lf-scroll {
	height: 100%;
	overflow-y: auto;
	scrollbar-width: none;
	mask-image: linear-gradient(to bottom, transparent, #000 64px, #000 calc(100% - 64px), transparent);
}
#lyrics-fallback-panel .lf-scroll:hover { scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.3) transparent; }
#lyrics-fallback-panel .lf-content {
	position: relative;
	padding: 64px var(--market-core-metrics-spacing-200, 16px) 184px var(--market-core-metrics-spacing-100, 8px);
}
#lyrics-fallback-panel .lf-text {
	font-weight: var(--market-core-type-bold-weight, 700);
	font-size: clamp(26px, 7cqw, 48px);
	line-height: 1.15;
	--lf-ease: cubic-bezier(0.4, 0, 0.2, 1);
	--lf-duration: 0.46s;
	--lf-blur: 0;
}
#lyrics-fallback-panel .lf-text > span {
	display: block;
	margin: 0 var(--market-core-metrics-spacing-600, 48px) var(--market-core-metrics-spacing-300, 24px) 0;
	white-space: pre-wrap;
}
@media (width <= 768px) { #lyrics-fallback-panel .lf-text > span { margin-right: 0; } }
#lyrics-fallback-panel .lf-text > span.lf-stanza-end { margin-bottom: var(--market-core-metrics-spacing-800, 64px); }
#lyrics-fallback-panel .lf-rtl { direction: rtl; --lf-origin: right center; }

/* Synced: dimmed, smaller lines, a little blurred while following, the sung one full size. */
#lyrics-fallback-panel .lf-synced { cursor: pointer; }
#lyrics-fallback-panel .lf-synced[data-following] { --lf-blur: 1; }
#lyrics-fallback-panel .lf-synced > span {
	opacity: 0.55;
	filter: blur(calc(1.2px * var(--lf-blur)));
}
#lyrics-fallback-panel .lf-synced > span[data-distance="2"] { filter: blur(calc(0.7px * var(--lf-blur))); }
#lyrics-fallback-panel .lf-synced > span[data-distance="1"] { filter: blur(calc(0.3px * var(--lf-blur))); }
#lyrics-fallback-panel .lf-synced > span.lf-current { opacity: 1; filter: none; }
@media (prefers-reduced-motion: no-preference) {
	#lyrics-fallback-panel .lf-synced > span {
		transform: scale(0.9);
		transform-origin: var(--lf-origin, left center);
		transition: opacity var(--lf-duration) var(--lf-ease) 90ms, transform var(--lf-duration) var(--lf-ease) 90ms;
	}
	#lyrics-fallback-panel .lf-synced > span.lf-current { transform: scale(1); transition-delay: 0s; }
}

/* The three dots before the first line, pulsing while they're the "current line". */
#lyrics-fallback-panel .lf-dot {
	display: inline-block;
	width: 0.3em;
	height: 0.3em;
	margin-right: 0.3em;
	border-radius: 50%;
	background-color: currentColor;
	vertical-align: middle;
}
#lyrics-fallback-panel .lf-current > .lf-dot { animation: 1.6s ease-in-out infinite lf-dot-pulse; }
#lyrics-fallback-panel .lf-current > .lf-dot:nth-child(2) { animation-delay: 0.2s; }
#lyrics-fallback-panel .lf-current > .lf-dot:nth-child(3) { animation-delay: 0.4s; }
#lyrics-fallback-panel .lf-paused .lf-dot { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { #lyrics-fallback-panel .lf-dot { animation: none !important; } }
@keyframes lf-dot-pulse {
	0%, 100% { opacity: 0.85; transform: scale(0.7); }
	50% { opacity: 1; transform: scale(1); }
}

#lyrics-fallback-panel .lf-footer,
#lyrics-fallback-panel .lf-message {
	display: block;
	margin: var(--market-core-metrics-spacing-800, 64px) 0;
	font-size: 14px;
	font-weight: 400;
	opacity: 0.5;
}
#lyrics-fallback-panel .lf-message { margin-top: 0; font-size: 18px; }

/* Replacing TIDAL's Lyrics tab: its buttons are hidden (the tab itself may still open underneath ours). */
body.lf-replace [data-test="toggle-lyrics"],
body.lf-replace [data-test="mobile-toggle-lyrics"] { display: none !important; }
/* While the lyrics are open, the TIDAL tab open underneath to make room (Credits, or its own Lyrics) stays hidden and unhighlighted. */
/* (Everything inside too: TIDAL's scrollbars set themselves visible, which beats a hidden parent.) */
body.lf-open [data-test="now-playing-credits"],
body.lf-open [data-test="now-playing-credits"] *,
body.lf-open [data-test="now-playing-lyrics"],
body.lf-open [data-test="now-playing-lyrics"] *,
body.lf-open [data-test="now-playing-lyrics-loading"],
body.lf-open [data-test="now-playing-lyrics-loading"] * { visibility: hidden !important; }
body.lf-open [data-test="toggle-credits"] {
	background: transparent !important;
	color: rgb(255 255 255 / 0.55) !important;
}
[data-test="lyrics-fallback-toggle"][aria-pressed="true"] {
	background: rgb(255 255 255) !important;
	color: rgb(0 0 0) !important;
}`;

/**
 * Where the panel sits: the element it goes in (TIDAL's now-playing view,
 * so it stacks and slides with it) and its box, in pixels from that element's edges.
 */
export type Placement = { container: Element; top: number; left: number; width: number; height: number };

export class Panel {
	private readonly element = document.createElement("div");
	private readonly scroller = document.createElement("div");
	private readonly content = document.createElement("div");

	/** The lines (with the intro dots first, for synced lyrics), and when each starts. */
	private lineElements: HTMLElement[] = [];
	private times: number[] = [];
	private synced = false;
	private text?: HTMLElement;
	private current = -2;
	private manualScrollUntil = 0;
	/** Set while we scroll, so our own scrolling doesn't count as the user's. */
	private ourScrollUntil = 0;
	private frame = 0;

	constructor(
		unloads: LunaUnloads,
		private readonly place: () => Placement | undefined,
	) {
		new StyleTag("LyricsFallback", unloads, CSS);
		this.element.id = "lyrics-fallback-panel";
		this.element.hidden = true;

		this.scroller.className = "lf-scroll";
		this.content.className = "lf-content";
		this.scroller.append(this.content);
		this.element.append(this.scroller);

		const pause = () => {
			this.manualScrollUntil = performance.now() + MANUAL_SCROLL_PAUSE;
			this.text?.removeAttribute("data-following");
		};
		this.scroller.addEventListener("wheel", pause, { passive: true });
		this.scroller.addEventListener("touchmove", pause, { passive: true });
		this.scroller.addEventListener("scroll", () => performance.now() > this.ourScrollUntil && pause(), { passive: true });
		this.content.addEventListener("click", (event) => {
			const time = (event.target as HTMLElement).closest<HTMLElement>("[data-time]")?.dataset.time;
			if (time === undefined) return;
			this.manualScrollUntil = 0;
			this.current = -2; // Scroll to the clicked line even if it's the current one.
			PlayState.seek(Number(time));
		});

		document.body.append(this.element);
		unloads.add(() => {
			cancelAnimationFrame(this.frame);
			this.element.remove();
			document.body.classList.remove("lf-open");
		});
	}

	public get isOpen() {
		return !this.element.hidden;
	}

	public open() {
		if (this.isOpen) return;
		this.element.hidden = false;
		document.body.classList.add("lf-open");
		this.manualScrollUntil = 0;
		this.current = -2;
		delete this.scroller.dataset.placed;
		this.tick();
	}

	public close() {
		this.element.hidden = true;
		document.body.classList.remove("lf-open");
		cancelAnimationFrame(this.frame);
	}

	public show(content: PanelContent) {
		this.content.replaceChildren();
		this.lineElements = [];
		this.times = [];
		this.text = undefined;
		this.synced = false;
		this.current = -2;
		this.manualScrollUntil = 0;
		this.scroller.scrollTop = 0;
		delete this.scroller.dataset.placed;

		if ("message" in content) {
			const message = document.createElement("div");
			message.className = "lf-message";
			message.textContent = content.message;
			this.content.append(message);
			return;
		}

		const { lyrics } = content;
		this.synced = lyrics.synced;
		const text = (this.text = document.createElement("div"));
		text.className = `lf-text${lyrics.synced ? " lf-synced" : ""}${lyrics.rightToLeft ? " lf-rtl" : ""}`;
		text.dir = lyrics.rightToLeft ? "rtl" : "auto";

		if (lyrics.synced) {
			// TIDAL's intro: three dots that stand in as the current line until the singing starts.
			const intro = document.createElement("span");
			intro.setAttribute("aria-hidden", "true");
			intro.dataset.time = "0";
			intro.append(...[0, 1, 2].map(() => Object.assign(document.createElement("i"), { className: "lf-dot" })));
			this.lineElements.push(intro);
			this.times.push(-Infinity);
		}

		// TIDAL shows an empty line as a wider gap after the line before it, not as a line of its own.
		lyrics.lines.forEach((line, i) => {
			if (line.text === "") {
				this.lineElements.at(-1)?.classList.add("lf-stanza-end");
				return;
			}
			const span = document.createElement("span");
			span.textContent = line.text;
			if (line.time !== undefined) span.dataset.time = String(line.time);
			this.lineElements.push(span);
			this.times.push(line.time ?? i);
		});
		text.append(...this.lineElements);

		const footer = document.createElement("div");
		footer.className = "lf-footer";
		footer.textContent = `Lyrics from ${lyrics.source}${lyrics.synced ? "" : " (not synced)"}`;
		this.content.append(text, footer);
		if (this.isOpen) this.tick();
	}

	/** Every frame while open: follow the now-playing view's size and highlight the line being sung. */
	private tick = () => {
		cancelAnimationFrame(this.frame);
		if (!this.isOpen) return;

		const placement = this.place();
		if (placement) {
			if (this.element.parentElement !== placement.container) placement.container.append(this.element);
			const style = this.element.style;
			style.top = `${placement.top}px`;
			style.left = `${placement.left}px`;
			style.width = `${placement.width}px`;
			style.height = `${placement.height}px`;
		}

		if (this.synced) this.follow();
		this.frame = requestAnimationFrame(this.tick);
	};

	private follow() {
		const following = performance.now() >= this.manualScrollUntil;
		const time = playPosition() + LEAD;
		const playing = [...document.querySelectorAll<HTMLMediaElement>("video, audio")].some((media) => !media.paused);
		this.text?.classList.toggle("lf-paused", !playing);

		// The last line that has started (the intro dots before the first one).
		let index = 0;
		for (let i = 0; i < this.times.length && this.times[i] <= time; i++) index = i;

		const changed = index !== this.current;
		if (changed) {
			this.current = index;
			this.lineElements.forEach((line, i) => {
				line.classList.toggle("lf-current", i === index);
				if (i === index) line.removeAttribute("data-distance");
				else line.dataset.distance = String(Math.min(Math.abs(i - index), MAX_DISTANCE));
			});
		}
		if (!following) return;
		// Back to following after the user scrolled: return to the sung line.
		const resumed = !this.text?.hasAttribute("data-following");
		if (resumed) this.text?.setAttribute("data-following", "");
		if (!changed && !resumed && this.scroller.dataset.placed === "1") return;

		const line = this.lineElements[index];
		if (!line) return;
		const target = Math.max(0, line.offsetTop - this.scroller.clientHeight * LINE_POSITION);
		this.ourScrollUntil = performance.now() + 1000;
		this.scroller.scrollTo({ top: target, behavior: this.scroller.dataset.placed === "1" ? "smooth" : "instant" });
		this.scroller.dataset.placed = "1";
	}
}

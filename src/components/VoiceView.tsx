"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type LiveStatus = "connecting" | "listening" | "speaking" | "thinking" | "closed";

export type VoiceLine = { role: "user" | "assistant"; content: string };

type VoiceViewProps = {
  status: LiveStatus;
  /** The settled turns, newest last. Same list the typed chat uses. */
  lines: VoiceLine[];
  /** The half-finished line on each side, arriving as it is spoken. */
  partialUser: string;
  partialAssistant: string;
  /**
   * True only once the microphone is genuinely un-gated. Independent of
   * `status` on purpose: during the opening greeting the mic is deliberately
   * shut, and "speaking" alone can't say whether it is or not.
   */
  micLive: boolean;
  muted: boolean;
  /** Set when the session died on its own. Renders the ended state. */
  error: string | null;
  /**
   * Read once per animation frame instead of pushed in as state. A setState
   * per frame would re-render the whole panel sixty times a second for a
   * number whose only job is to move a transform.
   */
  getMicLevel: () => number;
  getVoiceLevel: () => number;
  onToggleMute: () => void;
  onEnd: () => void;
  onRetry: () => void;
  onKeyboard: () => void;
};

/* -------------------------------------------------------------------------- */
/* Level shaping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Turns a raw RMS reading into something worth animating.
 *
 * Two things matter and neither is obvious. The ceiling adapts, because a
 * quiet talker on a laptop mic peaks around 0.05 and a phone held close peaks
 * around 0.3 — a fixed divisor makes one of them barely move. And the
 * smoothing is asymmetric: fast attack, slow release, the shape every VU meter
 * has used for eighty years. It is the difference between reading as a voice
 * and reading as noise.
 *
 * One instance per SOURCE. The microphone and Ria's output sit at genuinely
 * different levels, and sharing one adaptive ceiling between them means the
 * user's reply is normalised against Ria's loudness for several seconds after
 * every turn — the orb would barely move at exactly the moment it most needs
 * to say "I can hear you".
 */
function makeMeter() {
  let smooth = 0;
  let ceiling = 0.08;
  let last = 0;
  return (raw: number, now: number) => {
    const dt = last === 0 ? 16 : Math.min(120, now - last);
    last = now;
    ceiling = Math.max(raw, ceiling * Math.pow(0.5, dt / 2500), 0.06);
    // 0.010 is a noise gate measured against room tone vs speech: below it the
    // orb shimmers at about 15%, which is honest (the mic really is hearing
    // the room) without looking like someone is talking.
    const norm = Math.pow(Math.min(1, Math.max(0, (raw - 0.01) / ceiling)), 0.7);
    const tau = norm > smooth ? 55 : 260;
    smooth += (norm - smooth) * (1 - Math.exp(-dt / tau));
    return smooth;
  };
}

/* -------------------------------------------------------------------------- */
/* Amounts                                                                    */
/* -------------------------------------------------------------------------- */

const NUM_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|" +
  "thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|" +
  "thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const SCALE = "(?:hundred|thousand|lakh|lakhs|crore|crores)";

/**
 * Amounts, and only amounts.
 *
 * Every branch requires a currency marker, a scale word, or Indian digit
 * grouping. A bare run of digits is deliberately NOT matched: an earlier cut
 * of this caught `\d{3,}` and turned request numbers, dates and phone numbers
 * into confetti, which is the one thing that would make a finance panel read
 * as a toy.
 *
 * The spelled-out branch is the point of the whole feature. "fifteen thousand"
 * misheard as "fifty thousand" is the mistake this view exists to catch, and
 * it only ever arrives from the transcriber as words.
 */
const AMOUNT = new RegExp(
  "(" +
    // ₹15,000 · Rs. 1.5 lakh · INR 2,50,000
    `(?:₹|rs\\.?|inr)\\s*\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:k|cr|${SCALE}))?` +
    // 2.5 crore · 40k · 15 thousand
    `|\\b\\d[\\d,]*(?:\\.\\d+)?\\s*(?:k|cr|${SCALE})\\b` +
    // 2,50,000 — grouped digits are an amount; ungrouped ones are not.
    "|\\b\\d{1,3}(?:,\\d{2,3})+\\b" +
    // "fifteen thousand" vs "fifty thousand"
    `|\\b${NUM_WORD}(?:[\\s-](?:and[\\s-])?${NUM_WORD})*[\\s-]${SCALE}\\b` +
    ")",
  "gi",
);

/**
 * Transcript text with amounts picked out.
 *
 * One mark, not three. Weight alone is enough to catch the eye on a line of
 * regular text, and a filled chip behind a figure that may wrap is how you get
 * two half-rounded boxes on separate lines. `whitespace-nowrap` keeps
 * "2.5 lakh" from splitting across the wrap in the first place.
 *
 * split() with a single capture group alternates plain/matched, so odd indices
 * are the amounts. Spans, never dangerouslySetInnerHTML — this is model output
 * and it is never trusted as markup.
 */
function Amounts({ text }: { text: string }) {
  const parts = useMemo(() => text.split(AMOUNT), [text]);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold whitespace-nowrap">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const COPY: Record<LiveStatus, { label: string; hint: string }> = {
  connecting: { label: "Connecting", hint: "Getting the microphone ready." },
  listening: { label: "Listening", hint: "Speak whenever you're ready." },
  speaking: { label: "Ria is speaking", hint: "Talk over her to cut in." },
  thinking: { label: "Looking it up", hint: "One moment." },
  closed: { label: "Voice ended", hint: "" },
};

export default function VoiceView({
  status,
  lines,
  partialUser,
  partialAssistant,
  micLive,
  muted,
  error,
  getMicLevel,
  getVoiceLevel,
  onToggleMute,
  onEnd,
  onRetry,
  onKeyboard,
}: VoiceViewProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // The animation loop is created once and would otherwise close over the
  // first render's props.
  const micRef = useRef(getMicLevel);
  const voiceRef = useRef(getVoiceLevel);
  const liveRef = useRef(micLive);
  const mutedRef = useRef(muted);
  useEffect(() => {
    micRef.current = getMicLevel;
    voiceRef.current = getVoiceLevel;
    liveRef.current = micLive;
    mutedRef.current = muted;
  });

  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Voice takes over the panel, so the panel's focus follows it. The region
  // rather than a button: landing on End means one stray Enter hangs up.
  useEffect(() => {
    regionRef.current?.focus({ preventScroll: true });
  }, []);

  // Follow the conversation, but never drag someone back down who has scrolled
  // up to re-read an amount. `behavior: "auto"` deliberately, not "smooth": a
  // smooth scroll fires scroll events all the way down, and the early frames
  // report a gap big enough to switch this off — the follow would disable
  // itself on every single turn.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, partialUser, partialAssistant]);

  useEffect(() => {
    const halo = haloRef.current;
    const ring = ringRef.current;
    const core = coreRef.current;
    if (!halo || !ring || !core) return;

    // One meter per source. See makeMeter.
    const micMeter = makeMeter();
    const voiceMeter = makeMeter();

    // The rings and the halo are welded to the MICROPHONE in every state, and
    // the core is welded to Ria. That split is the whole honesty argument:
    // "can it hear me" is answered continuously, including while she is
    // talking and the hint is inviting you to interrupt her — which is exactly
    // when withdrawing the mic reading would leave you guessing.
    const readMic = (now: number) => {
      if (!liveRef.current || mutedRef.current) return micMeter(0, now);
      return micMeter(micRef.current(), now);
    };

    const clear = () => {
      halo.style.transform = "";
      halo.style.opacity = "";
      ring.style.transform = "";
      ring.style.opacity = "";
      core.style.transform = "";
    };

    if (reduced) {
      // No scaling, no breathing. But a reduced-motion user still deserves to
      // know the microphone is hearing them — that is the one thing a voice UI
      // must communicate. So the level is quantised to four steps and written
      // only to opacity, over a deliberately shallow range at 250ms. A slow,
      // low-contrast cross-fade is not the vestibular trigger the setting is
      // asking us to stop, and both the step count and the interval keep it
      // well under the three-flashes-per-second general threshold.
      const id = window.setInterval(() => {
        const now = performance.now();
        const step = Math.round(readMic(now) * 3) / 3;
        halo.style.opacity = String(0.1 + step * 0.22);
        ring.style.opacity = String(0.25 + step * 0.25);
      }, 250);
      return () => {
        window.clearInterval(id);
        clear();
      };
    }

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const mic = readMic(now);
      const voice = voiceMeter(voiceRef.current(), now);
      // A 1.2% breath so the orb is never completely dead between turns.
      const breath = Math.sin(now / 1400) * 0.012;

      halo.style.transform = `scale(${1 + mic * 0.5 + breath})`;
      halo.style.opacity = String(0.1 + mic * 0.4);
      // Deliberately lags the halo: two layers moving in lockstep read as one
      // thick layer; a beat apart reads as something alive.
      ring.style.transform = `scale(${1 + mic * 0.3 + breath * 0.6})`;
      ring.style.opacity = String(0.3 + mic * 0.5);
      core.style.transform = `scale(${1 + voice * 0.22 + breath})`;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clear();
    };
  }, [reduced]);

  const ended = status === "closed" || error !== null;
  const busy = status === "connecting" || status === "thinking";
  const voicing = status === "speaking";

  const copy: { label: string; hint: string } = ended
    ? { label: "Voice ended", hint: error ?? "" }
    : muted
      ? { label: "Microphone off", hint: "Turn it back on when you want to talk." }
      : voicing && !micLive
        ? { label: "Ria is speaking", hint: "Your mic opens when she finishes." }
        : COPY[status];

  const recent = lines.slice(-12);
  // Absolute position in the full thread, so keys stay stable as the window
  // slides. Index-into-the-slice would re-key every line on each new turn.
  const offset = lines.length - recent.length;
  const nothingYet =
    recent.length === 0 && partialUser.trim() === "" && partialAssistant.trim() === "";

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Voice conversation with Ria"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onEnd();
        }
      }}
      // One accent, defined once, so the inline gradients below can be
      // theme-aware even though an inline style can't carry a dark: variant.
      // indigo-600 / indigo-400 as literal arbitrary properties, which is the
      // form Tailwind v4 can actually see.
      className="flex min-h-0 flex-1 flex-col outline-none [--ria-accent:#4f46e5] dark:[--ria-accent:#818cf8]"
    >
      {/* ---- Focal element ------------------------------------------------ */}
      <div className="flex min-h-0 shrink flex-col items-center overflow-hidden px-4 pt-4 pb-3">
        <div
          aria-hidden="true"
          className="relative flex items-center justify-center"
          // clamp so a short viewport takes it out of the transcript's budget
          // rather than the other way round.
          style={{ width: "clamp(76px, 15vh, 96px)", height: "clamp(76px, 15vh, 96px)" }}
        >
          {/* Halo — microphone amplitude you feel rather than read. */}
          <div
            ref={haloRef}
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--ria-accent) 55%, transparent) 0%, color-mix(in srgb, var(--ria-accent) 0%, transparent) 70%)",
              opacity: 0.12,
              willChange: "transform, opacity",
            }}
          />

          {/* One hairline ring. The earlier cut had two rings plus a spinner
              arc plus a core plus a specular — five concentric strokes at
              once during connecting, which tips from instrument to radar. */}
          <div
            ref={ringRef}
            className="absolute rounded-full border"
            style={{
              inset: "12%",
              borderColor: "color-mix(in srgb, var(--ria-accent) 32%, transparent)",
              opacity: 0.3,
              willChange: "transform, opacity",
            }}
          />

          {/* Connecting / looking-it-up: an arc, because there is nothing
              meaningful to measure yet. Under reduced motion it becomes a
              complete ring rather than a stationary 60-degree notch, which
              reads as a state marker instead of a rendering artifact. */}
          {busy && !ended && (
            <svg
              viewBox="0 0 100 100"
              aria-hidden="true"
              className={
                reduced
                  ? "absolute inset-0 h-full w-full"
                  : "absolute inset-0 h-full w-full animate-spin"
              }
              style={{ animationDuration: "2.6s" }}
            >
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="var(--ria-accent)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray={reduced ? undefined : "42 253"}
                opacity={reduced ? 0.35 : 0.75}
              />
            </svg>
          )}

          {/* Core. Same geometry throughout; only the fill flips. Solid while
              Ria is talking, hollow while she is receiving you, grey once the
              session is over. transition-colors and not transition-all — the
              transform belongs to the animation loop and a transition on it
              would fight the rAF writes every frame. */}
          <div
            ref={coreRef}
            className={
              ended
                ? "absolute rounded-full border border-zinc-300 bg-zinc-100 transition-colors duration-500 dark:border-zinc-700 dark:bg-zinc-800"
                : voicing
                  ? "absolute overflow-hidden rounded-full bg-indigo-600 shadow-lg shadow-indigo-600/25 transition-colors duration-500 dark:bg-indigo-500 dark:shadow-indigo-500/20"
                  : "absolute overflow-hidden rounded-full border border-indigo-500/40 bg-white shadow-sm transition-colors duration-500 dark:border-indigo-400/35 dark:bg-zinc-900"
            }
            style={{ width: "46%", height: "46%", willChange: "transform" }}
          >
            <span
              className="block h-full w-full"
              style={{
                background:
                  "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 58%)",
              }}
            />
          </div>

          {/* Muted reads as a state of the orb, not a badge on a toolbar.
              It is decorative only — the status text below carries the same
              fact for anyone not looking at it. */}
          {muted && !ended && (
            <span className="absolute bottom-0 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              <MicOffIcon size={13} />
            </span>
          )}
        </div>

        {/* Stable node, changing contents — announced reliably, and the fixed
            hint height means an empty hint never shifts the transcript. */}
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-3 text-center text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          {copy.label}
        </p>
        <p
          className={
            ended && error
              ? "mt-1 min-h-8 px-2 text-center text-xs leading-4 text-red-600 dark:text-red-400"
              : "mt-1 min-h-8 px-2 text-center text-xs leading-4 text-zinc-500 dark:text-zinc-400"
          }
        >
          {copy.hint}
        </p>
      </div>

      {/* ---- Transcript ---------------------------------------------------- */}
      <div
        ref={logRef}
        onScroll={() => {
          const el = logRef.current;
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3"
      >
        {nothingYet ? (
          <p className="px-2 pt-1 text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
            {ended
              ? "Nothing was said this time."
              : "Everything either of you says appears here as it’s spoken, so you can check a vendor or an amount before acting on it."}
          </p>
        ) : null}

        {/* Settled turns. The announced region; partials are handled
            separately so a screen reader is not read every fragment twice. */}
        <div role="log" aria-live="polite" aria-relevant="additions" className="space-y-3">
          {recent.map((m, i) => (
            <div key={offset + i}>
              <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                {m.role === "user" ? "You" : "Ria"}
              </p>
              <p
                className={
                  m.role === "user"
                    ? "mt-0.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300"
                    : "mt-0.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
                }
              >
                <Amounts text={m.content} />
              </p>
            </div>
          ))}
        </div>

        {/* In-progress lines. Same position and shape as the settled line, in
            a lighter ink, so a turn settling is a change of colour rather than
            a jump.

            The USER partial is announced: catching "fifty" when you said
            "fifteen" while there is still time to correct it is the entire
            point, and leaving it aria-hidden would make that sighted-only.
            Ria's partial is not announced — the user is already hearing it,
            and reading it over her is pure noise. */}
        {partialUser.trim() !== "" && (
          <div role="status" aria-live="polite" aria-atomic="true">
            <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
              You
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              <Amounts text={partialUser} />
              <Caret />
            </p>
          </div>
        )}
        {partialAssistant.trim() !== "" && (
          <div aria-hidden="true">
            <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
              Ria
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              <Amounts text={partialAssistant} />
              <Caret />
            </p>
          </div>
        )}
      </div>

      {/* ---- Controls ------------------------------------------------------ */}
      <div
        className="shrink-0 border-t border-zinc-100 px-4 pt-3 dark:border-zinc-800"
        style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
      >
        {ended ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="h-11 flex-1 rounded-full bg-indigo-600 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-offset-zinc-900"
            >
              Try voice again
            </button>
            <button
              type="button"
              onClick={onKeyboard}
              className="h-11 flex-1 rounded-full border border-zinc-300 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-offset-zinc-900"
            >
              Back to typing
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-8 sm:gap-10">
            <ControlButton
              label={muted ? "Unmute" : "Mute"}
              ariaLabel={muted ? "Turn the microphone back on" : "Mute the microphone"}
              ariaPressed={muted}
              onClick={onToggleMute}
              tone={muted ? "warn" : "quiet"}
            >
              {muted ? <MicOffIcon size={19} /> : <MicIcon size={19} />}
            </ControlButton>

            <ControlButton
              label="End"
              ariaLabel="End the voice conversation"
              onClick={onEnd}
              tone="end"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
              </svg>
            </ControlButton>

            <ControlButton
              label="Type"
              ariaLabel="End voice and go back to typing"
              onClick={onKeyboard}
              tone="quiet"
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="6" width="20" height="12" rx="2.5" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              </svg>
            </ControlButton>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ControlButton({
  children,
  label,
  ariaLabel,
  ariaPressed,
  onClick,
  tone,
}: {
  children: ReactNode;
  label: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  onClick: () => void;
  tone: "quiet" | "warn" | "end";
}) {
  // Full literal class strings per branch. Nothing here is assembled from a
  // variable, because Tailwind v4 only ships classes it can read in source.
  //
  // All three are h-12. An earlier cut made End h-14, which both misaligned
  // the labels by 8px and put the largest control in a finance panel on the
  // destructive action.
  const skin =
    tone === "end"
      ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:bg-amber-400/15 dark:text-amber-300 dark:hover:bg-amber-400/25"
        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-offset-zinc-900 ${skin}`}
      >
        {children}
      </button>
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
}

/** A caret on an in-progress line. Steady opacity under reduced motion. */
function Caret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-current align-middle motion-reduce:animate-none"
    />
  );
}

function MicIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
    </svg>
  );
}

function MicOffIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 9V5a3 3 0 0 1 5.9-.7M15 12.3V11" />
      <path d="M19 10v1a7 7 0 0 1-10.6 6M5 11v-1M12 18v4" />
      <path d="M4 3l16 18" />
    </svg>
  );
}

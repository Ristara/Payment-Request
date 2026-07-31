"use client";

import { useEffect, useRef, useState } from "react";
import { useAssistant } from "@/components/AssistantContext";

type Msg = { role: "user" | "assistant"; content: string };

// Minimal typings for the (webkit-prefixed) Web Speech API.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
        resultIndex: number;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Ria (Raghav Intelligent Assistant) — the floating in-app assistant.
 *
 * Voice today uses the BROWSER's Web Speech API for both listening and
 * speaking, with Gemini only handling the text in between. That keeps it free
 * and simple, at the cost of a flat system voice and a speak-wait-listen
 * rhythm.
 *
 * PLANNED: move to Gemini's Live API for a real spoken conversation — natural
 * voice, interruption mid-sentence, no transcribe-then-reply lag. It's a
 * different shape: a persistent WebSocket streaming audio both ways, relayed
 * through our server so the key never reaches the browser, and billed per
 * minute of audio rather than per message. Models already available on our
 * key (bidiGenerateContent): gemini-2.5-flash-native-audio-latest and
 * gemini-3.1-flash-live-preview. Roughly 2-3 days of work.
 *
 * Privacy: the transcript lives only in
 * this component's state, nothing is stored on the server, so no user can
 * ever see another user's chat.
 */
export default function AssistantWidget() {
  // Shared so the phone trigger can live up in the top bar.
  const { open, setOpen } = useAssistant();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hands-free mode: listen → send on a pause → speak the reply → listen
  // again. Refs mirror the state because the speech callbacks are created
  // once and would otherwise close over stale values.
  const [voiceMode, setVoiceMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceModeRef = useRef(false);
  const sendRef = useRef<(text?: string) => void>(() => {});
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    setVoiceSupported(getRecognitionCtor() !== null);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  function startListening() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      let done = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) done = true;
      }
      setInput(text);
      // Hands-free: a completed phrase is the cue to send, no tap needed.
      if (done && voiceModeRef.current && text.trim()) {
        rec.stop();
        sendRef.current(text.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  function stopListening() {
    const rec = recRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.stop();
      recRef.current = null;
    }
    setListening(false);
  }

  function toggleMic() {
    if (listening) {
      stopListening();
      return;
    }
    // Interrupt a long answer rather than waiting it out.
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
    startListening();
  }

  /** Turning voice mode off must silence anything mid-sentence. */
  function toggleVoiceMode() {
    const next = !voiceMode;
    setVoiceMode(next);
    voiceModeRef.current = next;
    if (next) {
      startListening();
    } else {
      stopListening();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
  }

  function speak(text: string, onDone?: () => void) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN";
    setSpeaking(true);
    u.onend = () => {
      setSpeaking(false);
      onDone?.();
    };
    u.onerror = () => {
      setSpeaking(false);
      onDone?.();
    };
    window.speechSynthesis.speak(u);
  }

  async function send(spoken?: string) {
    const question = (spoken ?? input).trim();
    if (!question || busy) return;
    // Detach handlers BEFORE stopping, or a pending speech result refills
    // the input with the question we just sent.
    stopListening();
    const next: Msg[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      const reply = res.ok && data.reply ? data.reply : data.error || "Something went wrong — try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      // Hands-free: read the answer out, then reopen the mic for the reply.
      if (voiceModeRef.current) {
        speak(reply, () => {
          if (voiceModeRef.current) startListening();
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Couldn't reach Ria — check your connection and try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  // Speech callbacks are created once, so route them through a ref to reach
  // the current send().
  useEffect(() => {
    sendRef.current = (text?: string) => void send(text);
  });

  // Never leave the mic live or a sentence half-spoken after the panel is
  // closed or the page navigates away.
  useEffect(() => {
    if (open) return;
    voiceModeRef.current = false;
    setVoiceMode(false);
    stopListening();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      voiceModeRef.current = false;
      recRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  return (
    <>
      {/* Floating button — desktop only; phones trigger from the top bar. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Ria" : "Ask Ria"}
        className="fixed bottom-5 right-5 z-40 hidden h-13 w-13 sm:flex items-center justify-center rounded-full bg-indigo-600 p-3.5 text-white shadow-lg shadow-indigo-600/30 transition-transform hover:scale-105 active:scale-95"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" />
            <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
          </svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-20 sm:right-5 sm:h-[560px] sm:w-[400px] sm:rounded-2xl dark:border-zinc-700 dark:bg-zinc-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ria</p>
              <p className="text-[10px] text-zinc-500">Private to you — chats aren&apos;t saved</p>
            </div>
            <div className="flex items-center gap-2">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceMode}
                  aria-pressed={voiceMode}
                  title={voiceMode ? "Leave voice conversation" : "Talk to Ria hands-free"}
                  className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                    voiceMode
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {voiceMode ? "Voice on" : "Voice"}
                </button>
              )}
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  New chat
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="mt-6 space-y-2 text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Hi, I&rsquo;m Ria — ask me about your payments
                  {voiceSupported && (
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      Tap <span className="font-medium">Voice</span> above to just talk.
                    </span>
                  )}
                </p>
                <div className="mx-auto flex max-w-[280px] flex-col gap-1.5">
                  {[
                    "What's waiting for my approval?",
                    "What's ready to pay right now?",
                    "Why can't I approve EssEmm Corporation?",
                    "Which payments are overdue?",
                    "Spend by category",
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setInput(q)}
                      className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-indigo-950/40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      onClick={() => speak(m.content)}
                      aria-label="Read aloud"
                      className="mt-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input — the typing box, or the voice bar during a conversation */}
          {/* Inline style: Tailwind can't express env() padding here. */}
          <div
            className="border-t border-zinc-100 p-3 dark:border-zinc-800"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            {voiceMode ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-label={listening ? "Stop listening" : "Start listening"}
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                    listening
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {listening && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" />
                  )}
                  <svg className="relative" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        listening
                          ? "animate-pulse bg-red-500"
                          : speaking
                            ? "animate-pulse bg-emerald-500"
                            : busy
                              ? "animate-pulse bg-indigo-500"
                              : "bg-zinc-300"
                      }`}
                    />
                    {listening ? "Listening" : speaking ? "Ria is speaking" : busy ? "Thinking" : "Tap the mic to talk"}
                  </p>
                  <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                    {input || (
                      <span className="text-zinc-400">
                        {speaking ? "Tap the mic to interrupt." : "Just speak — it sends when you pause."}
                      </span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={toggleVoiceMode}
                  className="shrink-0 rounded-full bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
                >
                  End
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  maxLength={4000}
                  placeholder="Ask a question…"
                  className="max-h-24 flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
                />
                {voiceSupported && (
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={listening ? "Stop listening" : "Speak your question"}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      listening
                        ? "animate-pulse bg-red-500 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white disabled:opacity-40"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addComment } from "@/app/requests/actions";
import { avatarColor, initials, timeShort } from "@/lib/routing";

export type ThreadAttachment = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string | null;
  url: string | null;
};

export type CommentItem = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_email: string;
  is_me: boolean;
  mentioned_names: string[];
  attachments: ThreadAttachment[];
};

type Candidate = { id: string; full_name: string; email: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function DiscussionThread({
  requestId,
  comments,
  candidates,
}: {
  requestId: string;
  comments: CommentItem[];
  candidates: Candidate[];
}) {
  const [state, formAction, pending] = useActionState(addComment, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mentions, setMentions] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  // Inline @-mention autocomplete state
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);

  const suggestions =
    mentionQuery === null
      ? []
      : candidates
          .filter((c) => {
            const q = mentionQuery.toLowerCase();
            return (
              !q ||
              c.full_name.toLowerCase().includes(q) ||
              c.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 6);

  function detectMention(value: string, caret: number) {
    // Look backwards from the caret for an "@" that starts a mention token
    // (start of text or preceded by whitespace), with no whitespace between
    // it and the caret beyond single spaces inside a name.
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return null;
    if (at > 0 && !/\s/.test(upto[at - 1])) return null;
    const token = upto.slice(at + 1);
    if (token.includes("\n") || token.length > 40) return null;
    return { start: at, query: token };
  }

  function onBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    const hit = detectMention(value, e.target.selectionStart ?? value.length);
    if (hit) {
      setMentionQuery(hit.query);
      setMentionStart(hit.start);
      setActiveIdx(0);
    } else {
      setMentionQuery(null);
    }
  }

  function pickSuggestion(c: Candidate) {
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, mentionStart)}@${c.full_name} ${body.slice(caret)}`;
    setBody(next);
    setMentions((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
    setMentionQuery(null);
    // Restore focus + caret just after the inserted name.
    requestAnimationFrame(() => {
      const pos = mentionStart + c.full_name.length + 2;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function onBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
    }
  }

  // No router.refresh() here — addComment's revalidatePath already returns
  // the fresh RSC tree with the action response; refreshing again re-rendered
  // the heaviest page a second time and re-minted every signed URL.
  useEffect(() => {
    if (state?.info) {
      formRef.current?.reset();
      setBody("");
      setMentions([]);
      setFiles([]);
      setMentionQuery(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [state]);

  useEffect(() => {
    if (!fileInputRef.current) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    fileInputRef.current.files = dt.files;
  }, [files]);

  function toggleMention(id: string) {
    setMentions((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
  }

  const mentionedProfiles = candidates.filter((c) => mentions.includes(c.id));

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Discussion ({comments.length})
      </h2>

      {comments.length > 0 ? (
        <ol className="mt-5 space-y-4">
          {comments.map((c, i) => {
            const prev = i > 0 ? comments[i - 1] : null;
            const isFollowUp =
              !!prev &&
              prev.author_id === c.author_id &&
              new Date(c.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
            return (
              <li key={c.id} className={`flex gap-3 ${c.is_me ? "flex-row-reverse" : ""}`}>
                <div className="w-9 shrink-0">
                  {!isFollowUp && (
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(c.author_email || c.author_name)}`}>
                      {initials(c.author_name)}
                    </div>
                  )}
                </div>
                <div className={`max-w-[80%] ${c.is_me ? "items-end" : "items-start"} flex flex-col`}>
                  {!isFollowUp && (
                    <div className={`mb-1 flex items-baseline gap-2 text-xs ${c.is_me ? "flex-row-reverse" : ""}`}>
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {c.author_name}
                        {c.is_me && <span className="ml-1 text-[10px] font-normal text-zinc-500">(you)</span>}
                      </span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-500">{timeShort(c.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm ${
                      c.is_me
                        ? "rounded-tr-sm bg-indigo-600 text-white"
                        : "rounded-tl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    {c.mentioned_names.length > 0 && (
                      <p className={`mb-1 text-[11px] font-medium ${c.is_me ? "text-indigo-100" : "text-indigo-600 dark:text-indigo-400"}`}>
                        @{c.mentioned_names.join(", @")}
                      </p>
                    )}
                    {c.body && c.body !== "(attachment)" && <p>{c.body}</p>}
                    {c.attachments.length > 0 && (
                      <div className={`${c.body && c.body !== "(attachment)" ? "mt-2" : ""} grid gap-2 ${c.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {c.attachments.map((a) => (
                          <ChatAttachment key={a.id} a={a} dark={c.is_me} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No messages yet. Start the conversation below.</p>
      )}

      <form
        ref={formRef}
        action={formAction}
        className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLFormElement).requestSubmit();
          }
        }}
      >
        <input type="hidden" name="request_id" value={requestId} />
        {mentions.map((id) => (
          <input key={id} type="hidden" name="mentions" value={id} />
        ))}

        {mentionedProfiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {mentionedProfiles.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
              >
                @{p.full_name}
                <button type="button" onClick={() => toggleMention(p.id)} className="text-indigo-500 hover:text-indigo-700">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            name="body"
            rows={2}
            value={body}
            onChange={onBodyChange}
            onKeyDown={onBodyKeyDown}
            placeholder="Write a message… type @ to tag someone"
            className="w-full resize-none rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {mentionQuery !== null && suggestions.length > 0 && (
            <ul className="absolute left-2 top-full z-20 -mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {suggestions.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickSuggestion(c);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      i === activeIdx
                        ? "bg-indigo-50 dark:bg-indigo-950/60"
                        : ""
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(c.email)}`}>
                      {initials(c.full_name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{c.full_name}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{c.email}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <input ref={fileInputRef} type="file" name="attachments" multiple className="hidden" onChange={onFilePicked} />

        {files.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {files.map((f, idx) => (
              <li key={idx} className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs dark:bg-zinc-800">
                📎 {f.name} <span className="text-zinc-500">{formatBytes(f.size)}</span>
                <button type="button" onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))} className="text-zinc-400 hover:text-red-600">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700"
          >
            📎 Attach
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-xs">
              {state?.error && <span className="text-red-600">{state.error}</span>}
              {state?.info && <span className="text-emerald-600">{state.info}</span>}
            </div>
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>

      </form>
    </div>
  );
}

function ChatAttachment({ a, dark }: { a: ThreadAttachment; dark: boolean }) {
  const isImage = (a.mime_type ?? "").startsWith("image/");
  const tile = dark
    ? "bg-indigo-700/50 hover:bg-indigo-700 text-white"
    : "bg-white/70 hover:bg-white dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-200";
  if (!a.url) {
    return <div className={`rounded-md px-2 py-1 text-xs ${tile}`}>{a.file_name}</div>;
  }
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden rounded-md text-xs ${tile}`}>
      {isImage && (
        <div className="aspect-video w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.url} alt={a.file_name} className="h-full w-full object-cover" />
        </div>
      )}
      <div className="flex items-center gap-2 px-2 py-1.5">
        📎 <span className="truncate">{a.file_name}</span>
        <span className={dark ? "text-white/70" : "text-zinc-500"}>{formatBytes(a.file_size_bytes)}</span>
      </div>
    </a>
  );
}


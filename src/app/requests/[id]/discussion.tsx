"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addComment, setQuestionState } from "@/app/requests/actions";
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
  is_question: boolean;
  question_state: string | null;
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
  const router = useRouter();

  const [mentions, setMentions] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [isQuestion, setIsQuestion] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);

  useEffect(() => {
    if (state?.info) {
      formRef.current?.reset();
      setMentions([]);
      setFiles([]);
      setIsQuestion(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    }
  }, [state, router]);

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
                        : c.is_question
                          ? "rounded-tl-sm bg-amber-50 text-zinc-900 dark:bg-amber-950 dark:text-amber-100"
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
                    {c.is_question && (
                      <div className={`mt-2 flex items-center gap-2 text-[11px] ${c.is_me ? "text-indigo-100" : "text-amber-800 dark:text-amber-300"}`}>
                        <span>Question:</span>
                        <QuestionStateChip state={c.question_state ?? "open"} commentId={c.id} requestId={requestId} isMe={c.is_me} />
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

        <textarea
          name="body"
          rows={2}
          placeholder={mentions.length > 0 ? `Message @${candidates.find((c) => c.id === mentions[0])?.full_name.split(" ")[0]}…` : "Write a message…"}
          className="w-full resize-none rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />

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
          <button
            type="button"
            onClick={() => setShowMentionPicker((v) => !v)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              showMentionPicker || mentions.length > 0
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            @ Mention
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              name="is_question"
              checked={isQuestion}
              onChange={(e) => setIsQuestion(e.target.checked)}
            />
            This is a question
          </label>

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

        {showMentionPicker && (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Pick who to mention:</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {candidates.map((c) => {
                const on = mentions.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <input type="checkbox" checked={on} onChange={() => toggleMention(c.id)} />
                      <span className="text-zinc-800 dark:text-zinc-200">{c.full_name}</span>
                      <span className="text-zinc-500">{c.email}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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

function QuestionStateChip({
  state,
  commentId,
  requestId,
  isMe,
}: {
  state: string;
  commentId: string;
  requestId: string;
  isMe: boolean;
}) {
  const label = state === "open" ? "Open" : state === "answered" ? "Answered" : "Resolved";
  return (
    <form action={setQuestionState} className="inline-flex items-center gap-1">
      <input type="hidden" name="comment_id" value={commentId} />
      <input type="hidden" name="request_id" value={requestId} />
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
        state === "resolved" || state === "answered"
          ? isMe ? "bg-emerald-500/30" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
          : isMe ? "bg-white/20" : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
      }`}>{label}</span>
      {state === "open" && (
        <>
          <button name="state" value="answered" type="submit" className="text-[10px] underline">
            mark answered
          </button>
          <button name="state" value="resolved" type="submit" className="text-[10px] underline">
            resolved
          </button>
        </>
      )}
    </form>
  );
}

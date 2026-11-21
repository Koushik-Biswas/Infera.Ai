"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileArchive, Loader2, Sparkles, Upload, Users } from "lucide-react";
import { useUI } from "@/components/providers";
import { buttonClass } from "@/components/ui/button-class";
import { parseExportFile, type ParsedChat } from "@/lib/app/whatsapp";
import { useStore } from "../store";
import { Chip, go, inputCls, Modal, useHashRoute } from "../ui";

/** `into`: id of the existing chat to merge this file into ("Re-import chat"). */
type Pending = { file: string; parsed: ParsedChat; me: string; name: string; into?: string };

export function ImportDialog({ open, shared, onClose }: { open: boolean; shared: boolean; onClose: () => void }) {
  const { importChat, loadSample, chats } = useStore();
  const { toast } = useUI();
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [os, setOs] = useState<"android" | "iphone">("android");
  const input = useRef<HTMLInputElement>(null);
  const route = useHashRoute();
  const intoId = open ? route.query.get("into") : null;
  const target = intoId ? chats.find((c) => c.id === intoId) : undefined;
  // Changes every time the dialog opens or closes; results from an older session are dropped.
  const session = useRef(0);

  useEffect(() => {
    session.current++;
    if (!open) {
      setPending([]);
      setErrors([]);
      setBusy(false);
    }
    if (/iphone|ipad/i.test(navigator.userAgent)) setOs("iphone");
  }, [open]);

  async function handle(files: File[]) {
    const token = session.current;
    setBusy(true);
    const errs: string[] = [];
    const next: Pending[] = [];
    for (const f of files) {
      if (session.current !== token) return; // dialog closed or reopened
      try {
        const parsed = await parseExportFile(f);
        if (!parsed.messages.length) throw new Error("No messages found.");
        next.push({ file: f.name, parsed, me: parsed.guessedMe ?? "", name: parsed.name });
      } catch (e) {
        errs.push(`${f.name}: ${e instanceof Error ? e.message : "couldn't read this file"}`);
      }
    }
    if (session.current !== token) return; // drop stale results
    // "Re-import chat": merge the first file into the chat it was opened from.
    setPending((p) => (target && next.length && !p.some((x) => x.into) ? [...p, { ...next[0], into: target.id, name: target.name }, ...next.slice(1)] : [...p, ...next]));
    setErrors(errs);
    setBusy(false);
  }

  // Files shared from WhatsApp via the installed app's share sheet.
  useEffect(() => {
    if (!open || !shared || !("caches" in window)) return;
    (async () => {
      const cache = await caches.open("infera-share");
      const keys = await cache.keys();
      const files: File[] = [];
      for (const k of keys) {
        const res = await cache.match(k);
        if (!res) continue;
        const name = decodeURIComponent(res.headers.get("X-File-Name") ?? "chat.txt");
        files.push(new File([await res.blob()], name, { type: res.headers.get("Content-Type") ?? "" }));
        await cache.delete(k);
      }
      if (files.length) handle(files);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shared]);

  async function doImport() {
    setBusy(true);
    let last = "";
    let total = 0;
    try {
      for (const p of pending) {
        const res = await importChat({ ...p.parsed, name: p.name.trim() || p.parsed.name }, p.me || null, { into: p.into });
        last = res.chatId;
        total += res.added;
      }
      toast({ title: `Imported ${total.toLocaleString()} messages`, body: "Collections with autopilot on were updated." });
      setPending([]);
      go(pending.length === 1 ? `chats/${last}` : "chats", true);
    } catch (e) {
      toast({ tone: "info", title: "Import failed", body: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import WhatsApp chats" wide>
      <div className="space-y-5 p-5">
        {pending.length === 0 ? (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                handle([...e.dataTransfer.files]);
              }}
              className={`flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${drag ? "border-brand bg-brand/5" : "border-line-strong"}`}
            >
              {busy ? <Loader2 className="size-8 animate-spin text-brand" /> : <Upload className="size-8 text-brand" />}
              <p className="mt-3 font-semibold">{busy ? "Reading your chat…" : "Drop exported chats here"}</p>
              <p className="mt-1 text-sm text-muted">.zip (with media) or .txt — as many chats as you like</p>
              <button onClick={() => input.current?.click()} className={buttonClass("primary", "md", "mt-5")} disabled={busy}>
                Choose files
              </button>
              <input
                ref={input}
                type="file"
                multiple
                accept=".txt,.zip,text/plain,application/zip"
                className="hidden"
                onChange={(e) => {
                  handle([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </div>
            {errors.map((e) => (
              <p key={e} className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                {e}
              </p>
            ))}
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">How to export a chat from WhatsApp</p>
                <div className="flex gap-1.5">
                  <Chip active={os === "android"} onClick={() => setOs("android")}>
                    Android
                  </Chip>
                  <Chip active={os === "iphone"} onClick={() => setOs("iphone")}>
                    iPhone
                  </Chip>
                </div>
              </div>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-fg-soft">
                {os === "android" ? (
                  <>
                    <li>Open the chat or group in WhatsApp.</li>
                    <li>Tap ⋮ → More → <strong>Export chat</strong> → <strong>Include media</strong>.</li>
                    <li>
                      Pick <strong>Infera</strong> in the share sheet (installed app), or save the file and drop it here.
                    </li>
                  </>
                ) : (
                  <>
                    <li>Open the chat and tap the contact or group name at the top.</li>
                    <li>Scroll down → <strong>Export Chat</strong> → <strong>Attach Media</strong>.</li>
                    <li>Choose <strong>Save to Files</strong>, then pick the .zip here.</li>
                  </>
                )}
              </ol>
              <p className="mt-3 text-xs text-muted">Files are read on this device and never uploaded. Re-import the same chat later and only new messages are added.</p>
            </div>
            {chats.length === 0 && (
              <button
                onClick={async () => {
                  setBusy(true);
                  await loadSample();
                  setBusy(false);
                  toast({ title: "Sample workspace loaded", body: "9 chats from a clothing boutique. Try asking Infera AI something." });
                  go("chats", true);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-line p-4 text-left transition hover:border-line-strong hover:bg-sunken/50"
              >
                <Sparkles className="size-5 shrink-0 text-brand" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">No export handy? Try the sample workspace</span>
                  <span className="block text-xs text-muted">A boutique&apos;s chats with orders, payments, leads, photos and PDFs.</span>
                </span>
              </button>
            )}
          </>
        ) : (
          <>
            <div className="space-y-3">
              {pending.map((p, i) => {
                const first = p.parsed.messages[0]?.at;
                const last = p.parsed.messages[p.parsed.messages.length - 1]?.at;
                const media = p.parsed.messages.filter((m) => m.attachmentName && p.parsed.media.has(m.attachmentName)).length;
                return (
                  <div key={i} className="rounded-2xl border border-line p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                        {p.parsed.isGroup ? <Users className="size-5" /> : <FileArchive className="size-5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <input
                          value={p.name}
                          onChange={(e) => setPending((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                          className={`${inputCls} h-9 font-semibold`}
                          aria-label="Chat name"
                        />
                        <p className="mt-1.5 text-xs text-muted">
                          {p.parsed.messages.length.toLocaleString()} messages · {media} media files · {p.parsed.senders.length} people
                          {first && last ? ` · ${new Date(first).toLocaleDateString()} – ${new Date(last).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                    </div>
                    <label className="mt-3 block text-xs font-medium text-fg-soft">
                      Which one is you?
                      <select
                        value={p.me}
                        onChange={(e) => setPending((all) => all.map((x, j) => (j === i ? { ...x, me: e.target.value } : x)))}
                        className={`${inputCls} mt-1 h-9`}
                      >
                        <option value="">I&apos;m not in this list</option>
                        {p.parsed.senders.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={doImport} disabled={busy} className={buttonClass("brand", "md", "flex-1")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Import {pending.length > 1 ? `${pending.length} chats` : "chat"}
              </button>
              <button onClick={() => input.current?.click()} className={buttonClass("secondary", "md")}>
                Add more
              </button>
              <input ref={input} type="file" multiple accept=".txt,.zip" className="hidden" onChange={(e) => handle([...(e.target.files ?? [])])} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

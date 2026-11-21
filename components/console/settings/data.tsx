"use client";

/** /console/settings/data — export everything, plain-language privacy summary, delete workspace (owner). */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Clock, Download, EyeOff, Lock, ScrollText, Sparkles, Trash2 } from "lucide-react";
import { useUI } from "@/components/providers";
import { api, useApi } from "@/lib/client/api";
import { downloadFile } from "@/lib/client/browser";
import { errorMessage } from "@/lib/client/errors";
import type { WorkspaceDTO } from "@/lib/shared/types";
import { useSession } from "../session";
import { Card, Callout } from "../kit/surface";
import { Badge } from "../kit/badges";
import { Button } from "../kit/form";
import { ConfirmDialog } from "../kit/overlay";
import { WORKSPACE_PATH } from "./frame";

const AI_MODE_TEXT = { off: "Rules only — no message text is sent to an AI provider.", assist: "Assist — AI is used only when the rules are unsure.", full: "Full AI — AI reads every relevant message." } as const;

export function DataSettings() {
  const router = useRouter();
  const { toast } = useUI();
  const { workspace: sessionWs, can, reset } = useSession();
  const { data } = useApi<WorkspaceDTO>(WORKSPACE_PATH);
  const ws = data ?? sessionWs;
  const admin = can("admin");
  const owner = can("owner");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function exportAll() {
    if (!ws) return;
    try {
      await downloadFile("/api/v1/export", `infera-${ws.slug}-${new Date().toISOString().slice(0, 10)}.json`);
      toast({ title: "Export downloaded", body: "Keep the file somewhere safe — it contains your workspace data." });
    } catch (e) {
      toast({ tone: "info", title: "Couldn't export data", body: errorMessage(e) });
    }
  }

  async function deleteWorkspace() {
    if (!ws) return;
    await api(WORKSPACE_PATH, { method: "DELETE", body: { confirm: ws.slug } });
    toast({ title: "Workspace deleted", body: `${ws.name} and its data were permanently removed.` });
    await reset();
    router.replace("/console");
  }

  const s = ws?.settings;
  const privacy = [
    {
      icon: <Lock />,
      title: "Secrets are encrypted at rest",
      body: "Channel tokens, app secrets and webhook signing secrets are encrypted (AES-GCM) and never shown again after you save them. API keys are stored only as hashes.",
    },
    {
      icon: <EyeOff />,
      title: "Personal data is redacted before AI",
      status: s ? (s.redactPII ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>) : null,
      body: "Phone numbers and email addresses are replaced with placeholders before any text reaches the AI provider, and restored afterwards.",
    },
    {
      icon: <Sparkles />,
      title: "AI suggestions are never presented as facts",
      body: `${s ? AI_MODE_TEXT[s.aiMode] + " " : ""}Every extracted value must be backed by a quote from the message; anything else is labelled as an AI suggestion.`,
    },
    {
      icon: <Clock />,
      title: s?.retentionDays ? `Messages are kept for ${s.retentionDays} days` : "Messages are kept until you delete them",
      body: "When retention is set, old message text and files are deleted automatically. Records you've built from them are kept.",
    },
    {
      icon: <ScrollText />,
      title: "Every change is audited",
      body: "Record edits, settings, member and key changes are logged with who did what and when.",
      link: admin ? { href: "/console/audit", label: "Open audit log" } : undefined,
    },
    {
      icon: <Building2 />,
      title: "Your data stays in this workspace",
      body: "Every request is scoped to this workspace; members of other workspaces can't see it. Automations can only reach outside Infera when an admin allows external actions.",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Export your data"
        description="Download everything in this workspace as one JSON file: collections, records with their history, conversations, messages, contacts, automations and the audit log. Secrets and password hashes are never included."
      >
        {admin ? (
          <Button icon={<Download />} onClick={exportAll} disabled={!ws}>
            Export all data
          </Button>
        ) : (
          <p className="text-sm text-muted">Ask a workspace admin to export the data.</p>
        )}
      </Card>

      <Card title="How your data is protected" description="In plain language.">
        <ul className="grid gap-4 sm:grid-cols-2">
          {privacy.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand [&>svg]:size-4" aria-hidden>
                {p.icon}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {p.title}
                  {p.status}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{p.body}</p>
                {p.link && (
                  <Link href={p.link.href} className="mt-1 inline-block text-[13px] font-medium text-brand hover:underline">
                    {p.link.label}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        {admin && (
          <p className="mt-5 border-t border-line pt-4 text-[13px] text-muted">
            Change AI mode, redaction and retention in{" "}
            <Link href="/console/settings" className="font-medium text-brand hover:underline">
              General settings
            </Link>
            .
          </p>
        )}
      </Card>

      <Card title="Danger zone" className="border-rose-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-sm font-medium text-fg">Delete this workspace</p>
            <p className="mt-0.5 text-[13px] text-muted">
              Permanently deletes {ws ? <strong className="font-medium text-fg-soft">{ws.name}</strong> : "the workspace"} with all channels, conversations, messages, files, collections, records,
              automations and API keys. Members lose access. This can&apos;t be undone.
            </p>
          </div>
          {owner ? (
            <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} disabled={!ws}>
              Delete workspace
            </Button>
          ) : (
            <Callout tone="info" className="basis-60">
              Only an owner can delete the workspace.
            </Callout>
          )}
        </div>
      </Card>

      {ws && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          danger
          title={`Delete ${ws.name}?`}
          body={
            <>
              Everything in this workspace is deleted permanently. Consider exporting your data first.
              <br />
              <br />
              This can&apos;t be undone.
            </>
          }
          requireText={ws.slug}
          confirmLabel="Delete workspace permanently"
          onConfirm={deleteWorkspace}
        />
      )}
    </div>
  );
}

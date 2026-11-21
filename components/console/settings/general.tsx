"use client";

/** /console/settings — workspace name, regional defaults, AI processing, thresholds, external actions, retention. */
import { useState, type FormEvent } from "react";
import { Bot, Gauge, Globe, Shield, Sparkles, Wand2 } from "lucide-react";
import { useUI } from "@/components/providers";
import { api, setCached, useApi } from "@/lib/client/api";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { ROLE_LABELS, formatDate, formatPercent } from "@/lib/client/format";
import type { MeDTO, WorkspaceDTO, WorkspaceSettings } from "@/lib/shared/types";
import { ME_PATH, useSession } from "../session";
import { Card, Callout, KeyValue } from "../kit/surface";
import { FormSkeleton } from "../kit/skeleton";
import { Button, RadioCards, Select, SwitchRow, TextField } from "../kit/form";
import { CopyButton, ErrorState } from "../kit/misc";
import { WORKSPACE_PATH } from "./frame";

const FALLBACK_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SAR", "SGD", "AUD", "CAD", "NZD", "JPY", "CNY", "HKD", "IDR", "MYR", "PHP", "THB", "VND", "BDT", "PKR", "LKR", "NPR", "KES", "NGN", "ZAR", "EGP", "BRL", "MXN", "CHF", "SEK"];

function supported(kind: "currency" | "timeZone", fallback: string[]): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = fn ? fn(kind) : [];
    return list.length ? [...list] : [...fallback];
  } catch {
    return [...fallback];
  }
}

let currencyNames: Intl.DisplayNames | null | undefined;
function currencyName(code: string) {
  try {
    if (currencyNames === undefined) currencyNames = new Intl.DisplayNames(undefined, { type: "currency" });
    return currencyNames?.of(code) ?? code;
  } catch {
    currencyNames = null;
    return code;
  }
}

const RETENTION_PRESETS = ["30", "90", "180", "365", "730"];

/** Loads the workspace and renders the settings form (read-only for non-admins). */
export function GeneralSettings() {
  const { workspace: sessionWs, can, role } = useSession();
  const { data, error, reload } = useApi<WorkspaceDTO>(WORKSPACE_PATH);
  const ws = data ?? sessionWs ?? undefined;
  if (!ws) {
    if (error) return <ErrorState error={error} retry={reload} />;
    return <FormSkeleton sections={3} />;
  }
  const key = JSON.stringify({ id: ws.id, name: ws.name, settings: ws.settings });
  return <SettingsForm key={key} initial={ws} editable={can("admin")} roleLabel={role ? ROLE_LABELS[role] : null} />;
}

type Draft = { name: string; settings: WorkspaceSettings };

function SettingsForm({ initial, editable, roleLabel }: { initial: WorkspaceDTO; editable: boolean; roleLabel: string | null }) {
  const { toast } = useUI();
  const [draft, setDraft] = useState<Draft>({ name: initial.name, settings: { ...initial.settings } });
  const [customRetention, setCustomRetention] = useState(initial.settings.retentionDays != null && !RETENTION_PRESETS.includes(String(initial.settings.retentionDays)));
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const s = draft.settings;
  const set = <K extends keyof WorkspaceSettings>(k: K, v: WorkspaceSettings[K]) => setDraft((d) => ({ ...d, settings: { ...d.settings, [k]: v } }));

  const changedKeys = (Object.keys(s) as (keyof WorkspaceSettings)[]).filter((k) => s[k] !== initial.settings[k]);
  const nameChanged = draft.name.trim() !== initial.name;
  const dirty = nameChanged || changedKeys.length > 0;

  const currencies = supported("currency", FALLBACK_CURRENCIES);
  if (!currencies.includes(s.currency)) currencies.unshift(s.currency);
  const zones = supported("timeZone", [s.timezone, "UTC"]);
  if (!zones.includes(s.timezone)) zones.unshift(s.timezone);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = "Enter a workspace name.";
    if (!/^\+[1-9]\d{0,3}$/.test(s.defaultCountryCode.trim())) e["settings.defaultCountryCode"] = "Use a country calling code such as +91 or +1.";
    if (s.retentionDays != null && (!Number.isInteger(s.retentionDays) || s.retentionDays < 1 || s.retentionDays > 3650)) e["settings.retentionDays"] = "Enter a number of days between 1 and 3650.";
    if (s.reviewThreshold > s.autoApplyThreshold) e["settings.reviewThreshold"] = "The review threshold can't be above the auto-apply threshold.";
    return e;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!editable || pending || !dirty) return;
    const v = validate();
    if (Object.keys(v).length) {
      setErrors(v);
      return;
    }
    setPending(true);
    setErrors({});
    const patch: { name?: string; settings?: Partial<WorkspaceSettings> } = {};
    if (nameChanged) patch.name = draft.name.trim();
    if (changedKeys.length) patch.settings = Object.fromEntries(changedKeys.map((k) => [k, k === "defaultCountryCode" ? s[k].trim() : s[k]])) as Partial<WorkspaceSettings>;
    try {
      const updated = await api<WorkspaceDTO>(WORKSPACE_PATH, { method: "PATCH", body: patch });
      setCached<WorkspaceDTO>(WORKSPACE_PATH, () => updated);
      setCached<MeDTO>(ME_PATH, (me) =>
        me ? { ...me, workspace: me.workspace?.id === updated.id ? updated : me.workspace, workspaces: me.workspaces.map((w) => (w.id === updated.id ? { ...w, name: updated.name } : w)) } : (me as unknown as MeDTO),
      );
      toast({ title: "Settings saved" });
      setPending(false);
    } catch (err) {
      setPending(false);
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      toast({ tone: "info", title: "Couldn't save settings", body: errorMessage(err) });
    }
  }

  function setAutoApply(v: number) {
    setDraft((d) => ({ ...d, settings: { ...d.settings, autoApplyThreshold: v, reviewThreshold: Math.min(d.settings.reviewThreshold, v) } }));
  }
  function setReview(v: number) {
    setDraft((d) => ({ ...d, settings: { ...d.settings, reviewThreshold: Math.min(v, d.settings.autoApplyThreshold) } }));
  }

  const retentionValue = customRetention ? "custom" : s.retentionDays == null ? "" : String(s.retentionDays);

  return (
    <form onSubmit={save} className="flex flex-col gap-4 pb-4">
      {!editable && (
        <Callout tone="info" title="Read-only">
          Only admins can change workspace settings{roleLabel ? ` — you're a ${roleLabel.toLowerCase()}` : ""}.
        </Callout>
      )}
      <fieldset disabled={!editable || pending} className="flex min-w-0 flex-col gap-4">
        <Card title="Workspace" description="How this workspace appears to your team." actions={<Globe className="size-4 text-muted" aria-hidden />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={80} required error={errors.name} />
            <TextField
              label="Slug"
              value={initial.slug}
              readOnly
              hint="Used to confirm destructive actions."
              trailing={<CopyButton value={initial.slug} iconOnly size="xs" label="Copy slug" />}
              className="font-mono text-[13px]"
            />
          </div>
          <KeyValue className="mt-4" columns={2} items={[{ label: "Created", value: formatDate(initial.createdAt) }, { label: "Workspace ID", value: <code className="font-mono text-xs">{initial.id}</code> }]} />
        </Card>

        <Card title="Regional defaults" description="Used when messages don't say otherwise.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Currency"
              value={s.currency}
              onChange={(e) => set("currency", e.target.value)}
              error={errors["settings.currency"]}
              options={currencies.map((c) => ({ value: c, label: `${c} — ${currencyName(c)}` }))}
            />
            <Select label="Time zone" value={s.timezone} onChange={(e) => set("timezone", e.target.value)} error={errors["settings.timezone"]} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
            <TextField
              label="Default country code"
              value={s.defaultCountryCode}
              onChange={(e) => set("defaultCountryCode", e.target.value)}
              placeholder="+91"
              inputMode="tel"
              maxLength={5}
              error={errors["settings.defaultCountryCode"]}
              hint="Assumed for local phone numbers without “+”."
            />
          </div>
        </Card>

        <Card title="AI processing" description="How Infera reads messages. Values are always checked against the message text before they're used." actions={<Sparkles className="size-4 text-muted" aria-hidden />}>
          <RadioCards
            name="aiMode"
            legend="AI mode"
            value={s.aiMode}
            onChange={(v) => set("aiMode", v)}
            options={[
              { value: "off", label: "Rules only", icon: <Shield />, description: "No message text is sent to an AI provider. Deterministic rules classify and extract." },
              { value: "assist", label: "Assist", icon: <Wand2 />, badge: <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-medium text-brand">Recommended</span>, description: "Rules first; AI only when the rules are unsure. Accurate and economical." },
              { value: "full", label: "Full AI", icon: <Bot />, description: "AI reads every relevant message for the best coverage. Uses more AI credits." },
            ]}
          />
          <SwitchRow
            className="mt-5 border-t border-line pt-4"
            label="Redact personal data before AI"
            description="Phone numbers and email addresses are replaced with placeholders before text is sent to the AI provider, and restored afterwards."
            checked={s.redactPII}
            onChange={(v) => set("redactPII", v)}
            disabled={!editable || pending}
          />
          {s.aiMode !== "off" && !s.redactPII && (
            <Callout tone="warning" className="mt-3">
              Personal data in messages will reach the AI provider as-is.
            </Callout>
          )}
        </Card>

        <Card title="Confidence thresholds" description="Decide when extracted values are applied automatically and when a person should check them." actions={<Gauge className="size-4 text-muted" aria-hidden />}>
          <ThresholdBand review={s.reviewThreshold} autoApply={s.autoApplyThreshold} />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Slider
              label="Apply automatically at"
              value={s.autoApplyThreshold}
              min={0.5}
              max={1}
              onChange={setAutoApply}
              hint="Values at or above this confidence are written to records without asking."
              error={errors["settings.autoApplyThreshold"]}
            />
            <Slider
              label="Ask for review from"
              value={s.reviewThreshold}
              min={0}
              max={0.95}
              onChange={setReview}
              hint="Between the two thresholds, changes wait in the review queue. Below it they're kept as suggestions only."
              error={errors["settings.reviewThreshold"]}
            />
          </div>
        </Card>

        <Card title="Automations" description="What automations are allowed to do outside Infera.">
          <SwitchRow
            label="Allow external actions"
            description="Lets automations call your webhook endpoints and send replies to customers on connected channels. Only admins can create such automations."
            checked={s.allowExternalActions}
            onChange={(v) => set("allowExternalActions", v)}
            disabled={!editable || pending}
          />
          {s.allowExternalActions && (
            <Callout tone="warning" className="mt-3" title="Automations can now act on your behalf">
              Replies go to real customers and webhooks send workspace data to the URLs you configure. Review your automations before turning this on.
            </Callout>
          )}
        </Card>

        <Card title="Data retention" description="Old message text and files are deleted automatically. Records you've built are kept.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Keep messages"
              value={retentionValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") {
                  setCustomRetention(true);
                  set("retentionDays", s.retentionDays ?? 60);
                } else {
                  setCustomRetention(false);
                  set("retentionDays", v ? Number(v) : null);
                }
              }}
              options={[
                { value: "", label: "Forever" },
                { value: "30", label: "30 days" },
                { value: "90", label: "90 days" },
                { value: "180", label: "6 months" },
                { value: "365", label: "1 year" },
                { value: "730", label: "2 years" },
                { value: "custom", label: "Custom…" },
              ]}
              error={!customRetention ? errors["settings.retentionDays"] : undefined}
            />
            {customRetention && (
              <TextField
                label="Days"
                type="number"
                min={1}
                max={3650}
                step={1}
                inputMode="numeric"
                value={s.retentionDays ?? ""}
                onChange={(e) => set("retentionDays", e.target.value === "" ? null : Math.round(Number(e.target.value)))}
                error={errors["settings.retentionDays"]}
                hint="Between 1 and 3650 days."
              />
            )}
          </div>
        </Card>
      </fieldset>

      {editable && dirty && (
        <div className="surface-lg sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 md:bottom-4" role="region" aria-label="Unsaved changes">
          <p className="text-sm text-fg-soft">You have unsaved changes.</p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDraft({ name: initial.name, settings: { ...initial.settings } });
                setCustomRetention(initial.settings.retentionDays != null && !RETENTION_PRESETS.includes(String(initial.settings.retentionDays)));
                setErrors({});
              }}
            >
              Discard
            </Button>
            <Button type="submit" variant="primary" size="sm" pending={pending}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** Three zones (suggestion / review / automatic) drawn to scale. */
function ThresholdBand({ review, autoApply }: { review: number; autoApply: number }) {
  const zones = [
    { label: "Suggestion only", width: review, cls: "bg-rose-500/70" },
    { label: "Human review", width: autoApply - review, cls: "bg-amber-500/80" },
    { label: "Applied automatically", width: 1 - autoApply, cls: "bg-emerald-500/80" },
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px]" role="img" aria-label={`Below ${formatPercent(review)}: suggestion only. ${formatPercent(review)} to ${formatPercent(autoApply)}: human review. ${formatPercent(autoApply)} and above: applied automatically.`}>
        {zones.map((z) =>
          z.width > 0 ? <span key={z.label} className={`rounded-[3px] transition-[flex-grow] duration-150 ${z.cls}`} style={{ flexGrow: z.width, flexBasis: 0 }} /> : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-soft" aria-hidden>
        {zones.map((z) => (
          <li key={z.label} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-[3px] ${z.cls}`} />
            {z.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slider({ label, value, min, max, onChange, hint, error }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string; error?: string }) {
  const id = `slider-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg-soft">
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-semibold text-fg tabular-nums">
          {formatPercent(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Math.round(Number(e.target.value) * 100) / 100)}
        aria-valuetext={formatPercent(value)}
        aria-describedby={`${id}-hint`}
        className="h-2 w-full cursor-pointer accent-brand disabled:cursor-not-allowed"
      />
      <p id={`${id}-hint`} className={`mt-1.5 text-xs ${error ? "font-medium text-rose-700 dark:text-rose-400" : "text-muted"}`}>
        {error ?? hint}
      </p>
    </div>
  );
}

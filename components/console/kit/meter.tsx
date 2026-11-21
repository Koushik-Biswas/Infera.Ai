"use client";

import { defaultWorkspaceSettings } from "@/lib/shared/types";
import { formatPercent } from "@/lib/client/format";
import { useOptionalSession } from "../session";

/**
 * Confidence (0..1) as a small bar + percentage, coloured by the workspace thresholds (read from the session,
 * or pass `thresholds`): ≥ auto-apply → green "applied automatically", ≥ review → amber "needs review",
 * below → red "suggestion only". `null` (human input) renders "—". Exposed as `role="meter"`.
 */
export function ConfidenceMeter({
  value,
  thresholds,
  showLabel = true,
  size = "sm",
  className = "",
}: {
  value: number | null | undefined;
  thresholds?: { review: number; autoApply: number };
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const session = useOptionalSession();
  const s = session?.workspace?.settings ?? defaultWorkspaceSettings;
  const autoApply = thresholds?.autoApply ?? s.autoApplyThreshold;
  const review = thresholds?.review ?? s.reviewThreshold;

  if (value == null || !Number.isFinite(value)) {
    return (
      <span className={`text-xs text-muted ${className}`} title="No confidence score (entered by a person)">
        —
      </span>
    );
  }
  const v = Math.min(1, Math.max(0, value));
  const level = v >= autoApply ? "high" : v >= review ? "medium" : "low";
  const fill = level === "high" ? "bg-emerald-500" : level === "medium" ? "bg-amber-500" : "bg-rose-500";
  const track = level === "high" ? "bg-emerald-500/18" : level === "medium" ? "bg-amber-500/20" : "bg-rose-500/18";
  const meaning = level === "high" ? "applied automatically" : level === "medium" ? "held for review" : "kept as a suggestion only";
  const pct = formatPercent(v);
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={`${pct} confidence, ${meaning}`}
      title={`${pct} confidence — ${meaning}`}
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      <span aria-hidden className={`relative overflow-hidden rounded-full ${track} ${size === "md" ? "h-2 w-20" : "h-1.5 w-12"}`}>
        <span className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${Math.max(4, v * 100)}%` }} />
      </span>
      {showLabel && <span className="text-xs text-fg-soft tabular-nums">{pct}</span>}
    </span>
  );
}

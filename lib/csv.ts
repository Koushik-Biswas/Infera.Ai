export function toCSV<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; label: string }[]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

export function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  // BOM so Excel opens UTF-8 (₹, Indic scripts) correctly.
  const blob = new Blob(["﻿" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

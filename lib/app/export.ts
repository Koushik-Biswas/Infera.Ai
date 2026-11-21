/** Exports for collections: Excel (.xlsx), CSV, Google Sheets, Notion and JSON. */
import { strToU8, zipSync } from "fflate";
import type { CellValue, Collection, Row } from "./types";

type Table = { headers: string[]; rows: CellValue[][] };

export function tableOf(col: Collection, rows: Row[], format: (key: string, v: CellValue) => CellValue = (_k, v) => v): Table {
  const fields = col.fields.filter((f) => f.type !== "image");
  return {
    headers: fields.map((f) => f.label),
    rows: rows.map((r) => fields.map((f) => format(f.key, r.values[f.key] ?? null))),
  };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "collection";

export function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ----------------------------- CSV / TSV ---------------------------- */

export function toCSV(t: Table, sep = ",") {
  const esc = (v: CellValue) => {
    const s = v == null ? "" : String(v);
    // Neutralise spreadsheet formulas (CSV injection).
    const isPlainNumber = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s);
    const safe = /^[=+\-@\t\r]/.test(s) && !isPlainNumber ? `'${s}` : s;
    return new RegExp(`["${sep}\\n\\r]`).test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [t.headers, ...t.rows].map((r) => r.map(esc).join(sep)).join("\r\n");
}

export function downloadCSV(col: Collection, t: Table) {
  saveBlob(`${safeName(col.name)}.csv`, new Blob(["﻿" + toCSV(t)], { type: "text/csv;charset=utf-8" }));
}

/* ------------------------------ Markdown ---------------------------- */

export function toMarkdown(t: Table) {
  const cell = (v: CellValue) => (v == null ? "" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " "));
  return [
    `| ${t.headers.map(cell).join(" | ")} |`,
    `| ${t.headers.map(() => "---").join(" | ")} |`,
    ...t.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

/* -------------------------------- XLSX ------------------------------ */

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Minimal, valid Office Open XML workbook — opens in Excel, Numbers, Sheets and LibreOffice. */
export function toXLSX(sheetName: string, t: Table): Blob {
  const cell = (v: CellValue, r: number, c: number, header = false) => {
    const ref = `${colName(c)}${r + 1}`;
    if (v == null || v === "") return "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  };
  const all = [t.headers, ...t.rows];
  const widths = t.headers.map((_, c) => Math.min(60, Math.max(10, ...all.map((r) => String(r[c] ?? "").length + 2))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("")}</cols><sheetData>${all
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci, ri === 0)).join("")}</row>`)
    .join("")}</sheetData><autoFilter ref="A1:${colName(Math.max(0, t.headers.length - 1))}${all.length}"/></worksheet>`;
  const name = xml(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, " ")) || "Sheet1";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return new Blob([zipSync(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadXLSX(col: Collection, t: Table) {
  saveBlob(`${safeName(col.name)}.xlsx`, toXLSX(col.name, t));
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

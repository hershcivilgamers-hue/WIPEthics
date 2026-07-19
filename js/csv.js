// =============================================================================
// csv.js — permission-safe CSV export (REC-04).
//
// A view only holds the rows the signed-in operator is cleared to see, so a CSV
// built from a view's already-filtered array inherits every access rule AND the
// operator's current filter for free. Nothing here reaches past the view's data,
// and the file is assembled and downloaded entirely in the browser — it never
// touches the network.
// =============================================================================

// RFC-4180 cell: quote when the value carries a comma, quote or newline.
function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// columns: [{ header, value: (row) => any }]. Returns a CSV string, prefixed with
// a UTF-8 BOM (﻿) so Excel opens codenames, refs and dashes correctly.
export function toCSV(columns, rows) {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(',')).join('\r\n');
  return `﻿${head}\r\n${body}`;
}

// Trigger a client-side download of a CSV built from columns + rows.
export function exportCSV(filename, columns, rows) {
  const blob = new Blob([toCSV(columns, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

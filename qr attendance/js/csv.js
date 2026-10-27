/**
 * CSV export utilities.
 * Quote every field, double inner quotes, and neutralize spreadsheet
 * formula injection by prefixing a single quote to any cell that starts with
 * = + - @ tab or carriage return. Add UTF-8 BOM so Excel opens it correctly.
 * Uses CRLF line endings.
 */

/**
 * Escape a single cell value for CSV.
 * @param {string} value
 * @returns {string}
 */
function escapeCell(value) {
  if (value === null || value === undefined) {
    return '""';
  }

  const str = String(value);

  // Neutralize formula injection: if cell starts with = + - @ or tab or carriage return
  // prefix with a single quote (which Excel will not display but will prevent formula execution)
  const startsWithFormulaChar = /^[\=\+\-\@\t\r\n]/.test(str);
  const prefixed = startsWithFormulaChar ? "'" + str : str;

  // Escape double quotes by doubling them
  const escaped = prefixed.replace(/"/g, '""');

  // Always wrap in double quotes
  return `"${escaped}"`;
}

/**
 * Convert rows to CSV string with UTF-8 BOM and CRLF line endings.
 * @param {string[][]} rows - Array of rows, each row is an array of cell values
 * @returns {string} CSV string with BOM
 */
export function toCsv(rows) {
  if (!rows || rows.length === 0) {
    return "\uFEFF"; // Just BOM for empty CSV
  }

  const BOM = "\uFEFF"; // UTF-8 BOM
  const csvLines = rows.map((row) => {
    return row.map(escapeCell).join(",");
  });

  return BOM + csvLines.join("\r\n");
}

/**
 * Download rows as a CSV file.
 * @param {string} filename - Filename without extension (will add .csv)
 * @param {string[][]} rows - Array of rows
 */
export function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
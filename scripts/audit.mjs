import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";

export function cellValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return value;
  if ("formula" in value || "sharedFormula" in value)
    return cellValue(value.result);
  if (value.richText) return value.richText.map((part) => part.text).join("");
  return value.text ?? value.hyperlink ?? null;
}

async function discover(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await discover(filename)));
    else if (/\.xlsx$/i.test(entry.name) && !entry.name.startsWith("~$"))
      files.push(filename);
  }
  return files;
}

await fs.mkdir("data", { recursive: true });
const workbooks = [];
for (const file of await discover(".")) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheets = book.worksheets.map((sheet) => {
    const rows = [];
    sheet.eachRow((row, number) => {
      const cells = row.values.slice(1).map(cellValue);
      const currencyFormats = {};
      row.eachCell((cell, column) => {
        if (/[$€]|CHF|USD|EUR/.test(cell.numFmt ?? ""))
          currencyFormats[column - 1] = cell.numFmt;
      });
      if (cells.some((value) => value != null && value !== ""))
        rows.push({ row: number, cells, currencyFormats });
    });
    return {
      name: sheet.name,
      state: sheet.state,
      rows,
      rowCount: sheet.rowCount,
      columns: sheet.columnCount,
    };
  });
  workbooks.push({ file: file.replaceAll("\\", "/"), sheets });
  console.log(
    file,
    sheets
      .map((sheet) => `${sheet.name}: ${sheet.rows.length} populated rows`)
      .join(" | "),
  );
}
await fs.writeFile(
  "data/workbook-audit.json",
  JSON.stringify({ workbooks }, null, 2),
);
console.log(
  `Audited ${workbooks.length} workbooks; source cells retained in data/workbook-audit.json`,
);

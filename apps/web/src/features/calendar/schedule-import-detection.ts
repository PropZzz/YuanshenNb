import { inferImportMapping, parseDelimited } from "./schedule-import-parser";
import { courseHeaderScore } from "./schedule-course-recognition";

export interface ImportSource {
  format: "xls" | "xlsx" | "csv" | "tsv" | "json" | "ics";
  text?: string;
  table?: string[][];
  encoding?: string;
  delimiter?: string;
}

// Only promote rows with recognizable fields, so a title or export note cannot
// displace the real header. Keep unknown tables available for manual mapping.
export function prepareImportTable(matrix: string[][]) {
  const nonempty = matrix.filter(row => row.some(cell => cell.trim()));
  let headerRow = 0, score = 0;
  nonempty.slice(0, 30).forEach((row, index) => {
    if (score >= 100) return;
    const mapping = inferImportMapping(row);
    const fields = Object.values(mapping).filter(value => Number(value) >= 0).length;
    const courseScore = courseHeaderScore(row, nonempty.slice(index + 1, index + 11));
    const weekdays = row.filter(cell => /^(?:星期|周)[一二三四五六日天]$/.test(cell.trim())).length;
    const next = courseScore || (weekdays >= 2 ? 100 + weekdays : Number(mapping.title) >= 0 && Number(mapping.start) >= 0 ? 100 + fields : fields >= 2 ? fields : 0);
    if (next > score) { headerRow = index; score = next; }
  });
  return { table: nonempty.slice(headerRow), headerRow, score };
}

function decode(bytes: Uint8Array, encoding: string) {
  if (encoding !== "auto") return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
  const bom = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : undefined;
  if (bom) return { text: new TextDecoder(bom, { fatal: true }).decode(bytes), encoding: bom };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }; }
  catch { return { text: new TextDecoder("gb18030", { fatal: true }).decode(bytes), encoding: "gb18030" }; }
}

export function recognizeImportSource(bytes: Uint8Array, name: string, encoding = "auto", format = "auto"): ImportSource {
  const ole = [208,207,17,224,161,177,26,225].every((value, index) => bytes[index] === value);
  const zip = bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
  if (format === "xls" || format === "xlsx" || format === "auto" && (ole || zip)) return { format: format === "xls" || ole ? "xls" : "xlsx" };
  if (format === "auto" && /\.(pdf|docx?|png|jpe?g|gif|zip|exe)$/i.test(name)) throw new Error("暂不支持此类文件，请从来源应用导出 Excel、CSV 或 ICS 日程文件");
  let decoded: ReturnType<typeof decode>;
  try { decoded = decode(bytes, encoding); }
  catch { throw new Error("无法识别文本编码，请在“调整识别”中选择编码，或将文件另存为 UTF-8 CSV"); }
  let text = decoded.text.replace(/^\uFEFF/, "");
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error("无法识别文件内容，请使用 Excel、CSV、TSV、TXT、JSON 或 ICS 文件");
  const spreadsheetXml = /<(?:\w+:)?Workbook\b/i.test(text) && text.includes("urn:schemas-microsoft-com:office:spreadsheet");
  const htmlWorkbook = /\.(xls|els)$/i.test(name) && /<table\b/i.test(text) && /<(?:!doctype\s+html|html|table)\b/i.test(text);
  if (format === "auto" && (spreadsheetXml || htmlWorkbook)) return { ...decoded, text, format: "xls" };
  if (format === "ics" || format === "auto" && /^\s*BEGIN:VCALENDAR/i.test(text)) return { ...decoded, text, format: "ics" };
  if (format === "json" || format === "auto" && /^\s*[\[{]/.test(text)) return { ...decoded, text, format: "json" };
  const separator = text.match(/^sep=([,;\t|])\r?\n/i);
  if (separator) text = text.slice(separator[0].length);
  const delimiters = format === "tsv" ? ["\t"] : separator ? [separator[1]] : [",", "\t", ";", "|"];
  let best: { table: string[][]; delimiter: string; score: number } | undefined, failure: unknown;
  for (const delimiter of delimiters) {
    try {
      const table = parseDelimited(text, delimiter), prepared = prepareImportTable(table);
      const width = prepared.table[0]?.length ?? 0;
      const consistent = prepared.table.slice(1, 21).filter(row => row.length === width).length;
      const score = prepared.score * 100 + (width > 1 ? 10 + consistent : 0);
      if (!best || score > best.score) best = { table, delimiter, score };
    } catch (error) { failure ??= error; }
  }
  if (!best) throw failure ?? new Error("没有可读取的表格内容");
  // A different separator must not hide an oversized or malformed one-column fallback.
  if ((prepareImportTable(best.table).table[0]?.length ?? 0) < 2 && failure) throw failure;
  return { format: best.delimiter === "\t" ? "tsv" : "csv", encoding: decoded.encoding, text, table: best.table, delimiter: best.delimiter };
}

import { expect, it } from "vitest";
import { recognizeImportSource, prepareImportTable } from "./schedule-import-detection";
import { inferImportMapping, mapImportTable } from "./schedule-import-parser";

const bytes = (text: string) => new TextEncoder().encode(text);

it("recognizes separators and skips export instructions without relying on the filename", () => {
  const source = recognizeImportSource(bytes('sep=;\n十一月日程导出\n主题;开始日期;开始时间;结束时间\n"讨论;实验";2026/11/24;09:00;10:00'), "导出.txt");
  expect(source).toMatchObject({ format: "csv", encoding: "utf-8", delimiter: ";" });
  const prepared = prepareImportTable(source.table!);
  expect(prepared.headerRow).toBe(1);
  const [row] = mapImportTable(prepared.table, inferImportMapping(prepared.table[0]), "Asia/Shanghai");
  expect(row.payload).toMatchObject({ title: "讨论;实验", startAt: "2026-11-24T01:00:00.000Z" });
});

it("detects GBK CSV and UTF-16 tabular exports automatically", () => {
  const gbk = new Uint8Array(Buffer.from("b1eacce22cc8d5c6da2cbfaacabccab1bce40ad6d0cec4bbe1d2e92c323032362d31312d32342c30393a3030", "hex"));
  const source = recognizeImportSource(gbk, "日程.csv");
  expect(source.encoding).toBe("gb18030");
  expect(source.table?.[1][0]).toBe("中文会议");
  const text = "标题\t日期\t开始时间\nUnicode 日程\t2026-11-24\t14:00";
  const utf16 = new Uint8Array([255, 254, ...Buffer.from(text, "utf16le")]);
  expect(recognizeImportSource(utf16, "export.csv")).toMatchObject({ delimiter: "\t", encoding: "utf-16le" });
});

it("recognizes calendar and JSON content even with a misleading extension", () => {
  expect(recognizeImportSource(bytes("BEGIN:VCALENDAR\r\nEND:VCALENDAR"), "calendar.txt").format).toBe("ics");
  expect(recognizeImportSource(bytes('{"events":[]}'), "export.csv").format).toBe("json");
  expect(recognizeImportSource(new Uint8Array([208,207,17,224,161,177,26,225]), "课表.els").format).toBe("xls");
  expect(() => recognizeImportSource(bytes("%PDF-1.7 document"), "document.pdf")).toThrow(/不支持/);
});

it("finds course headers after a title and leaves unrecognized tables available for manual mapping", () => {
  const source = prepareImportTable([["学期课程表"], ["课程名称", "星期", "周次", "节次"], ["线代", "3", "1-16", "3-4"]]);
  expect(source.headerRow).toBe(1);
  expect(source.score).toBeGreaterThan(0);
  expect(prepareImportTable([["事项", "时刻"], ["会议", "09:00"]]).table).toHaveLength(2);
});

it("recognizes SpreadsheetML and HTML workbooks exported with an XLS extension", () => {
  expect(recognizeImportSource(bytes('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet/></Workbook>'), "学校课表.xls").format).toBe("xls");
  expect(recognizeImportSource(bytes('<html><head><meta charset="utf-8"></head><body><table><tr><td>标题</td></tr></table></body></html>'), "导出.xls").format).toBe("xls");
});

it("keeps records before a repeated, more detailed header", () => {
  const table = [["标题", "日期", "开始时间"], ["前段安排", "2026-11-24", "09:00"], ["标题", "日期", "开始时间", "备注"], ["后段安排", "2026-11-25", "09:00", ""]];
  expect(prepareImportTable(table).headerRow).toBe(0);
  expect(prepareImportTable(table).table[1][0]).toBe("前段安排");
});

it("recognizes common export headers, Chinese dates, datetime cells and explicit end dates", () => {
  const table = [["Subject", "Start Date", "Start Time", "End Date", "End Time"], ["跨日出行", "2026年11月24日", "23:00", "2026/11/26", "01:00"]];
  expect(mapImportTable(table, inferImportMapping(table[0]), "Asia/Shanghai")[0].payload).toMatchObject({ startAt: "2026-11-24T15:00:00.000Z", endAt: "2026-11-25T17:00:00.000Z" });
  const combined = [["主题", "开始时间", "结束时间"], ["导出会议", "2026-11-24 09:00", "2026-11-24 10:30"]];
  expect(mapImportTable(combined, inferImportMapping(combined[0]), "Asia/Shanghai")[0].payload?.endAt).toBe("2026-11-24T02:30:00.000Z");
});

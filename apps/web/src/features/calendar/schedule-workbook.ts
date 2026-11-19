import { inferImportMapping } from "./schedule-import-parser";

interface SheetCell {v?:unknown;z?:string;t?:string}
interface Worksheet {[address:string]:SheetCell|string|undefined}
export interface ImportWorkbook {SheetNames:string[];Sheets:Record<string,Worksheet>;Workbook?:{WBProps?:{date1904?:boolean}}}
export interface WorkbookParser {
 read:(bytes:ArrayBuffer|Uint8Array,options:Record<string,unknown>)=>ImportWorkbook;
 utils:{decode_range:(range:string)=>{s:{r:number;c:number};e:{r:number;c:number}};encode_cell:(cell:{r:number;c:number})=>string;sheet_to_json:(sheet:Worksheet,options:Record<string,unknown>)=>unknown[][]};
 SSF:{is_date:(format:string)=>boolean;parse_date_code:(value:number,options?:{date1904?:boolean})=>{y:number;m:number;d:number;H:number;M:number;S:number}|null};
}
let loading:Promise<WorkbookParser>|undefined;
function available(){return (globalThis as typeof globalThis&{XLSX?:WorkbookParser}).XLSX;}
export function loadWorkbookParser():Promise<WorkbookParser>{
 const parser=available();if(parser)return Promise.resolve(parser);if(loading)return loading;
 loading=new Promise<WorkbookParser>((resolve,reject)=>{
  const script=document.createElement("script");script.src="/vendor/xlsx.full.min.js";script.async=true;
  const timeout=setTimeout(()=>fail(),15000);
  function fail(){clearTimeout(timeout);script.remove();loading=undefined;reject(new Error("Excel 解析工具加载失败，请检查连接后重新选择文件"));}
  script.onerror=fail;script.onload=()=>{clearTimeout(timeout);const loaded=available();if(loaded){loading=undefined;resolve(loaded);}else fail();};document.head.append(script);
 });return loading;
}
export function readWorkbookBytes(file:File){return new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(new Error("无法读取工作簿，请重新选择"));reader.readAsArrayBuffer(file);});}
export function workbookTable(workbook:ImportWorkbook,name:string,parser:WorkbookParser):string[][]{
 const sheet=workbook.Sheets[name];if(!sheet)throw new Error("请选择有效的工作表");
 const ref=sheet["!fullref"]??sheet["!ref"];if(typeof ref!=="string")throw new Error("工作表中没有可读取的数据");const range=parser.utils.decode_range(ref);
 if(range.e.r>=5001||range.e.c>=64)throw new Error("工作表最多支持 5000 行、64 列，请删去空白区域或分批导入");
 const raw=parser.utils.sheet_to_json(sheet,{header:1,defval:"",raw:true,blankrows:true}),headers=(raw[0]??[]).map(value=>String(value??"")),mapping=inferImportMapping(headers),date1904=!!workbook.Workbook?.WBProps?.date1904,pad=(value:number)=>String(value).padStart(2,"0");
 return raw.map((row,r)=>row.map((value,c)=>{
  if(r===0)return String(value??"");const cell=sheet[parser.utils.encode_cell({r:r+range.s.r,c:c+range.s.c})] as SheetCell|undefined;
  const numericValue=typeof value==="number"?value:typeof cell?.v==="number"?cell.v:undefined;
  if(numericValue===undefined)return String(value??"");
  const dateColumn=c===Number(mapping.date),timeColumn=c===Number(mapping.start)||c===Number(mapping.end),formatted=typeof cell?.z==="string"&&parser.SSF.is_date(cell.z);
  if(!dateColumn&&!timeColumn&&!formatted)return String(numericValue);const parsed=parser.SSF.parse_date_code(numericValue,{date1904});if(!parsed)return String(numericValue);
  const day=`${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`,time=`${pad(parsed.H)}:${pad(parsed.M)}`;
  if(timeColumn)return numericValue<1?time:`${day}T${time}`;
  if(dateColumn)return day;
  return numericValue<1?time:parsed.H||parsed.M?`${day}T${time}`:day;
 })).filter(row=>row.some(value=>value.trim()));
}

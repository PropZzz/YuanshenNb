import type { ApiComponents } from "@/api/client";
import { localDateTimeToISO, shiftDay } from "@/lib/datetime";

export type ImportPayload=ApiComponents["CreateScheduleItemRequest"];
export interface ImportPreviewRow {id:string;title:string;payload?:ImportPayload;error?:string;duplicate?:boolean;conflicts?:string[]}
export const importFieldLabels={title:"日程名称",date:"日期",start:"开始时间",end:"结束时间",duration:"时长（分钟）",tag:"属性标签",notes:"备注",location:"地点 / 教室",teacher:"教师"};
export type ImportField=keyof typeof importFieldLabels;
export type ImportMapping=Record<ImportField,string>;
const aliases:Record<ImportField,string[]>={title:["标题","名称","日程名称","日程标题","title","summary","name","subject","课程名称","课程","日程"],date:["日期","日程日期","date","day","上课日期","开始日期"],start:["开始时间","开始时刻","start","startat","starttime","time","开始","时间"],end:["结束时间","结束时刻","end","endat","endtime","结束"],duration:["时长","时长分钟","分钟","duration","durationminutes","minutes"],tag:["属性标签","标签","分类","课程类别","tag","category","categories"],notes:["备注","说明","description","note","notes"],location:["地点","教室","地点/教室","location"],teacher:["教师","老师","teacher"]};
const headerKey=(value:string)=>value.toLowerCase().replace(/^\uFEFF/,"").replace(/[\s_\-（）()]/g,"");
export function parseDelimited(text:string,delimiter=","):string[][]{
 const rows:string[][]=[];let row:string[]=[],value="",quoted=false;
 for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||!value)quoted=!quoted;else value+=char;}
 else if(char===delimiter&&!quoted){row.push(value.trim());value="";}else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&text[i+1]==="\n")i++;row.push(value.trim());if(row.some(Boolean))rows.push(row);row=[];value="";}else value+=char;}
 if(quoted)throw new Error("文件中有未闭合的引号，请检查 CSV 格式");row.push(value.trim());if(row.some(Boolean))rows.push(row);
 if(rows.length>5001||rows.some(row=>row.length>64))throw new Error("表格最多支持 5000 行、64 列，请分批导入");return rows;
}
export function inferImportMapping(headers:string[]):ImportMapping{return Object.fromEntries(Object.keys(importFieldLabels).map(key=>[key,String(headers.findIndex(header=>aliases[key as ImportField].includes(headerKey(header))))])) as ImportMapping;}
export function importPayload(title:string,startAt:string,endAt:string,notes="",tag=""):ImportPayload{
 if(!title.trim())throw new Error("缺少日程名称");if(title.length>200)throw new Error("日程名称不能超过 200 个字符");if(!Number.isFinite(Date.parse(startAt))||!Number.isFinite(Date.parse(endAt))||Date.parse(endAt)<=Date.parse(startAt))throw new Error("结束时间需要晚于开始时间");
 const categories:Record<string,ImportPayload["category"]>={deep_work:"deep_work",meeting:"meeting",recovery:"recovery",routine:"routine",urgent:"urgent",深度工作:"deep_work",协同会议:"meeting",恢复缓冲:"recovery",日常事务:"routine",紧急任务:"urgent"};
 const category=categories[tag]??"routine",description=[notes,tag&&!categories[tag]?`原属性标签：${tag}`:""].filter(Boolean).join("\n");if(description.length>4000)throw new Error("备注及导入元数据不能超过 4000 个字符");
 return {title:title.trim(),startAt,endAt,notes:description,category,cognitiveLoad:"medium",flexibility:"hard_locked",reminderMinutes:10,allowOverlap:false};
}
function clock(value:string){const match=value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);if(!match||Number(match[1])>23||Number(match[2])>59)throw new Error("时间格式应为 HH:mm");return `${match[1].padStart(2,"0")}:${match[2]}`;}
function date(value:string){const match=value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(!match)throw new Error("日期格式应为 YYYY-MM-DD");return `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;}
function instant(value:string,day:string,timezone:string){if(/^\d{4}-\d{2}-\d{2}T/.test(value)){if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value))return new Date(value).toISOString();return localDateTimeToISO(value.slice(0,16),timezone);}return localDateTimeToISO(`${date(day)}T${clock(value)}`,timezone);}
export function mapImportTable(table:string[][],mapping:ImportMapping,timezone:string):ImportPreviewRow[]{
 if(table.length>2001)throw new Error("展开后最多支持 2000 条日程，请分批导入");
 if(Number(mapping.title)<0||Number(mapping.start)<0)throw new Error("请先指定日程名称和开始时间对应的列");
 return table.slice(1).map((row,index)=>{const get=(key:ImportField)=>row[Number(mapping[key])]??"",title=get("title");try{const startAt=instant(get("start"),get("date"),timezone),duration=get("duration")?Number(get("duration")):60;let endAt=get("end")?instant(get("end"),get("date"),timezone):Number.isInteger(duration)&&duration>0&&duration<=10080?new Date(Date.parse(startAt)+duration*60000).toISOString():"";if(get("end")&&!get("end").includes("T")&&Date.parse(endAt)<=Date.parse(startAt))endAt=instant(get("end"),shiftDay(date(get("date")),1),timezone);const notes=[get("notes"),get("location")?`地点：${get("location")}`:"",get("teacher")?`教师：${get("teacher")}`:""].filter(Boolean).join("\n");return{id:`row-${index}`,title,payload:importPayload(title,startAt,endAt,notes,get("tag"))};}catch(error){return{id:`row-${index}`,title:title||`第 ${index+2} 行`,error:error instanceof Error?error.message:"无法读取此行"};}});
}
export function parseJsonImport(text:string,timezone:string):ImportPreviewRow[]{
 const input:unknown=JSON.parse(text),envelope=input&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:undefined;
 const values=Array.isArray(input)?input:envelope?.events??envelope?.schedules??envelope?.data??envelope?.items;
 if(!Array.isArray(values))throw new Error("JSON 必须是日程数组或包含 events / schedules / data / items 数组");if(!values.length||values.length>2000)throw new Error("JSON 需要 1 至 2000 条日程，请分批导入");
 return values.map((value,index)=>{if(!value||typeof value!=="object"||Array.isArray(value))return{id:`json-${index}`,title:`第 ${index+1} 条`,error:"此条日程必须是包含字段的对象"};const record=value as Record<string,unknown>;
  const keys=Object.keys(record),headers=keys.map(headerKey),get=(names:string[])=>{const column=headers.findIndex(key=>names.includes(key));return column<0?undefined:record[keys[column]];};
  const title=String(get(aliases.title)??"");try{if(record.rrule||record.RRULE||record.repeat&&record.repeat!=="none")throw new Error("包含重复规则，请先展开成独立日程后导入");
   const matrix=[Object.keys(importFieldLabels),Object.keys(importFieldLabels).map(key=>{const field=key as ImportField,value=get(aliases[field]);if(field==="start"&&value&&typeof value==="object"){const time=value as {hour?:unknown;minute?:unknown};return `${String(time.hour??0).padStart(2,"0")}:${String(time.minute??0).padStart(2,"0")}`;}return value===undefined?"":String(value);})];
   const row=mapImportTable(matrix,inferImportMapping(matrix[0]),timezone)[0];return {...row,id:`json-${index}`};
  }catch(error){return{id:`json-${index}`,title:title||`第 ${index+1} 条`,error:error instanceof Error?error.message:"无法读取此条日程"};}
 });
}
function icsText(value:string){return value.replace(/\\[nN]/g,"\n").replace(/\\([,;\\])/g,"$1");}
function icsTime(value:string,key:string,timezone:string):string{
 const match=value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);if(!match)throw new Error("ICS 日期时间格式无效");
 const local=`${match[1]}-${match[2]}-${match[3]}T${match[4]??"00"}:${match[5]??"00"}`;
 if(match[7])return new Date(`${local}:${match[6]??"00"}Z`).toISOString();const zone=key.match(/TZID=([^;:]+)/i)?.[1]?.replace(/^"|"$/g,"")??timezone;return localDateTimeToISO(local,zone);
}
export function parseIcsImport(text:string,timezone:string):ImportPreviewRow[]{
 const lines=text.replace(/\r?\n[ \t]/g,"").split(/\r?\n/);const records:Record<string,{key:string;value:string}>[]=[];let current:Record<string,{key:string;value:string}>|undefined;
 for(const line of lines){if(line.trim()==="BEGIN:VEVENT"){if(current)throw new Error("ICS 事件嵌套错误");current={};}else if(line.trim()==="END:VEVENT"){if(current)records.push(current);current=undefined;}else if(current){const colon=line.indexOf(":");if(colon<0)continue;const key=line.slice(0,colon);current[key.split(";")[0].toUpperCase()]={key,value:line.slice(colon+1)};}}
 if(current)throw new Error("ICS 文件不完整，缺少 END:VEVENT");if(!records.length)throw new Error("文件中没有可导入的日程事件");if(records.length>2000)throw new Error("每次最多导入 2000 条日程，请分批导入");
 return records.map((event,index)=>{const title=icsText(event.SUMMARY?.value??"");try{if(event.RRULE||event.RDATE||event.EXDATE||event["RECURRENCE-ID"])throw new Error("包含重复规则，请先在来源日历中展开成独立日程后导入");if(event.STATUS?.value==="CANCELLED")throw new Error("已取消的事件不会导入");if(!event.DTSTART)throw new Error("缺少开始时间");const startAt=icsTime(event.DTSTART.value,event.DTSTART.key,timezone);let endAt="";
  if(event.DTEND)endAt=icsTime(event.DTEND.value,event.DTEND.key,timezone);else if(event.DURATION){const match=event.DURATION.value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);if(match){const duration=(Number(match[1]??0)*86400+Number(match[2]??0)*3600+Number(match[3]??0)*60+Number(match[4]??0))*1000;endAt=new Date(Date.parse(startAt)+duration).toISOString();}}
  return{id:`ics-${index}`,title,payload:importPayload(title,startAt,endAt,[icsText(event.DESCRIPTION?.value??""),event.LOCATION?`地点：${icsText(event.LOCATION.value)}`:""].filter(Boolean).join("\n"),icsText(event.CATEGORIES?.value??""))};
 }catch(error){return{id:`ics-${index}`,title:title||`事件 ${index+1}`,error:error instanceof Error?error.message:"无法读取此事件"};}});
}
export function markImportDuplicates(rows:ImportPreviewRow[],existing:ApiComponents["ScheduleItemDTO"][]=[]):ImportPreviewRow[]{const active=existing.filter(item=>item.status!=="cancelled"),keys=new Set(active.map(item=>`${item.title}|${Date.parse(item.startAt)}|${Date.parse(item.endAt)}`));const candidates=[...active,...rows.flatMap(row=>row.payload?[row.payload]:[])];return rows.map(row=>{if(!row.payload)return row;const item=row.payload,key=`${item.title}|${Date.parse(item.startAt)}|${Date.parse(item.endAt)}`,duplicate=keys.has(key);keys.add(key);const conflicts=candidates.filter(other=>other!==item&&Date.parse(other.startAt)<Date.parse(item.endAt)&&Date.parse(other.endAt)>Date.parse(item.startAt)).map(other=>other.title);return {...row,duplicate,conflicts:[...new Set(conflicts)].slice(0,3)};});}

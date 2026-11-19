import { localDateTimeToISO, shiftDay } from "@/lib/datetime";
import { importPayload, type ImportPreviewRow } from "./schedule-import-parser";

export interface ImportCourse {id:string;title:string;weekday:number;weeks:string;sections:string;teacher:string;location:string;notes:string}
export type SectionTimes=Record<string,{start:string;end:string}>;
const weekdays:Record<string,number>={一:1,二:2,三:3,四:4,五:5,六:6,日:7,天:7};
const clean=(value:string)=>value.trim().toLowerCase().replace(/[\s_（）()]/g,"");
function weekday(value:string){const number=Number(value);if(Number.isInteger(number)&&number>=1&&number<=7)return number;const match=value.match(/(?:星期|周)?([一二三四五六日天])/);if(!match)throw new Error("课程星期必须为 1–7 或星期一至日");return weekdays[match[1]];}
export function parseCourseWeeks(expression:string):number[]{
 const text=expression.replace(/[－—~至]/g,"-").replace(/[（(]/g,"[").replace(/[）)]/g,"]").replace(/[、，]/g,",").replace(/\s/g,"");
 const odd=/单|奇/.test(text),even=/双|偶/.test(text);if(odd&&even)throw new Error("同一课程不能同时指定单周与双周");const range=text.replace(/\[[^\]]*\]/g,"").replace(/周/g,"");
 if(!range)throw new Error("请填写课程周次");const weeks=new Set<number>();for(const token of range.split(",")){const match=token.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);if(!match)throw new Error("周次格式示例：1-16、1,3,5 或 1-16[单周]");const start=Number(match[1]),end=Number(match[2]??start);if(start<1||end<start||end>60)throw new Error("课程周次范围应为 1 至 60");for(let week=start;week<=end;week++)if((!odd||week%2===1)&&(!even||week%2===0))weeks.add(week);}
 if(!weeks.size)throw new Error("此周次表达式没有实际授课周");return [...weeks].sort((a,b)=>a-b);
}
export function hasCourseTable(table:string[][]){return table.some(row=>row.filter(cell=>/(?:星期|周)[一二三四五六日天]/.test(cell)).length>=2)||!!table[0]&&["星期","周次","节次"].every(label=>table[0].some(cell=>clean(cell)===label));}
export function parseCourseTable(table:string[][]):ImportCourse[]{
 const weekdayRow=table.findIndex(row=>row.filter(cell=>/(?:星期|周)[一二三四五六日天]/.test(cell)).length>=2),courses:ImportCourse[]=[];
 if(weekdayRow>=0){const columns=table[weekdayRow].map((value,column)=>({column,match:value.match(/(?:星期|周)([一二三四五六日天])/)})).filter(value=>value.match);
  table.slice(weekdayRow+1).forEach((row,index)=>{const section=row[0]?.match(/\d+(?:\s*[-－—~至]\s*\d+)?/)?.[0]?.replace(/\s/g,"").replace(/[－—~至]/g,"-");if(!section)return;
   for(const {column,match} of columns){const raw=row[column]?.trim();if(!raw)continue;raw.split(/\r?\n\s*\r?\n/).forEach((block,blockIndex)=>{const lines=block.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),weekIndex=lines.findIndex(line=>/^\d+(?:\s*[-~至－—]\s*\d+)?(?:\s*[,，、]\s*\d+(?:\s*[-~至－—]\s*\d+)?)*(?:周)?(?:\s*[\[（(](?:单周|双周|周|奇数周|偶数周|单|双)[\]）)])?$/.test(line));if(weekIndex<1)return;const title=lines.slice(0,weekIndex).find(line=>!/^\d+$/.test(line));if(!title)return;courses.push({id:`course-${index}-${column}-${blockIndex}`,title,weekday:weekdays[match![1]],weeks:lines[weekIndex],sections:section,teacher:weekIndex>1?lines[weekIndex-1]:"",location:lines.slice(weekIndex+1).find(line=>!/^\d+$/.test(line))??"",notes:""});});}
  });
 }else{const headers=table[0]?.map(clean)??[],column=(names:string[])=>headers.findIndex(value=>names.includes(value)),mapping={title:column(["课程名称","课程","title","name"]),weekday:column(["星期","星期几","weekday","dayofweek"]),weeks:column(["周次","授课周","weeks"]),sections:column(["节次","节数","sections"]),teacher:column(["教师","老师","teacher"]),location:column(["地点","教室","location"]),notes:column(["备注","说明","notes"])};
  if([mapping.title,mapping.weekday,mapping.weeks,mapping.sections].some(value=>value<0))throw new Error("课程列表需包含课程名称、星期、周次和节次；星期列请填写 1–7");
  table.slice(1).forEach((row,index)=>{if(!row.some(Boolean))return;const get=(key:keyof typeof mapping)=>row[mapping[key]]??"";courses.push({id:`course-${index}`,title:get("title"),weekday:weekday(get("weekday")),weeks:get("weeks"),sections:get("sections").replace(/\s/g,"").replace(/[－—~至]/g,"-"),teacher:get("teacher"),location:get("location"),notes:get("notes")});});
 }
 if(!courses.length)throw new Error("未识别到课程名称、星期、周次和节次，请切换为日程明细表或检查课表");if(courses.length>2000)throw new Error("每次最多配置 2000 条课程");for(const course of courses){if(!course.title.trim())throw new Error("课程名称不能为空");if(!/^\d{1,2}(?:-\d{1,2})?$/.test(course.sections))throw new Error("节次格式示例：1 或 1-2");parseCourseWeeks(course.weeks);}return courses;
}
export function expandCourseTable(courses:ImportCourse[],firstMonday:string,sectionTimes:SectionTimes,timezone:string):ImportPreviewRow[]{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(firstMonday))throw new Error("请指定学期第一周周一");localDateTimeToISO(`${firstMonday}T12:00`,timezone);if(new Date(`${firstMonday}T12:00:00Z`).getUTCDay()!==1)throw new Error("学期第一周日期必须是周一");
 const result:ImportPreviewRow[]=[];for(const course of courses){const times=sectionTimes[course.sections];if(!times?.start||!times.end)throw new Error(`请填写第 ${course.sections} 节的起止时间`);if(times.end<=times.start)throw new Error(`第 ${course.sections} 节的结束时间应晚于开始时间`);
  for(const week of parseCourseWeeks(course.weeks)){const day=shiftDay(firstMonday,(week-1)*7+course.weekday-1),startAt=localDateTimeToISO(`${day}T${times.start}`,timezone),endAt=localDateTimeToISO(`${day}T${times.end}`,timezone),notes=[course.notes,course.teacher?`教师：${course.teacher}`:"",course.location?`地点：${course.location}`:"",`第 ${week} 周 · 第 ${course.sections} 节`].filter(Boolean).join("\n");result.push({id:`${course.id}-${day}`,title:course.title,payload:importPayload(course.title,startAt,endAt,notes,"上课学习")});if(result.length>2000)throw new Error("展开后超过 2000 条日程，请减少周次或分批导入");}
 }return result;
}

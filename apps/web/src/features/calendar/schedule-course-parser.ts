import { localDateTimeToISO, shiftDay } from "@/lib/datetime";
import { importPayload, type ImportPreviewRow } from "./schedule-import-parser";

export interface ImportCourse {id:string;title:string;weekday:number;weeks:string;sections:string;teacher:string;location:string;notes:string}
export type SectionTimes=Record<string,{start:string;end:string}>;
import { courseHeaderScore, courseSectionTime, recognizedCourseRows } from "./schedule-course-recognition";
export { courseTableSettings } from "./schedule-course-recognition";
export function parseCourseWeeks(expression:string):number[]{
 const text=expression.replace(/[－—~至]/g,"-").replace(/[（(]/g,"[").replace(/[）)]/g,"]").replace(/[、，]/g,",").replace(/周/g,"").replace(/第/g,"").replace(/\s/g,"");
 if(!text)throw new Error("请填写课程周次");const weeks=new Set<number>();
 for(const token of text.split(",")){const match=token.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\[(单|双|奇数|偶数|单周|双周)\])?$/);if(!match)throw new Error("周次格式示例：1-16、1,3,5 或 1-16[单周]");const start=Number(match[1]),end=Number(match[2]??start),odd=/^(?:单|奇)/.test(match[3]??""),even=/^(?:双|偶)/.test(match[3]??"");if(start<1||end<start||end>60)throw new Error("课程周次范围应为 1 至 60");for(let week=start;week<=end;week++)if((!odd||week%2===1)&&(!even||week%2===0))weeks.add(week);}
 if(!weeks.size)throw new Error("此周次表达式没有实际授课周");return [...weeks].sort((a,b)=>a-b);
}
export function hasCourseTable(table:string[][]){return table.slice(0,40).some((row,index)=>courseHeaderScore(row,table.slice(index+1,index+11))>=100);}
export function parseCourseTable(table:string[][]):ImportCourse[]{
 const courses=recognizedCourseRows(table);
 if(courses.length>2000)throw new Error("每次最多配置 2000 条课程");
 for(const course of courses){if(!course.title.trim())throw new Error("课程名称不能为空");parseCourseWeeks(course.weeks);}
 return courses;
}
export function expandCourseTable(courses:ImportCourse[],firstMonday:string,sectionTimes:SectionTimes,timezone:string):ImportPreviewRow[]{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(firstMonday))throw new Error("请指定学期第一周周一");localDateTimeToISO(`${firstMonday}T12:00`,timezone);if(new Date(`${firstMonday}T12:00:00Z`).getUTCDay()!==1)throw new Error("学期第一周日期必须是周一");
 const result:ImportPreviewRow[]=[];for(const course of courses){const times=courseSectionTime(course.sections,sectionTimes);if(!times?.start||!times.end)throw new Error(`请填写第 ${course.sections} 节的起止时间`);if(times.end<=times.start)throw new Error(`第 ${course.sections} 节的结束时间应晚于开始时间`);
  for(const week of parseCourseWeeks(course.weeks)){const day=shiftDay(firstMonday,(week-1)*7+course.weekday-1),startAt=localDateTimeToISO(`${day}T${times.start}`,timezone),endAt=localDateTimeToISO(`${day}T${times.end}`,timezone),notes=[course.notes,course.teacher?`教师：${course.teacher}`:"",course.location?`地点：${course.location}`:"",`第 ${week} 周 · 第 ${course.sections} 节`].filter(Boolean).join("\n");result.push({id:`${course.id}-${day}`,title:course.title,payload:importPayload(course.title,startAt,endAt,notes,"上课学习")});if(result.length>2000)throw new Error("展开后超过 2000 条日程，请减少周次或分批导入");}
 }return result;
}

import { expect, it } from "vitest";
import { expandCourseTable, parseCourseTable, parseCourseWeeks } from "./schedule-course-parser";
import { inferImportMapping, mapImportTable, markImportDuplicates, parseDelimited, parseIcsImport, parseJsonImport } from "./schedule-import-parser";

it("accepts the original table row/column envelope but caps the generated event preview at 2000",()=>{
 const wide=Array.from({length:64},(_,index)=>`列${index}`).join(",");expect(parseDelimited(`${wide}\n${wide}`)[0]).toHaveLength(64);
 expect(parseDelimited(Array.from({length:5001},()=>"A,B").join("\n"))).toHaveLength(5001);
 const table=[["标题","日期","开始时间"],...Array.from({length:2001},()=>["过多","2026-11-20","09:00"])];
 expect(()=>mapImportTable(table,inferImportMapping(table[0]),"Asia/Shanghai")).toThrow(/2000/);
});

it("supports quoted CSV and all original metadata columns without inventing a category",()=>{
 const table=parseDelimited('标题,日期,开始时间,时长（分钟）,属性标签,教师,教室,备注\n"课程,实验",2026-11-20,08:00,95,上课学习,张老师,B102,"准备器材\n提前到场"');
 const row=mapImportTable(table,inferImportMapping(table[0]),"Asia/Shanghai")[0];expect(row.payload).toMatchObject({title:"课程,实验",category:"routine",startAt:"2026-11-20T00:00:00.000Z",endAt:"2026-11-20T01:35:00.000Z"});expect(row.payload?.notes).toContain("原属性标签：上课学习");expect(row.payload?.notes).toContain("教师：张老师");expect(row.payload?.notes).toContain("地点：B102");
});
it("normalizes JSON wrappers and isolates invalid rows",()=>{
 const rows=parseJsonImport(JSON.stringify({schedules:[{title:"UTC JSON",startAt:"2026-11-20T01:00:00Z",endAt:"2026-11-20T02:00:00Z",category:"meeting"},null,{title:"重复例外",date:"2026-11-20",start:"09:00",repeat:"weekly"}]}),"Asia/Shanghai");
 expect(rows[0].payload).toMatchObject({category:"meeting",startAt:"2026-11-20T01:00:00.000Z"});expect(rows[1].error).toContain("对象");expect(rows[2].error).toContain("重复规则");expect(()=>parseJsonImport('{"data":{}}',"Asia/Shanghai")).toThrow(/数组/);
});
it("expands the original weekday matrix with explicit school times",()=>{
 const courses=parseCourseTable([["节次","星期一","星期二","星期三","星期四","星期五"],["1-2","高等数学\n王老师\n1-4[单周]\nA101","","","",""]]);expect(courses).toHaveLength(1);
 const rows=expandCourseTable(courses,"2026-11-16",{"1-2":{start:"08:00",end:"09:35"}},"Asia/Shanghai");expect(rows.map(row=>row.payload?.startAt)).toEqual(["2026-11-16T00:00:00.000Z","2026-11-30T00:00:00.000Z"]);expect(rows[0].payload?.notes).toContain("王老师");
});
it("validates school week expressions and requires a Monday plus section times",()=>{
 expect(parseCourseWeeks("1-6[双周],8")).toEqual([2,4,6,8]);expect(parseCourseWeeks("1、3、5")).toEqual([1,3,5]);expect(()=>parseCourseWeeks("2-1")).toThrow();expect(()=>parseCourseWeeks("1-61")).toThrow();
 const courses=parseCourseTable([["课程名称","星期","周次","节次"],["线代","周三","1-2","3-4"]]);expect(()=>expandCourseTable(courses,"2026-11-17",{},"Asia/Shanghai")).toThrow(/周一/);expect(()=>expandCourseTable(courses,"2026-11-16",{},"Asia/Shanghai")).toThrow(/起止/);expect(()=>expandCourseTable(courses,"2026-11-16",{"3-4":{start:"10:00",end:"09:00"}},"Asia/Shanghai")).toThrow(/晚于/);
});
it("marks loaded and in-file duplicates separately from overlap warnings",()=>{
 const rows=parseJsonImport(JSON.stringify([{title:"A",day:"2026-11-20",start:"09:00",duration:60},{title:"B",day:"2026-11-20",start:"09:30",duration:30},{title:"A",day:"2026-11-20",start:"09:00",duration:60}]),"Asia/Shanghai"),marked=markImportDuplicates(rows);
 expect(marked[0].duplicate).toBe(false);expect(marked[0].conflicts).toContain("B");expect(marked[2].duplicate).toBe(true);
});
it.each(["RECURRENCE-ID:20261120T010000Z","EXDATE:20261127T010000Z"])("never imports an unexpanded ICS recurrence exception: %s",rule=>{
 const [row]=parseIcsImport(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:有重复例外的课程\r\nDTSTART:20261120T010000Z\r\nDTEND:20261120T020000Z\r\n${rule}\r\nEND:VEVENT\r\nEND:VCALENDAR`,"Asia/Shanghai");expect(row.payload).toBeUndefined();expect(row.error).toContain("重复规则");
});

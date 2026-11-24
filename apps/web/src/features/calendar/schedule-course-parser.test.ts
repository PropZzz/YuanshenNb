import { expect, it } from "vitest";
import { courseTableSettings, expandCourseTable, hasCourseTable, parseCourseTable } from "./schedule-course-parser";
import { prepareImportTable } from "./schedule-import-detection";
import { schoolTimetableExport } from "./__fixtures__/school-timetable";

it("recognizes spaced weekday headings, a leading morning column and inline teaching weeks", () => {
 const matrix = [["2026年秋季课表"], ["", "节次", "星 期 一", "星 期 二", "星 期 三"], ["上午", "第01、02节", "高等数学\n张老师\n第1-16周(单)\n教室：A101", "", "大学英语\n教师：李老师\n周次：2-16(双周)\n地点：B202"]];
 expect(hasCourseTable(matrix)).toBe(true);
 const prepared = prepareImportTable(matrix);
 expect(prepared.headerRow).toBe(1);
 const courses = parseCourseTable(prepared.table);
 expect(courses).toHaveLength(2);
 expect(courses[0]).toMatchObject({ title: "高等数学", sections: "1-2", weekday: 1, weeks: "1-16[单周]", teacher: "张老师", location: "A101" });
 expect(courses[1]).toMatchObject({ title: "大学英语", weekday: 3, weeks: "2-16[双周]", teacher: "李老师", location: "B202" });
});

it("preserves separated semester ranges and detects an embedded class label in a numeric section",()=>{
 const courses=parseCourseTable([["","节次","星期一","星期二"],["上午","第 3 节","物理\n王老师\n实验楼\n1-8周，10-16周",""]]);
 expect(courses[0]).toMatchObject({weeks:"1-8,10-16",sections:"3",teacher:"王老师",location:"实验楼"});
 expect(expandCourseTable(courses,"2026-11-23",{"3":{start:"08:00",end:"08:45"}},"Asia/Shanghai")).toHaveLength(15);
});

it("recognizes common list aliases and resolves combined lessons from individual section times", () => {
 const matrix = [["课程", "星期几", "授课周", "节数"], ["线性代数", "星期三", "1-2", "第3,4节"]];
 expect(hasCourseTable(matrix)).toBe(true);
 const courses = parseCourseTable(matrix);
 const rows = expandCourseTable(courses, "2026-11-23", {"3": {start:"10:00",end:"10:45"},"4":{start:"10:55",end:"11:40"}}, "Asia/Shanghai");
 expect(rows[0].payload).toMatchObject({ title:"线性代数", startAt:"2026-11-25T02:00:00.000Z", endAt:"2026-11-25T03:40:00.000Z" });
});

it("extracts the actual semester anchor and times from source metadata", () => {
 const matrix = [["学期第一周周一", "2026年9月7日"], ["节次", "开始时间", "结束时间"], ["1", "08:00", "08:45"], ["2", "08:55", "09:40"], ["节次", "星期一", "星期二"], ["1-2", "数学\n1-16周\nA101", ""]];
 expect(courseTableSettings(matrix)).toEqual({ firstMonday:"2026-09-07", sectionTimes:{"1":{start:"08:00",end:"08:45"},"2":{start:"08:55",end:"09:40"}} });
});

it("preserves a weekly matrix with no teaching week labels as a single disclosed week", () => {
 const courses=parseCourseTable([["时间", "周一", "周二"], ["第1-2节", "课程名称：实验设计\n教师：王老师\n教室：A101", ""]]);
 expect(courses[0]).toMatchObject({title:"实验设计",weeks:"1",teacher:"王老师",location:"A101"});
 expect(courses[0].notes).toContain("未标注周次");
});

it("reports malformed nonempty course cells instead of silently dropping them", () => {
 expect(()=>parseCourseTable([["节次", "周一", "周二"], ["1-2", "有效课程\n1-16周", "无法确定课程信息\n周次：错误"]])).toThrow(/周次/);
});

it("accepts dated weekday headers and never treats numeric course list data as a header",()=>{
 expect(parseCourseTable([["节次","星期一\n11月23日","星期二\n11月24日"],["1-2","数学\n1-2周",""]])[0].weekday).toBe(1);
 expect(parseCourseTable([["课程名称","星期","周次","节次"],["周一学习活动","1","1","1"]])[0]).toMatchObject({title:"周一学习活动",weekday:1,weeks:"1",sections:"1"});
 expect(()=>parseCourseTable([["节次","星期一","星期二"],["1-2","数学\n1-8周 / 10-16周",""]])).toThrow(/周次/);
});

it("keeps each range's own odd/even suffix and recognizes a vertical semester date",()=>{
 const [mixed]=parseCourseTable([["节次","周一","周二"],["1-2","数学\n1-8周(单)，10-16周(双)",""]]);
 expect(expandCourseTable([mixed],"2026-11-23",{"1-2":{start:"08:00",end:"09:35"}},"Asia/Shanghai")).toHaveLength(8);
 const [suffix]=parseCourseTable([["节次","周一","周二"],["1-2","数学\n1-8周，10-16周(双)",""]]);
 expect(expandCourseTable([suffix],"2026-11-23",{"1-2":{start:"08:00",end:"09:35"}},"Asia/Shanghai")).toHaveLength(12);
 expect(courseTableSettings([["学期第一周周一"],["2026-09-07"]]).firstMonday).toBe("2026-09-07");
});

it("finds the transposed lesson header before numeric school-calendar footer rows", () => {
 const table=schoolTimetableExport(),prepared=prepareImportTable(table);
 expect(prepared.headerRow).toBe(2);
 expect(hasCourseTable(prepared.table)).toBe(true);
 expect(parseCourseTable(prepared.table)).toHaveLength(12);
});

it("reads a transposed school export's bell times, semester calendar and every teaching range", () => {
 const table=schoolTimetableExport(),settings=courseTableSettings(table);
 expect(settings.firstMonday).toBe("2026-09-07");
 expect(settings.sectionTimes["3"]).toEqual({start:"10:00",end:"10:45"});
 expect(settings.sectionTimes["10"]).toEqual({start:"19:55",end:"20:40"});
 const courses=parseCourseTable(prepareImportTable(table).table);
 expect(courses.find(course=>course.title==="系统基础"&&course.weekday===3)).toMatchObject({sections:"3-4",weeks:"1-16[单周]"});
 expect(courses.filter(course=>course.title==="数据管理"&&course.weekday===4)).toHaveLength(2);
 expect(courses.find(course=>course.title==="艺术鉴赏")).toMatchObject({weeks:"1-10",location:""});
 const rows=expandCourseTable(courses,settings.firstMonday!,settings.sectionTimes,"Asia/Shanghai");
 expect(rows).toHaveLength(108);
 expect(rows[0].payload).toMatchObject({title:"数据分析",startAt:"2026-09-07T02:00:00.000Z",endAt:"2026-09-07T03:40:00.000Z"});
 expect(rows.some(row=>row.title.includes("示例班")||row.title.includes("----"))).toBe(false);
});

it("does not infer the semester start from a printed-on date or an inconsistent school calendar", () => {
 expect(courseTableSettings([["学年学期：2026-2027-1 打印日期：2026-11-23"]]).firstMonday).toBeUndefined();
 const table=schoolTimetableExport();table[12][3]="13";
 expect(courseTableSettings(table).firstMonday).toBeUndefined();
});

it("explains an empty course grid without claiming that the file lost its lesson labels", () => {
 expect(()=>parseCourseTable([["节次","星期一","星期二"],["1-2","",""]])).toThrow(/文件已读取.*尚未识别出课程安排.*尚未导入/);
});

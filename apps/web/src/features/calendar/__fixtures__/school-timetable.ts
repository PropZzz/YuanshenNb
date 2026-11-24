// Anonymous reproduction of a school export: weekdays run down the left,
// with merged lesson columns, a school calendar and a horizontal bell schedule.
export function schoolTimetableExport(): string[][] {
  const row = (cells: Record<number, string>) => Array.from({ length: 26 }, (_, column) => cells[column] ?? "");
  const course = (title: string, weeks: string, room = "A101") => `\n${title}\n${weeks}(32学时)\n${room}\n示例班\n`;
  const sections = row({ 1: "1－2", 5: "3－4", 9: "5－6", 13: "7－8", 17: "9－10", 21: "11－12", 25: "备注" });
  const calendarWeeks = row({ 1: "周次" });
  for (let week = 1; week <= 20; week++) calendarWeeks[week + 2] = String(week);
  return [
    row({ 0: "示例学校 学生课表" }),
    row({ 0: "学年学期：2026-2027-1 班级：示例班 打印日期：2026-11-23" }),
    sections,
    row({ 0: "星期一", 5: course("数据分析", "1-16周") }),
    row({ 0: "星期二", 9: course("公共政策", "7,11周"), 13: course("数据管理", "1-6,8-16周") }),
    row({ 0: "星期三", 5: course("系统基础", "1-16单周") }),
    row({ 0: "星期四", 5: course("数据管理", "1-16单周") + "---------\n" + course("数据管理", "10周", "B402"), 17: course("艺术鉴赏", "1-10周", "") }),
    row({ 0: "星期五", 5: [course("理论课程", "3-4,6-9,11-18周"), course("理论课程", "10周"), course("理论课程", "5周")].join("---------\n"), 9: course("系统基础", "1-16周"), 13: course("创新实践", "3-18周") }),
    row({ 0: "星期六" }),
    row({ 0: "星期日" }),
    row({ 0: "校历", 1: "月份", 3: "9月", 7: "10月", 11: "11月", 16: "12月", 20: "1月" }),
    row({ 1: "星期日", 3: "06", 4: "13", 5: "20", 6: "27" }),
    row({ 1: "星期六", 3: "12", 4: "19", 5: "26", 6: "03" }),
    calendarWeeks,
    row({ 0: "作息时间", 1: "节次", 3: "1", 5: "2", 7: "3", 9: "4", 11: "5", 13: "6", 15: "7", 17: "8", 19: "9", 21: "10" }),
    row({ 1: "时间", 3: "08:00-08:45", 5: "08:55-09:40", 7: "10:00-10:45", 9: "10:55-11:40", 11: "14:00-14:45", 13: "14:55-15:40", 15: "16:00-16:45", 17: "16:55-17:40", 19: "19:00-19:45", 21: "19:55-20:40" }),
    row({ 0: "说明" }),
  ];
}

import { isValidDay, shiftDay } from "@/lib/datetime";
import type { ImportCourse, SectionTimes } from "./schedule-course-parser";

const weekdays:Record<string,number>={一:1,二:2,三:3,四:4,五:5,六:6,日:7,天:7,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6,sun:7,sunday:7};
const clean=(value:string)=>value.trim().toLowerCase().replace(/[\s_（）()]/g,"");
const aliases={title:["课程名称","课程","科目","课程名","title","name"],weekday:["星期","星期几","上课星期","weekday","dayofweek"],weeks:["周次","授课周","上课周次","教学周","weeks"],sections:["节次","节数","上课节次","sections"],teacher:["教师","老师","任课教师","授课教师","teacher"],location:["地点","教室","上课地点","location"],notes:["备注","说明","notes"]};

export function courseWeekdayHeader(value:string):number|undefined {
 const text=clean(value);
 const match=text.match(/^(?:星期|周|礼拜)([一二三四五六日天1-7])/);
 return match?weekdays[match[1]]:weekdays[text];
}
function courseMapping(headers:string[]){return Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,headers.findIndex(value=>names.includes(clean(value)))])) as Record<keyof typeof aliases,number>;}
// Numeric weekdays are valid in a course list, but week numbers in a school
// calendar must never be mistaken for the main timetable's weekday headings.
function explicitWeekday(value:string){return /^\d+$/.test(clean(value))?undefined:courseWeekdayHeader(value);}
function matrixHeader(row:string[]){return row.filter(value=>explicitWeekday(value)!==undefined).length>=2;}
function sectionHeading(value:string):string|undefined {
 const text=value.normalize("NFKC").replace(/\s/g,"");
 if(!/^(?:第)?\d{1,2}(?:[-—~至、,，]\d{1,2})*(?:节)?$/.test(text))return;
 try{return courseSections(text);}catch{return;}
}
function transposedHeader(row:string[],followingRows:string[][]){
 const columns=row.flatMap((value,column)=>{const sections=sectionHeading(value);return sections?[{column,sections}]:[];});
 if(columns.length<2)return;
 for(let weekdayColumn=0;weekdayColumn<columns[0].column;weekdayColumn++){
  const days=new Set(followingRows.slice(0,10).map(next=>explicitWeekday(next[weekdayColumn]??"")).filter(value=>value!==undefined));
  if(days.size>=2)return {columns,weekdayColumn};
 }
}
export function courseHeaderScore(row:string[],followingRows:string[][]=[]):number {
 if(matrixHeader(row))return 100+row.filter(value=>explicitWeekday(value)!==undefined).length;
 const mapping=courseMapping(row);
 if([mapping.title,mapping.weekday,mapping.weeks,mapping.sections].every(value=>value>=0))return 104;
 const transposed=transposedHeader(row,followingRows);return transposed?100+transposed.columns.length:0;
}
export function courseSections(value:string):string {
 const match=value.replace(/[０-９]/g,char=>String(char.charCodeAt(0)-65296)).replace(/\s/g,"").replace(/[－—~至]/g,"-").replace(/[、，]/g,",").match(/(?:第)?(\d{1,2}(?:[-,]\d{1,2})*)(?:节)?/);
 if(!match)throw new Error("无法识别课程节次，请保留第1-2节这类节次信息");
 const numbers=new Set<number>();
 for(const token of match[1].split(",")){const [start,end=start]=token.split("-").map(Number);if(start<1||end<start||end>30)throw new Error("课程节次应为1至30节");for(let section=start;section<=end;section++)numbers.add(section);}
 const ordered=[...numbers].sort((a,b)=>a-b);
 return ordered.length>1&&ordered.every((value,index)=>value===ordered[0]+index)?`${ordered[0]}-${ordered.at(-1)}`:ordered.join(",");
}
function sectionNumbers(value:string):number[]{return courseSections(value).split(",").flatMap(token=>{const [start,end=start]=token.split("-").map(Number);return Array.from({length:end-start+1},(_,index)=>start+index);});}
export function courseSectionTime(section:string,times:SectionTimes):{start:string;end:string}|undefined {
 if(times[section]?.start&&times[section]?.end)return times[section];
 const groups=sectionNumbers(section);if(!groups.every(value=>times[String(value)]?.start&&times[String(value)]?.end))return;
 return {start:times[String(groups[0])].start,end:times[String(groups.at(-1))].end};
}
function matrixCourse(raw:string,id:string,day:number,section:string):ImportCourse {
 const lines=raw.split(/\r?\n|[；;]/).map(line=>line.trim()).filter(Boolean);
 const labeled=(label:string)=>lines.find(line=>new RegExp(`^(?:${label})[：:]`).test(line))?.replace(/^[^：:]+[：:]\s*/,"")??"";
 let weekIndex=lines.findIndex(line=>/周次[：:]|\d.*周/.test(line));
 if(weekIndex<0)weekIndex=lines.findIndex(line=>/^\(?\d+(?:\s*[-~至－—]\s*\d+)?(?:\s*[,，、]\s*\d+(?:\s*[-~至－—]\s*\d+)?)*(?:\s*[\[（(](?:单周|双周|周|奇数周|偶数周|单|双)[\]）)])?\)?$/.test(line)&&!/^\d{5,}$/.test(line));
 let weeks="1";
 if(weekIndex>=0){
  const expression=lines[weekIndex].replace(/[（(\[]\s*\d+(?:\.\d+)?\s*学时\s*[）)\]]/g,"").replace(/^周次[：:]\s*/,"").replace(/\s|第|周/g,"").replace(/[－—~至]/g,"-").replace(/[（(]/g,"[").replace(/[）)]/g,"]").replace(/[、，]|及|和|与/g,",");
  const ranges=expression.split(",").map(token=>{
   const prefix=token.match(/^([单双])(.+)$/);if(prefix)token=`${prefix[2]}[${prefix[1]}]`;
   token=token.replace(/(\d)(单|双|奇数|偶数)$/, "$1[$2]");
   if(!/^\d{1,2}(?:-\d{1,2})?(?:\[(?:单|双|奇数|偶数)\])?$/.test(token))throw new Error("课表周次未完整识别，请用逗号分隔不同周次范围");
   return token.replace(/\[(单|双|奇数|偶数)\]/,"[$1周]");
  });
  weeks=ranges.join(",");
 }
 const title=labeled("课程名称|课程|科目")||lines.find((line,index)=>index!==weekIndex&&!/^(?:教师|老师|教室|地点|周次|节次)[：:]|^[\[（(]?\d+[\]）)]?$/.test(line));
 if(!title)throw new Error("课表单元格缺少课程名称");
 const titleIndex=lines.findIndex(line=>line===title||line.endsWith(`：${title}`)||line.endsWith(`:${title}`));
 const beforeWeek=weekIndex>0?lines.slice(titleIndex+1,weekIndex).filter(line=>line!==title):[];
 const isRoom=(line:string)=>/教室|地点|房间|楼|室$|座\s*\d|^[A-Za-z]{1,5}[-]?[A-Za-z]*\d[A-Za-z0-9-]*$|^\d{3,5}$/.test(line);
 const location=labeled("教室|地点|上课地点")||beforeWeek.find(isRoom)|| (weekIndex>=0?lines.slice(weekIndex+1).find(isRoom)??"":"");
 const teacher=labeled("教师|老师|任课教师|授课教师")||beforeWeek.find(line=>!isRoom(line))||"";
 const extra=lines.filter((line,index)=>index!==titleIndex&&index!==weekIndex&&line!==teacher&&line!==location&&!/^(?:课程名称|课程|科目|教师|老师|任课教师|授课教师|教室|地点|上课地点|节次)[：:]/.test(line));
 return {id,title,weekday:day,weeks,sections:section,teacher,location,notes:[weekIndex<0?"来源课表未标注周次，按第1周导入":"",...extra].filter(Boolean).join("\n")};
}
function courseBlocks(raw:string):string[]{
 return raw.replace(/\r/g,"").split(/^[ \t]*[-－—─=]{3,}[ \t]*$/m).flatMap(group=>{
  const blocks:string[]=[];
  const hasWeeks=(text:string)=>/周次[：:]|\d[^\n]*周/.test(text);
  for(const part of group.split(/\n[ \t]*\n/).map(value=>value.trim()).filter(Boolean)){
   // A missing room creates a blank line before the class name in school
   // exports. Only start another blank-line block when both have week data.
   if(blocks.length&&(!hasWeeks(part)||!hasWeeks(blocks.at(-1)!)))blocks[blocks.length-1]+=`\n${part}`;
   else blocks.push(part);
  }
  return blocks;
 });
}
export function recognizedCourseRows(table:string[][]):ImportCourse[] {
 const firstHeader=table.findIndex((row,index)=>courseHeaderScore(row,table.slice(index+1,index+11))>=100);
 const weekdayRow=firstHeader>=0&&matrixHeader(table[firstHeader])?firstHeader:-1,courses:ImportCourse[]=[];
 const transposed=firstHeader>=0?transposedHeader(table[firstHeader],table.slice(firstHeader+1,firstHeader+11)):undefined;
 if(weekdayRow>=0){
  const columns=table[weekdayRow].flatMap((value,column)=>{const day=explicitWeekday(value);return day?[{column,day}]:[];});
  table.slice(weekdayRow+1).forEach((row,index)=>{
   const label=row.slice(0,columns[0].column).reverse().find(cell=>/(?:第)?\d{1,2}(?:\s*[-－—~至、,，]\s*\d{1,2})*(?:节)?/.test(cell));
   if(!label)return;const section=courseSections(label);
   for(let columnIndex=0;columnIndex<columns.length;columnIndex++){
    const {column,day}=columns[columnIndex],nextColumn=columns[columnIndex+1]?.column??Math.max(row.length,column+1);
    const cells=row.slice(column,nextColumn).filter(cell=>cell.trim());const raw=[...new Set(cells)].join("\n");if(!raw)continue;
    courseBlocks(raw).forEach((block,blockIndex)=>courses.push(matrixCourse(block,`course-${index}-${column}-${blockIndex}`,day,section)));
   }
  });
 }else if(transposed){
  let started=false;
  for(let index=firstHeader+1;index<table.length;index++){
   const row=table[index],label=row[transposed.weekdayColumn]??"",day=explicitWeekday(label);
   if(!day){if(started&&label.trim())break;continue;}started=true;
   for(let columnIndex=0;columnIndex<transposed.columns.length;columnIndex++){
    const {column,sections}=transposed.columns[columnIndex];
    const trailing=table[firstHeader].findIndex((value,c)=>c>column&&value.trim()&&!sectionHeading(value));
    const end=transposed.columns[columnIndex+1]?.column??(trailing>=0?trailing:row.length);
    const raw=[...new Set(row.slice(column,end).filter(cell=>cell.trim()))].join("\n");if(!raw)continue;
    courseBlocks(raw).forEach((block,blockIndex)=>courses.push(matrixCourse(block,`course-${index}-${column}-${blockIndex}`,day,sections)));
   }
  }
 }else{
  const header=table.findIndex(row=>courseHeaderScore(row)>=100),mapping=courseMapping(table[Math.max(0,header)]??[]);
  if([mapping.title,mapping.weekday,mapping.weeks,mapping.sections].some(value=>value<0))throw new Error("课程列表需包含课程名称、星期、周次和节次");
  table.slice(Math.max(0,header)+1).forEach((row,index)=>{
   if(!row.some(Boolean))return;const get=(key:keyof typeof mapping)=>row[mapping[key]]??"",day=courseWeekdayHeader(get("weekday"));
   if(!day)throw new Error("课程星期必须为1至7或星期一至日");
   courses.push({id:`course-${index}`,title:get("title"),weekday:day,weeks:get("weeks"),sections:courseSections(get("sections")),teacher:get("teacher"),location:get("location"),notes:get("notes")});
  });
 }
 if(!courses.length)throw new Error("文件已读取，但尚未识别出课程安排。请确认选择了包含星期、节次和课程内容的工作表。当前尚未导入任何日程。");
 return courses;
}
export function courseTableSettings(matrix:string[][]):{firstMonday?:string;sectionTimes:SectionTimes} {
 const result:{firstMonday?:string;sectionTimes:SectionTimes}={sectionTimes:{}};
 for(const [rowIndex,row] of matrix.slice(0,50).entries()){
  const line=[...row,...(matrix[rowIndex+1]??[])].join(" ");
  if(row.some(value=>/(?:学期|开学)(?:第一周)?(?:开始|起始)?(?:日期|时间|周一)|第[一1]周(?:开始|起始)?(?:日期|周一)|semesterstart|semesterweek1monday/i.test(value.replace(/\s/g,"")))){
   const match=line.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/);
   if(match){const day=`${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;if(isValidDay(day)&&new Date(`${day}T12:00Z`).getUTCDay()===1)result.firstMonday=day;}
  }
  const clocks=row.join(" ").match(/(?:^|\D)((?:[01]?\d|2[0-3])[:：][0-5]\d)(?!\d)/g)?.map(value=>value.replace(/^\D/,""));
  if(clocks&&clocks.length>=2&&/^(?:第)?\s*\d{1,2}(?:[-、,，]\d{1,2})*\s*节?\s*$/.test(row[0]??"")){
   const normalize=(clock:string)=>clock.replace("：",":").padStart(5,"0");result.sectionTimes[courseSections(row[0])]={start:normalize(clocks[0]),end:normalize(clocks[1])};
  }
  const sectionColumn=row.findIndex(value=>/^(?:节次|节数)$/.test(clean(value)));
  const next=matrix[rowIndex+1];
  if(sectionColumn>=0&&next&&next.some(value=>/^(?:时间|上课时间|作息时间)$/.test(clean(value)))){
   row.forEach((value,column)=>{
    const sections=column>sectionColumn?sectionHeading(value):undefined;
    const times=(next[column]??"").match(/(?:[01]?\d|2[0-3])[:：][0-5]\d/g);
    if(sections&&times?.length===2)result.sectionTimes[sections]={start:times[0].replace("：",":").padStart(5,"0"),end:times[1].replace("：",":").padStart(5,"0")};
   });
  }
 }
 result.firstMonday??=schoolCalendarMonday(matrix.slice(0,50));
 return result;
}

function schoolCalendarMonday(matrix:string[][]):string|undefined {
 const academicYear=matrix.flat().join(" ").match(/(?:学年学期|学年|学期)[：:\s]*(20\d{2})\s*[-－—~至]\s*(20\d{2})/);
 if(!academicYear)return;
 const calendarIndex=matrix.findIndex(row=>row.some(value=>clean(value)==="校历"));
 if(calendarIndex<0)return;
 const weekIndex=matrix.findIndex((row,index)=>index>calendarIndex&&row.some(value=>clean(value)==="周次"));
 if(weekIndex<0)return;
 const weekRow=matrix[weekIndex],labelColumn=weekRow.findIndex(value=>clean(value)==="周次");
 const column=weekRow.findIndex((value,index)=>index>labelColumn&&clean(value)==="1");if(column<0)return;
 const calendar=matrix.slice(calendarIndex,weekIndex);
 const monthRow=calendar.find(row=>row.some(value=>/^\d{1,2}月$/.test(clean(value))));
 const monthLabel=monthRow?.slice(0,column+1).reverse().find(value=>/^\d{1,2}月$/.test(clean(value)));
 if(!monthLabel)return;
 const month=Number(clean(monthLabel).replace("月",""));if(month<1||month>12)return;
 const year=Number(academicYear[month>=8?1:2]);
 const saturday=calendar.find(row=>row.some(value=>explicitWeekday(value)===6));
 for(const weekday of [1,7]){
  const row=calendar.find(row=>row.some(value=>explicitWeekday(value)===weekday));
  const number=row?.[column]?.trim();if(!number||!/^\d{1,2}$/.test(number))continue;
  const day=`${year}-${String(month).padStart(2,"0")}-${number.padStart(2,"0")}`;
  if(!isValidDay(day)||new Date(`${day}T12:00Z`).getUTCDay()!==weekday%7)continue;
  if(saturday?.[column]&&Number(shiftDay(day,weekday===7?6:5).slice(-2))!==Number(saturday[column]))return;
  return weekday===7?shiftDay(day,1):day;
 }
}

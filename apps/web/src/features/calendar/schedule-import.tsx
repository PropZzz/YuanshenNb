import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Check, FileUp, UploadCloud } from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { ApiError } from "@/api/errors";
import { errorMessage } from "@/api/unwrap";
import { unwrap } from "@/api/unwrap";
import { useAuthStore } from "@/stores/auth-store";
import { localDate, localInput, weekDays } from "@/lib/datetime";
import { Drawer } from "@/components/ui/drawer";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { importFieldLabels, inferImportMapping, mapImportTable, markImportDuplicates, parseIcsImport, parseJsonImport, type ImportField, type ImportMapping, type ImportPreviewRow } from "./schedule-import-parser";
import { courseTableSettings, expandCourseTable, hasCourseTable, parseCourseTable, type ImportCourse, type SectionTimes } from "./schedule-course-parser";
import { courseSectionTime } from "./schedule-course-recognition";
import { useInvalidateSchedule } from "./queries";
import { attributeFromText } from "./schedule-presentation";
import { loadWorkbookParser, preferredWorkbookSheet, readWorkbookBytes, workbookTable, type ImportWorkbook, type WorkbookParser } from "./schedule-workbook";
import { prepareImportTable, recognizeImportSource, type ImportSource } from "./schedule-import-detection";

type RowResult={state:"saved"|"failed"|"uncertain";message?:string};
export function ScheduleImport({open=true,onClose,existing=[],referenceDay}:{open?:boolean;onClose:()=>void;existing?:ApiComponents["ScheduleItemDTO"][];referenceDay?:string}){
 const timezone=useAuthStore(s=>s.user?.timezone??"Asia/Shanghai"),invalidate=useInvalidateSchedule(),id=useId(),input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [file,setFile]=useState<File>(),[encoding,setEncoding]=useState("auto"),[table,setTable]=useState<string[][]>(),[mapping,setMapping]=useState<ImportMapping>(),[rows,setRows]=useState<ImportPreviewRow[]>([]),[selected,setSelected]=useState<Set<string>>(new Set()),[results,setResults]=useState<Record<string,RowResult>>({}),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState<unknown>(),[status,setStatus]=useState("选择文件后会自动生成预览，确认前不会写入日历。"),[visible,setVisible]=useState(100);
 const [format,setFormat]=useState("auto"),[contentType,setContentType]=useState("auto"),[courses,setCourses]=useState<ImportCourse[]>([]),[firstMonday,setFirstMonday]=useState(""),[sectionTimes,setSectionTimes]=useState<SectionTimes>({});
 const [workbook,setWorkbook]=useState<{book:ImportWorkbook;parser:WorkbookParser}>(),[sheetName,setSheetName]=useState("");
 const [source,setSource]=useState<ImportSource>(),[headerRow,setHeaderRow]=useState(0),[advanced,setAdvanced]=useState(false),[dragging,setDragging]=useState(false);
 const [anchorSource,setAnchorSource]=useState<"file"|"calendar">("calendar");
 const courseStorageKey=()=>`ruanchuang-course-times:${useAuthStore.getState().user?.id??"local"}`;
 function rememberedTimes():SectionTimes{try{const value:unknown=JSON.parse(localStorage.getItem(courseStorageKey())??"{}");if(!value||typeof value!=="object"||Array.isArray(value))return {};return Object.fromEntries(Object.entries(value).filter(([key,times])=>/^\d{1,2}(?:[-,]\d{1,2})*$/.test(key)&&times&&typeof times==="object"&&/^\d{2}:\d{2}$/.test(times.start)&&/^\d{2}:\d{2}$/.test(times.end)));}catch{return {};}}
 const active=useRef(open);active.current=open;
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(!open){generation.current++;setReading(false);}},[open]);
 function preview(next:ImportPreviewRow[]){const marked=markImportDuplicates(next,existing);setRows(marked);setSelected(new Set(marked.filter(row=>row.payload&&!row.duplicate).map(row=>row.id)));setResults({});setVisible(100);setStatus(`已读取 ${marked.length} 条，${marked.filter(row=>row.error).length} 条需要检查，${marked.filter(row=>row.duplicate).length} 条重复。预览不会写入日历。`);}
 function autoCoursePreview(configured:ImportCourse[],monday:string,times:SectionTimes){
  setRows([]);setResults({});setSelected(new Set());setError(undefined);
  const missing=[...new Set(configured.filter(course=>!courseSectionTime(course.sections,times)).map(course=>course.sections))];
  if(missing.length){setStatus(`已自动识别 ${configured.length} 条课程，只需填写第 ${missing.join("、")} 节的上课时段。填写完成后自动生成课表。`);return;}
  try{preview(expandCourseTable(configured,monday,times,timezone));}catch(cause){setError(cause);setStatus("请检查课表日期与上课时段。");}
 }
 function configureTable(matrix:string[][],nextContent=contentType,keepCourseSettings=false){
  const courseSettings=courseTableSettings(matrix);
  const prepared=prepareImportTable(matrix);matrix=prepared.table;setHeaderRow(prepared.headerRow);
  if(matrix.length<2)throw new Error("文件需要一行字段名称和至少一条日程");
  setTable(matrix);
  const nextMapping=inferImportMapping(matrix[0]);
  const datedSchedule=[nextMapping.title,nextMapping.date,nextMapping.start].every(column=>Number(column)>=0);
  if(nextContent==="course"||nextContent==="auto"&&!datedSchedule&&hasCourseTable(matrix)){
   const configured=parseCourseTable(matrix),monday=courseSettings.firstMonday||(keepCourseSettings&&firstMonday)||weekDays(referenceDay??localDate(new Date(),timezone))[0];
   const times={...rememberedTimes(),...(keepCourseSettings?sectionTimes:{}),...courseSettings.sectionTimes};
   setCourses(configured);setFirstMonday(monday);setAnchorSource(courseSettings.firstMonday?"file":keepCourseSettings?anchorSource:"calendar");setSectionTimes(times);autoCoursePreview(configured,monday,times);
  }else{setMapping(nextMapping);preview(mapImportTable(matrix,nextMapping,timezone));}
 }
 function clearSource(){setRows([]);setSelected(new Set());setTable(undefined);setMapping(undefined);setCourses([]);setResults({});setError(undefined);}
 async function process(nextFile:File,nextEncoding=encoding,nextFormat=format,nextContent=contentType){const turn=++generation.current,identity=useAuthStore.getState().user?.id,current=()=>turn===generation.current&&active.current&&identity===useAuthStore.getState().user?.id;const sameFile=nextFile===file;setFile(nextFile);clearSource();setSource(undefined);setHeaderRow(0);setWorkbook(undefined);if(!sameFile){setFirstMonday("");setSectionTimes({});setSheetName("");}setReading(true);try{
  if(!nextFile.size||nextFile.size>5*1024*1024)throw new Error("文件为空或大于 5 MB，请检查后分批导入");
  const bytes=new Uint8Array(await readWorkbookBytes(nextFile));if(!current())return;
  const detected=recognizeImportSource(bytes,nextFile.name,nextEncoding,nextFormat);setSource(detected);
  if(detected.format==="xls"||detected.format==="xlsx"){const parser=await loadWorkbookParser();if(!current())return;const book=parser.read(bytes,{type:"array",cellDates:false,cellNF:true,sheetRows:5002});if(!book.SheetNames.length)throw new Error("工作簿中没有可导入的工作表");const name=sameFile&&book.SheetNames.includes(sheetName)?sheetName:preferredWorkbookSheet(book,parser);setWorkbook({book,parser});setSheetName(name);configureTable(workbookTable(book,name,parser),nextContent,sameFile);}
  else if(detected.format==="ics")preview(parseIcsImport(detected.text!,timezone));else if(detected.format==="json")preview(parseJsonImport(detected.text!,timezone));else configureTable(detected.table!,nextContent,sameFile);
 }catch(cause){if(current()){setError(cause);setAdvanced(true);setStatus("文件尚未导入，可调整下方识别设置或更换文件。");}}finally{if(current())setReading(false);}}
 function changeSheet(name:string){if(sourceLocked||!workbook)return;generation.current++;clearSource();setSheetName(name);setFirstMonday("");setSectionTimes({});try{configureTable(workbookTable(workbook.book,name,workbook.parser));}catch(cause){setError(cause);setStatus("工作表尚未导入，请检查内容。");}}
 function select(row:ImportPreviewRow,checked:boolean){setSelected(previous=>{const next=new Set(previous);if(checked)next.add(row.id);else next.delete(row.id);return next;});}
 const eligible=rows.filter(row=>row.payload&&!row.duplicate&&results[row.id]?.state!=="saved"&&results[row.id]?.state!=="uncertain"),count=eligible.filter(row=>selected.has(row.id)).length,saved=Object.values(results).filter(result=>result.state==="saved").length,failed=Object.values(results).filter(result=>result.state==="failed").length;
 const unknown=Object.values(results).some(result=>result.state==="uncertain"),sourceLocked=busy||reading||saved>0||unknown,excel=source?.format==="xls"||source?.format==="xlsx";
 const coursePreviewReady=courses.length>0&&rows.length>0;
 function chooseFile(next:File){if(busy||saved>0||unknown)return;setFormat("auto");setEncoding("auto");setContentType("auto");setAdvanced(false);void process(next,"auto","auto","auto");}
 function changeCourse(monday:string,times:SectionTimes){setFirstMonday(monday);setSectionTimes(times);autoCoursePreview(courses,monday,times);}
 async function confirm(){if(busy||!count)return;setBusy(true);setError(undefined);const pending=eligible.filter(row=>selected.has(row.id)),identity=useAuthStore.getState().user?.id;let successCount=saved,failureCount=0,uncertainCount=0;
  try{for(const row of pending){if(useAuthStore.getState().user?.id!==identity){setError(new Error("账号已切换，剩余条目未提交。请在当前账号重新检查预览。"));break;}try{const response=unwrap(await apiClient.POST("/api/v1/schedule/items",{body:row.payload!}));if(!response.item?.id)throw new Error("服务端响应缺少保存确认");successCount++;setResults(previous=>({...previous,[row.id]:{state:"saved"}}));setSelected(previous=>{const next=new Set(previous);next.delete(row.id);return next;});}catch(cause){const uncertain=!(cause instanceof ApiError);if(uncertain){uncertainCount++;setSelected(previous=>{const next=new Set(previous);next.delete(row.id);return next;});}else failureCount++;setResults(previous=>({...previous,[row.id]:{state:uncertain?"uncertain":"failed",message:uncertain?"结果未确认，请先刷新日历核对，避免重复创建。":errorMessage(cause)}}));if(uncertain)break;}}
   setStatus(`已成功导入 ${successCount} 条${failureCount?`，${failureCount} 条导入失败。请检查错误后重试失败条目；已成功的日程不会再次提交。`:uncertainCount?`，${uncertainCount} 条结果未确认。请先核对日历，剩余条目尚未提交。`:"。日历已刷新。"}`);if(successCount>0&&courses.length&&useAuthStore.getState().user?.id===identity){try{localStorage.setItem(courseStorageKey(),JSON.stringify(sectionTimes));}catch{/* Saving the timetable does not depend on local preferences. */}}await invalidate();
  }finally{setBusy(false);}
 }
 function remap(event:ChangeEvent<HTMLSelectElement>,key:ImportField){if(!mapping||sourceLocked)return;setMapping({...mapping,[key]:event.target.value});setRows([]);setSelected(new Set());setResults({});setStatus("字段对应已更改，请更新预览后确认。");}
 return <Drawer edge="right" open={open} onOpenChange={open=>{if(!open&&!busy&&!reading)onClose();}} title="导入日程" className="calendar-drawer calendar-import-drawer" footer={<div className="calendar-drawer-actions"><Button disabled={!count||reading} pending={busy} onClick={()=>void confirm()}><FileUp size={16}/>{failed?`重试失败条目（${count}）`:`确认导入${count?`（${count} 条）`:""}`}</Button><Button variant="ghost" disabled={busy||reading} onClick={onClose}>{saved&&!failed?"完成":"取消"}</Button></div>}>
  <div className="calendar-drawer-stack">{!file&&<p className="calendar-import-intro">把已有安排带进日历。选择文件，核对预览，就可以导入。</p>}
  <div className={`calendar-import-upload${dragging?" is-dragging":""}`} onDragOver={event=>{event.preventDefault();if(!sourceLocked&&Array.from(event.dataTransfer.types).includes("Files")){event.dataTransfer.dropEffect="copy";setDragging(true);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}} onDrop={event=>{event.preventDefault();setDragging(false);if(sourceLocked)return;const files=event.dataTransfer.files;if(files.length!==1){setError(new Error("请每次选择一个文件，确认导入后再添加下一个"));return;}chooseFile(files[0]);}}>
   <label htmlFor={id} className="sr-only">导入文件</label><input ref={input} id={id} type="file" accept=".xls,.xlsx,.els,.csv,.tsv,.txt,.json,.ics" className="sr-only" onChange={event=>{const selectedFile=event.target.files?.[0];event.target.value="";if(selectedFile)chooseFile(selectedFile);}} disabled={sourceLocked}/>
   <button type="button" aria-label={file?`更换文件：${file.name}`:"选择或拖入文件"} className="calendar-file-card calendar-import-dropzone" disabled={sourceLocked} onClick={()=>input.current?.click()}><UploadCloud size={30}/><span><strong>{file?.name??"选择或拖入文件"}</strong><small>{reading?"正在识别文件…":file?`${Math.max(1,Math.ceil(file.size/1024))} KB · 点击更换文件`:"自动识别格式、日期和时间，无需提前设置"}</small></span>{file&&<b>更换</b>}</button>
   {!file&&<p className="calendar-field-note">Excel（XLS / XLSX）、CSV、TSV、TXT、ICS、JSON · 最大 5 MB</p>}<p className="calendar-field-note">文件在本机解析，确认后才保存所选日程。</p>
  </div>
  {source&&!reading&&<div className="calendar-import-recognized"><Check size={16}/><div><strong>已识别为 {excel?"Excel 工作簿":source.format==="ics"?"ICS 日历":source.format==="json"?"JSON 日程":"日程表格"}</strong><small>{[source.encoding?.toUpperCase().replace("GB18030","GBK / GB18030"),source.delimiter?(source.delimiter==="\t"?"制表符分隔":source.delimiter===";"?"分号分隔":source.delimiter===","?"逗号分隔":"竖线分隔"):"",sheetName?`工作表：${sheetName}`:"",headerRow?`已跳过 ${headerRow} 行说明`:""].filter(Boolean).join(" · ")}</small></div></div>}
  {excel&&workbook&&workbook.book.SheetNames.length>1&&<section><label className="field">工作表<select value={sheetName} disabled={sourceLocked} onChange={event=>changeSheet(event.target.value)}>{workbook.book.SheetNames.map(name=><option value={name} key={name}>{name}</option>)}</select></label><p className="calendar-field-note">已自动选择可识别的工作表，也可以切换。</p></section>}

  {courses.length>0&&<section className="calendar-field-group calendar-course-options">
   <h3>{coursePreviewReady?"已识别课表 · 日程已自动生成":"已识别课表 · 填写上课时段"}</h3>
   <p className="calendar-field-note">已找到 {courses.length} 条课程，{coursePreviewReady?"星期、周次、节次和上课时段已匹配，核对预览后即可确认导入。":"星期、周次和节次已自动匹配。填写一次，以后导入可复用。"}</p>
   <p className="calendar-field-note">第1周从 {firstMonday} 开始。{anchorSource==="file"?"日期来自课表。":"文件未注明开学日期，暂以日历当前周为第1周；如有不同，请在下方修改。"}</p>
   <details className="calendar-course-date"><summary>调整第1周日期</summary><DateTimeField timezone={timezone} label="学期第一周周一" type="date" value={firstMonday} disabled={sourceLocked} onChange={value=>changeCourse(value,sectionTimes)}/></details>
   <div className="calendar-course-time-header"><span>节次</span><span>开始时间</span><span>结束时间</span></div>
   {[...new Set(courses.map(course=>course.sections))].map(section=><div className="calendar-course-time-row" key={section}><strong>第 {section} 节</strong>{(["start","end"] as const).map(kind=><DateTimeField key={kind} label={`第 ${section} 节${kind==="start"?"开始":"结束"}时间`} type="time" value={courseSectionTime(section,sectionTimes)?.[kind]??sectionTimes[section]?.[kind]??""} disabled={sourceLocked} onChange={value=>changeCourse(firstMonday,{...sectionTimes,[section]:{start:courseSectionTime(section,sectionTimes)?.start??sectionTimes[section]?.start??"",end:courseSectionTime(section,sectionTimes)?.end??sectionTimes[section]?.end??"",[kind]:value}})}/>)}</div>)}
   <p className="calendar-field-note">{coursePreviewReady?"课程日期和时间已填好，可直接核对下方预览；需要调整时可修改上方时段。":"时段填写完成后自动生成预览，点击下方“确认导入”保存。"}</p>
  </section>}
  <p className="calendar-import-status" role="status" aria-live="polite">{reading?"正在本机读取文件…":status}</p><InlineError error={error}/>
  {!!rows.length&&table&&mapping&&table.slice(1).some(row=>!row[Number(mapping.end)]&&!row[Number(mapping.duration)])&&<p className="calendar-field-note">未填结束时间和时长的条目暂按 60 分钟预览，请核对后再导入。</p>}
  {rows.length>0&&<section className="calendar-import-preview"><header><h3>日程预览 <span>{rows.length} 条 · 已选 {count} 条</span></h3><label><input type="checkbox" aria-label="全选" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(row=>selected.has(row.id))} onChange={event=>setSelected(new Set(event.target.checked?eligible.map(row=>row.id):[]))}/>全选</label></header>{rows.some(row=>row.duplicate||row.error||row.conflicts?.length)&&<div className="calendar-import-summary"><span>有效 {rows.filter(row=>row.payload&&!row.duplicate).length}</span><span>重复 {rows.filter(row=>row.duplicate).length}</span><span>预警 {rows.filter(row=>!row.duplicate&&row.conflicts?.length).length}</span><span>错误 {rows.filter(row=>row.error).length}</span></div>}{rows.slice(0,visible).map(row=><label className={`calendar-import-row ${row.error?"has-error":""}`} key={row.id}><input type="checkbox" aria-label={`选择${row.title}`} checked={selected.has(row.id)} disabled={busy||!row.payload||row.duplicate||results[row.id]?.state==="saved"||results[row.id]?.state==="uncertain"} onChange={event=>select(row,event.target.checked)}/><span><strong>{row.title}</strong>{row.payload&&<small>{localInput(row.payload.startAt,timezone).replace("T"," ")} — {localInput(row.payload.endAt,timezone).replace("T"," ")}</small>}{row.payload?.presentation?.attributeTag&&<small className="calendar-import-attribute" style={{color:attributeFromText(row.payload.presentation.attributeTag)?.color}}>属性：{attributeFromText(row.payload.presentation.attributeTag)?.label}</small>}{row.payload?.notes&&<small>{row.payload.notes}</small>}{row.error&&<small className="calendar-import-error">{row.error}</small>}{row.duplicate&&<small>文件内或当前已加载日程中重复，已跳过</small>}{!row.duplicate&&!!row.conflicts?.length&&<small className="calendar-import-warning">时段重叠预警：{row.conflicts.join("、")}。保存时仍由服务端检查。</small>}{results[row.id]?.state==="saved"&&<small className="calendar-import-saved"><Check size={12}/>已成功导入</small>}{(results[row.id]?.state==="failed"||results[row.id]?.state==="uncertain")&&<small className="calendar-import-error">{results[row.id].message}</small>}</span></label>)}{visible<rows.length&&<Button variant="ghost" onClick={()=>setVisible(value=>value+100)}>显示更多</Button>}<p className="calendar-field-note">未标明时区的时间按 {timezone} 导入。重复项自动跳过；重叠提示仅比对已加载的日程，保存时会再次检查。</p></section>}
  {file&&<details className="calendar-field-group calendar-import-mapping" open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}><summary>识别不准确？调整识别</summary><div className="calendar-import-adjustments" hidden={!advanced}>
   <label className="field">文件格式<select value={format} disabled={sourceLocked} onChange={event=>{setFormat(event.target.value);void process(file,encoding,event.target.value);}}><option value="auto">自动识别（推荐）</option><option value="xlsx">Excel 工作簿</option><option value="csv">CSV / TXT · 自动识别分隔符</option><option value="tsv">TSV · 制表符分隔表</option><option value="json">JSON · 日程数组</option><option value="ics">ICS · 日历事件</option></select></label>
   {!excel&&<label className="field">文本编码<select value={encoding} disabled={sourceLocked} onChange={event=>{setEncoding(event.target.value);void process(file,event.target.value);}}><option value="auto">自动识别（推荐）</option><option value="utf-8">UTF-8</option><option value="gb18030">GBK / GB18030</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>}
   {table&&<label className="field">表格内容<select value={contentType} disabled={sourceLocked} onChange={event=>{setContentType(event.target.value);void process(file,encoding,format,event.target.value);}}><option value="auto">自动识别日程 / 课程表</option><option value="schedule">日程明细表（日期与开始时间）</option><option value="course">课程表（星期、周次与节次）</option></select></label>}
   {table&&mapping&&<><h3>日程字段对应</h3><div className="form-grid">{(Object.keys(importFieldLabels) as ImportField[]).map(key=><label className="field" key={key}>{importFieldLabels[key]}<select value={mapping[key]} onChange={event=>remap(event,key)} disabled={sourceLocked}><option value="-1">不使用此列</option>{table[0].map((header,index)=><option value={String(index)} key={index}>{header||`第 ${index+1} 列`}</option>)}</select></label>)}</div><Button variant="outline" disabled={sourceLocked} onClick={()=>{try{preview(mapImportTable(table,mapping,timezone));setError(undefined);}catch(cause){setError(cause);}}}>更新预览</Button></>}
  </div></details>}
  </div>
 </Drawer>;
}

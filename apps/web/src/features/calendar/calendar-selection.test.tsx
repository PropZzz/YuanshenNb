import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ApiComponents } from '@/api/client';
import { CalendarPage } from './calendar-page';
import { MonthMap } from './calendar-views';
import { TimeMap } from './time-map';
import { localDate, monthDays } from '@/lib/datetime';

const item:ApiComponents['ScheduleItemDTO']={id:'selection-item',userId:'self',title:'日期选择回归',notes:'',startAt:'2027-01-31T01:00:00Z',endAt:'2027-01-31T02:00:00Z',category:'deep_work',cognitiveLoad:'medium',flexibility:'flexible',status:'planned',durationMinutes:60,reminderMinutes:10,createdAt:'2026-11-23T00:00:00Z',updatedAt:'2026-11-23T00:00:00Z'};
let cache:QueryClient;
beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn(async(request:Request)=>{const url=new URL(request.url);return new Response(JSON.stringify(url.pathname.includes('rescue/history')?{snapshots:[]}:url.pathname.includes('/schedule/items')?{items:[item]}:{localDay:'2027-01-31',score:70,dataFreshness:'baseline_only',hourlyCurve:[],focusShields:[]}),{headers:{'Content-Type':'application/json'}});}));});
afterEach(()=>{cleanup();cache?.clear();vi.unstubAllGlobals();localStorage.clear();});
function Location(){const location=useLocation(),navigate=useNavigate();return <><output aria-label='日历地址'>{location.search}</output><button onClick={()=>navigate(-1)}>测试返回</button></>;}
function mount(query:string){cache=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/calendar'+query]}><CalendarPage/><Location/></MemoryRouter></QueryClientProvider>);}

it.each(['2027-02-31','0001-01-01','9999-12-31'])('handles an unrenderable calendar date without crashing: %s',value=>{
 mount('?day='+value+'&view=week');
 expect(screen.getByLabelText('跳转日期')).toHaveProperty('value',localDate(new Date(),'Asia/Shanghai'));
});

it('restores view from the URL and preserves selection across month navigation and history',async()=>{
 mount('?day=2027-01-31&view=month');const user=userEvent.setup();
 expect(await screen.findByRole('region',{name:'月视图日程网格'})).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'下一月'}));
 expect(screen.getByLabelText('跳转日期')).toHaveProperty('value','2027-02-28');
 expect(screen.getByLabelText('日历地址').textContent).toContain('view=month');
 await user.click(screen.getByRole('button',{name:'日视图'}));
 expect(screen.getByLabelText('日历地址').textContent).toContain('view=day');
 await user.click(screen.getByRole('button',{name:'测试返回'}));
 expect(await screen.findByRole('region',{name:'月视图日程网格'})).toBeTruthy();
 expect(screen.getByLabelText('跳转日期')).toHaveProperty('value','2027-02-28');
});

it('anchors a selected event detail to its real date and keeps the current view',async()=>{
 mount('?day=2027-01-31&view=day');const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'日期选择回归 09:00至10:00'}));
 const detail=await screen.findByRole('dialog',{name:'日程详情'});
 expect(screen.getByLabelText('日历地址').textContent).toContain('day=2027-01-31');
 await user.click(within(detail).getByRole('button',{name:'编辑日程'}));
 await screen.findByLabelText('日程标题');
 expect(screen.getByLabelText('日历地址').textContent).toContain('view=day');
 expect(screen.getByLabelText('开始时间')).toHaveProperty('value','2027-01-31T09:00');
});

it('keeps the gantt scale and typed jump date in shared navigation state',async()=>{
 mount('?day=2027-01-31&view=gantt&scale=day');const user=userEvent.setup();
 expect(await screen.findByRole('region',{name:'甘特时间轴'})).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'下一天'}));
 expect(screen.getByLabelText('跳转日期')).toHaveProperty('value','2027-02-01');
 fireEvent.change(screen.getByLabelText('跳转日期'),{target:{value:'2027-03-05'}});
 expect(screen.getByLabelText('日历地址').textContent).toContain('day=2027-03-05');
 expect(screen.getByLabelText('日历地址').textContent).toContain('scale=day');
});

it('shows every selected-day event and opens the full day from a month overflow',async()=>{
 const onOpenDay=vi.fn(),items=Array.from({length:5},(_,index)=>({...item,id:'day-'+index,title:'课程 '+index}));
 render(<MonthMap selectedDay='2027-01-31' days={monthDays('2027-01-31')} items={items} timezone='Asia/Shanghai' onSelectDay={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} onOpenDay={onOpenDay}/>);
 const agenda=screen.getByRole('region',{name:'所选日期日程'});
 expect(within(agenda).getAllByRole('button',{name:/课程/})).toHaveLength(5);
 await userEvent.click(screen.getByRole('button',{name:'查看 2027-01-31 的全部 5 项日程'}));
 expect(onOpenDay).toHaveBeenCalledWith('2027-01-31');
});

it('selects 15-minute slots with the keyboard before opening a draft, without submitting',async()=>{
 const onCreate=vi.fn(),onSelectDay=vi.fn(),user=userEvent.setup();
 render(<TimeMap selectedDay='2027-01-30' days={['2027-01-30','2027-01-31']} items={[]} timezone='Asia/Shanghai' showEnergy={false} onEdit={vi.fn()} onCreate={onCreate} onSelectDay={onSelectDay}/>);
 const target=screen.getByRole('button',{name:'2027-01-30 新增日程'});target.focus();
 await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}{Enter}');
 expect(onCreate).toHaveBeenCalledWith('2027-01-31','09:30');
 expect(onCreate).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'2027-01-31 新增日程'})).toBe(document.activeElement);
});

it('projects visual ghost-timeline before/after blocks during rescue staging',()=>{
 const plan:ApiComponents['RescueOptionPlan']={
  strategy:'protect_deadline',optionHash:'hash',feasible:true,movedCount:1,deferredCount:0,recoveryMinutes:15,overdueRiskCount:0,summary:'测试救援对比',
  diffItems:[
   {op:'move',itemId:item.id,title:'日期选择回归',category:'deep_work',cognitiveLoad:'medium',flexibility:'flexible',beforeStartAt:'2027-01-31T01:00:00Z',beforeEndAt:'2027-01-31T02:00:00Z',afterStartAt:'2027-01-31T06:00:00Z',afterEndAt:'2027-01-31T07:00:00Z',reasonCode:'SHIFT',reasonLabel:'避开紧急插单'},
   {op:'create',title:'突发客户评审',category:'urgent',cognitiveLoad:'high',flexibility:'hard_locked',afterStartAt:'2027-01-31T01:00:00Z',afterEndAt:'2027-01-31T02:00:00Z',reasonCode:'URGENT',reasonLabel:'硬截止保护'},
  ],
 };
 const {container}=render(<TimeMap selectedDay='2027-01-31' days={['2027-01-31']} items={[item]} timezone='Asia/Shanghai' showEnergy={false} onEdit={vi.fn()} onCreate={vi.fn()} rescuePreview={plan}/>);
 expect(container.querySelectorAll('.map-rescue-ghost')).toHaveLength(1);
 expect(container.querySelectorAll('.map-rescue-target')).toHaveLength(2);
 expect(screen.getByText('原时段')).toBeTruthy();
 expect(screen.getByText('调整后')).toBeTruthy();
 expect(screen.getByText('突发客户评审')).toBeTruthy();
});

it('supports pointer drag-to-create and drag-to-move with 15-minute snapping',()=>{
 vi.stubGlobal('PointerEvent',class MockPointerEvent extends MouseEvent{
  pointerId:number;
  pointerType:string;
  constructor(type:string,init:PointerEventInit={}){
   super(type,init);
   this.pointerId=init.pointerId??1;
   this.pointerType=init.pointerType??'mouse';
  }
 });
 const onCreate=vi.fn(),onMoveOrResize=vi.fn();
 render(<TimeMap selectedDay='2027-01-31' days={['2027-01-31']} items={[item]} timezone='Asia/Shanghai' showEnergy={false} onEdit={vi.fn()} onCreate={onCreate} onMoveOrResize={onMoveOrResize}/>);
 const createBtn=screen.getByRole('button',{name:'2027-01-31 新增日程'});
 Object.defineProperty(createBtn,'getBoundingClientRect',{value:()=>({top:0,left:0,right:200,bottom:780,width:200,height:780})});
 fireEvent.pointerDown(createBtn,{pointerId:1,button:0,clientY:120});
 fireEvent.pointerMove(createBtn,{pointerId:1,clientY:210});
 fireEvent.pointerUp(createBtn,{pointerId:1,clientY:210});
 expect(onCreate).toHaveBeenCalledWith('2027-01-31','10:00','11:30');

 const col=createBtn.parentElement!;
 Object.defineProperty(col,'getBoundingClientRect',{value:()=>({top:0,left:0,right:200,bottom:780,width:200,height:780})});
 const eventBtn=screen.getByRole('button',{name:/日期选择回归/});
 fireEvent.pointerDown(eventBtn,{pointerId:2,button:0,clientX:40,clientY:60});
 fireEvent.pointerMove(eventBtn,{pointerId:2,clientX:40,clientY:150});
 fireEvent.pointerUp(eventBtn,{pointerId:2,clientX:40,clientY:150});
 expect(onMoveOrResize).toHaveBeenCalledWith(item,'2027-01-31T02:30:00.000Z','2027-01-31T03:30:00.000Z');
});

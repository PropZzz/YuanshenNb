import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimeMap } from './time-map';
import { defaultCalendarOptions } from './calendar-options';

beforeEach(()=>{
 vi.stubGlobal('PointerEvent',class extends MouseEvent{
  pointerId:number;pointerType:string;
  constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'mouse';}
 });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

function mount(timeRuler=true){
 const onCreate=vi.fn(),onSelectDay=vi.fn();
 const view=render(<TimeMap selectedDay="2027-01-31" days={['2027-01-30','2027-01-31']} items={[]} timezone="Asia/Shanghai" showEnergy={false} onEdit={vi.fn()} onCreate={onCreate} onSelectDay={onSelectDay} options={{...defaultCalendarOptions,timeRuler}}/>);
 const button=screen.getByRole('button',{name:'2027-01-30 新增日程'});
 Object.defineProperty(button,'getBoundingClientRect',{value:()=>({top:0,left:0,right:200,bottom:780,width:200,height:780})});
 return {...view,button,onCreate,onSelectDay};
}

it('uses an edge time hint during mouse movement without drawing or selecting a time block',()=>{
 const {container,button,onCreate,onSelectDay}=mount();
 fireEvent.pointerMove(button,{pointerType:'mouse',clientY:105});
 expect(container.querySelector('[data-slot-preview]')).toBeNull();
 expect(container.querySelector('.map-hours [data-pointer-time-hint]')?.textContent).toBe('09:45');
 fireEvent.pointerMove(button,{pointerType:'mouse',clientY:121});
 expect(container.querySelector('[data-pointer-time-hint]')?.textContent).toBe('10:00');
 expect(onCreate).not.toHaveBeenCalled();expect(onSelectDay).not.toHaveBeenCalled();
 fireEvent.pointerLeave(button);
 expect(container.querySelector('[data-pointer-time-hint]')).toBeNull();
});

it('does not show a keyboard selection frame when a mouse press focuses the grid',()=>{
 const {container,button}=mount();
 fireEvent.pointerDown(button,{pointerType:'mouse',button:0,clientY:90});
 act(()=>button.focus());
 expect(container.querySelector('[data-slot-preview]')).toBeNull();
 fireEvent.pointerCancel(button);
 expect(container.querySelector('.map-drag-create-preview')).toBeNull();
 expect(container.querySelector('[data-pointer-time-hint]')).toBeNull();
});

it('keeps keyboard time selection and clears its preview after focus leaves',()=>{
 const {container,button,onCreate}=mount();
 act(()=>button.focus());
 fireEvent.keyDown(button,{key:'ArrowDown'});
 expect(container.querySelector('[data-slot-preview]')?.textContent).toContain('09:15');
 expect(container.querySelector('[data-pointer-time-hint]')).toBeNull();
 fireEvent.click(button,{detail:0});
 expect(onCreate).toHaveBeenCalledWith('2027-01-30','09:15');
 fireEvent.blur(button);
 expect(container.querySelector('[data-slot-preview]')).toBeNull();
});

it('keeps drag-to-create feedback and provides a small hint when the ruler is hidden',()=>{
 const {container,button,onCreate}=mount(false);
 fireEvent.pointerMove(button,{pointerType:'mouse',clientY:60});
 expect(container.querySelector('.map-day[data-day="2027-01-30"] [data-pointer-time-hint]')?.textContent).toBe('09:00');
 expect(container.querySelector('[data-slot-preview]')).toBeNull();
 fireEvent.pointerDown(button,{pointerType:'mouse',button:0,clientY:60});
 fireEvent.pointerMove(button,{pointerType:'mouse',clientY:150});
 expect(container.querySelector('.map-drag-create-preview')?.textContent).toContain('09:00–10:30');
 expect(container.querySelector('[data-pointer-time-hint]')).toBeNull();
 fireEvent.pointerUp(button,{pointerType:'mouse',clientY:150});
 expect(onCreate).toHaveBeenCalledWith('2027-01-30','09:00','10:30');
});

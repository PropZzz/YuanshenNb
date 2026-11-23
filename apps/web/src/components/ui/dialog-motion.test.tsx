import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './dialog';

const originalAnimate=Object.getOwnPropertyDescriptor(Element.prototype,'animate');
afterEach(()=>{
 cleanup();vi.restoreAllMocks();
 if(originalAnimate)Object.defineProperty(Element.prototype,'animate',originalAnimate);
 else Reflect.deleteProperty(Element.prototype,'animate');
});
it('retains modal content until its exit finishes and reports completion once',async()=>{
 const finishes:(()=>void)[]=[],closed=vi.fn();
 Object.defineProperty(Element.prototype,'animate',{configurable:true,value:vi.fn(()=>({
  finished:new Promise<void>(resolve=>finishes.push(resolve)),cancel:vi.fn(),
 }))});
 const view=render(<Dialog open onOpenChange={()=>{}} onAfterClose={closed} title="原内容"><p>保存前的表单</p></Dialog>);
 await waitFor(()=>expect(finishes.length).toBeGreaterThan(0));
 await act(async()=>{finishes.splice(0).forEach(finish=>finish());});
 await waitFor(()=>expect(screen.getByRole('dialog').dataset.motionState).toBe('open'));
 expect(screen.getByRole('dialog').style.transform).toBe(''); // Layout remains CSS-owned after motion.
 view.rerender(<Dialog open={false} onOpenChange={()=>{}} onAfterClose={closed} title="已重置"><p>新内容</p></Dialog>);
 expect(screen.getByRole('dialog',{name:'原内容'}).textContent).toContain('保存前的表单');
 expect(screen.queryByText('新内容')).toBeNull();expect(closed).not.toHaveBeenCalled();
 await act(async()=>{finishes.splice(0).forEach(finish=>finish());});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(closed).toHaveBeenCalledTimes(1);
});

it('reopening an exiting modal cancels stale completion without dropping the surface',async()=>{
 const finishes:(()=>void)[]=[],closed=vi.fn();
 Object.defineProperty(Element.prototype,'animate',{configurable:true,value:vi.fn(()=>({finished:new Promise<void>(resolve=>finishes.push(resolve)),cancel:vi.fn()}))});
 const props={onOpenChange:()=>{},onAfterClose:closed,title:'连续操作',children:<input aria-label="草稿" defaultValue="保留草稿"/>};
 const view=render(<Dialog {...props} open/>);
 await act(async()=>{finishes.splice(0).forEach(finish=>finish());});
 await waitFor(()=>expect(screen.getByRole('dialog').dataset.motionState).toBe('open'));
 view.rerender(<Dialog {...props} open={false}/>);
 const outgoing=finishes.splice(0);
 view.rerender(<Dialog {...props} open/>);
 await act(async()=>{outgoing.forEach(finish=>finish());finishes.splice(0).forEach(finish=>finish());});
 await waitFor(()=>expect(screen.getByRole('dialog').dataset.motionState).toBe('open'));
 expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('保留草稿');
 expect(closed).not.toHaveBeenCalled();
});

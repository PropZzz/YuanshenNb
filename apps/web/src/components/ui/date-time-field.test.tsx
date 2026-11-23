import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeField } from "./date-time-field";
afterEach(cleanup);
it("preserves the clock when confirming a day in the reference month picker",async()=>{
 const user=userEvent.setup();render(<DateTimeField label="开始时间" defaultValue="2026-11-19T09:10"/>);
 await user.click(screen.getByRole("button",{name:"选择开始时间日期"}));
 const picker=screen.getByRole("dialog",{name:"选择日期"});
 await user.click(within(picker).getByRole("button",{name:"2026-11-25"}));
 expect((screen.getByLabelText("开始时间") as HTMLInputElement).value).toBe("2026-11-19T09:10");
 await user.click(within(picker).getByRole("button",{name:"确认日期"}));
 expect((screen.getByLabelText("开始时间") as HTMLInputElement).value).toBe("2026-11-25T09:10");
});
it("previews a reference hour/minute picker and only changes the submitted value after confirmation",async()=>{
 const user=userEvent.setup();render(<form aria-label="时间表单"><DateTimeField label="开始时间" name="startAt" defaultValue="2026-11-19T09:10"/></form>);
 await user.click(screen.getByRole("button",{name:"选择开始时间"}));
 const picker=screen.getByRole("dialog",{name:"选择开始时间"});
 await user.click(within(picker).getByRole("option",{name:"14 时"}));
 await user.click(within(picker).getByRole("option",{name:"35 分"}));
 const input=screen.getByLabelText("开始时间") as HTMLInputElement;expect(input.value).toBe("2026-11-19T09:10");
 await user.click(within(picker).getByRole("button",{name:"确认时间"}));expect(input.value).toBe("2026-11-19T14:35");
 expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("startAt")).toBe("2026-11-19T14:35");
});
it('browses years and months without changing the date until confirmation',async()=>{
 const user=userEvent.setup();render(<DateTimeField label='开始时间' defaultValue='2028-02-29T09:10'/>);
 await user.click(screen.getByRole('button',{name:'选择开始时间日期'}));
 const picker=screen.getByRole('dialog',{name:'选择日期'});
 await user.selectOptions(within(picker).getByLabelText('年份'),'2027');
 await user.click(within(picker).getByRole('button',{name:'2027-02-28'}));
 expect(screen.getByLabelText('开始时间')).toHaveProperty('value','2028-02-29T09:10');
 await user.click(within(picker).getByRole('button',{name:'确认日期'}));
 expect(screen.getByLabelText('开始时间')).toHaveProperty('value','2027-02-28T09:10');
});

it('moves date focus across months with arrows, selects with Enter and cancels without applying',async()=>{
 const user=userEvent.setup();render(<DateTimeField label='日期' type='date' defaultValue='2028-02-29'/>);
 await user.click(screen.getByRole('button',{name:'选择日期'}));
 const picker=screen.getByRole('dialog',{name:'选择日期'});
 const selected=within(picker).getByRole('button',{name:'2028-02-29'});selected.focus();
 await user.keyboard('{ArrowRight}{Enter}');
 expect(within(picker).getByLabelText('月份')).toHaveProperty('value','3');
 expect(within(picker).getByRole('button',{name:'2028-03-01'}).getAttribute('aria-pressed')).toBe('true');
 await user.keyboard('{Escape}');
 expect(screen.getByLabelText('日期')).toHaveProperty('value','2028-02-29');
 expect(screen.getByRole('button',{name:'选择日期'})).toBe(document.activeElement);
});

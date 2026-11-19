import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "./dialog";

afterEach(cleanup);
it("starts motion after a portalled initially-open drawer has mounted",async()=>{
 render(<Dialog variant="drawer" open onOpenChange={()=>{}} title="直接打开"><input aria-label="内容"/></Dialog>);
 await waitFor(()=>expect(screen.getByRole("dialog").dataset.motionState).toBe("open"));
 expect(screen.getByRole("dialog").style.transform).toBe("translate3d(0,0,0)");
});
it("renders the reference drawer surface and restores the opener after Escape", async () => {
  function Harness() { const [open,setOpen]=useState(false); return <><button onClick={()=>setOpen(true)}>偏好设置</button><Dialog open={open} onOpenChange={setOpen} title="原版抽屉" {...{variant:"drawer",width:420}}><label>名称<input /></label></Dialog></>; }
  render(<Harness/>);const user=userEvent.setup(),opener=screen.getByRole("button",{name:"偏好设置"});
  await user.click(opener);const dialog=screen.getByRole("dialog",{name:"原版抽屉"});
  expect(dialog.getAttribute("data-surface")).toBe("drawer");
  expect(dialog.style.getPropertyValue("--drawer-width")).toBe("420px");
  await user.keyboard("{Escape}");await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});
it("keeps ordinary confirmation dialogs independent from drawer presentation", () => {
 render(<Dialog open onOpenChange={()=>{}} title="确认操作"><button>确认</button></Dialog>);
 expect(screen.getByRole("dialog").getAttribute("data-surface")).toBe("modal");
});

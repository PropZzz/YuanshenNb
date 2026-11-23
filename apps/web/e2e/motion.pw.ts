import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Isolated motion fixtures: no production data and no successful write responses.
const user={id:'motion-fixture',email:'motion@example.com',displayName:'动效验收',timezone:'Asia/Shanghai',themeMode:'light',createdAt:'2026-11-23T00:00:00Z',updatedAt:'2026-11-23T00:00:00Z'};
async function prepare(page:Page){
 const writes:string[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()!=='GET'&&!url.pathname.includes('/auth/')){writes.push(url.pathname);await route.fulfill({status:503,json:{detail:'Motion fixtures never persist data'}});return;}
  let body:unknown={};
  if(url.pathname.endsWith('/auth/refresh'))body={accessToken:'motion-fixture',user};
  else if(url.pathname.endsWith('/auth/ws-ticket')){await route.fulfill({status:503,json:{detail:'No realtime connection in motion fixtures'}});return;}
  else if(url.pathname.endsWith('/auth/me'))body=user;
  else if(url.pathname.endsWith('/health'))body={ok:true,dbStatus:'up'};
  else if(url.pathname.endsWith('/schedule/items'))body={items:[]};
  else if(url.pathname.endsWith('/rescue/history'))body={snapshots:[]};
  else if(url.pathname.endsWith('/energy/today'))body={localDay:url.searchParams.get('day'),score:70,dataFreshness:'baseline_only',hourlyCurve:[],focusShields:[]};
  else if(url.pathname.endsWith('/workspaces'))body={workspaces:[]};
  await route.fulfill({json:body});
 });
 return {writes,errors};
}

test('mobile drawer follows the pointer, settles, cancels and dismisses from its current position',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Bottom-sheet gesture coverage');
 const {writes,errors}=await prepare(page);await page.goto('/calendar');
 const trigger=page.getByRole('button',{name:'设置',exact:true});await trigger.click();
 const drawer=page.getByRole('dialog',{name:'系统偏好与设置'}),handle=drawer.locator('.drawer-grab-zone');
 await expect(drawer).toHaveAttribute('data-motion-state','open');
 const top=(await drawer.boundingBox())!.y,box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+12);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+60,{steps:6});
 expect((await drawer.boundingBox())!.y-top).toBeGreaterThan(35);
 await expect(drawer).toHaveAttribute('data-motion-state','dragging');
 await page.waitForTimeout(140);await page.mouse.up();
 await expect(drawer).toHaveAttribute('data-motion-state','open');
 expect(Math.abs((await drawer.boundingBox())!.y-top)).toBeLessThan(1);
 // A stationary hold is not a flick, and pointer cancellation always settles.
 await handle.dispatchEvent('pointerdown',{pointerId:9,button:0,isPrimary:true,clientY:box.y+12});
 await handle.dispatchEvent('pointermove',{pointerId:9,clientY:box.y+100});
 await handle.dispatchEvent('pointercancel',{pointerId:9});
 await expect(drawer).toHaveAttribute('data-motion-state','open');
 expect(Math.abs((await drawer.boundingBox())!.y-top)).toBeLessThan(1);
 // Responsive edge changes cancel an active gesture instead of reusing its Y offset.
 await page.mouse.move(box.x+box.width/2,box.y+12);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+72,{steps:3});
 await page.setViewportSize({width:900,height:844});
 await expect(drawer).toHaveAttribute('data-motion-state','open');
 const desktopBounds=(await drawer.boundingBox())!;
 expect(desktopBounds.y).toBe(0);expect(desktopBounds.x+desktopBounds.width).toBe(900);
 await page.mouse.up();await page.setViewportSize({width:390,height:844});
 await expect(drawer).toHaveAttribute('data-motion-state','open');
 const finalBox=(await handle.boundingBox())!;
 await page.mouse.move(finalBox.x+finalBox.width/2,finalBox.y+12);await page.mouse.down();
 await page.mouse.move(finalBox.x+finalBox.width/2,finalBox.y+240,{steps:8});await page.mouse.up();
 await expect(drawer).toHaveCount(0);await expect(trigger).toBeFocused();
 expect(await page.locator('body').getAttribute('data-scroll-locked')).toBeNull();
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('page changes animate only content and query-only drawers leave the page still',async({page},info)=>{
 const {writes,errors}=await prepare(page);await page.goto('/calendar');
 await expect(page.getByRole('button',{name:'月视图',exact:true})).toBeVisible();
 expect(await page.locator('.route-surface').evaluate(el=>el.getAnimations().length)).toBe(0);
 expect(await page.locator('html').evaluate(el=>getComputedStyle(el).viewTransitionName)).toBe('none');
 const nav=page.getByRole('navigation',{name:info.project.name==='desktop'?'主导航':'移动端导航'});
 await nav.getByRole('link',{name:'我的',exact:true}).click();await expect(page).toHaveURL(/\/profile$/);
 await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 await page.goBack();await expect(page).toHaveURL(/\/calendar$/);
 await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveAttribute('data-motion-state','open');
 expect(await page.locator('.route-surface').evaluate(el=>el.getAnimations().length)).toBe(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'reduce'});await nav.getByRole('link',{name:'我的',exact:true}).click();
 await expect(page).toHaveURL(/\/profile$/);await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 expect(await page.locator('.route-surface').evaluate(el=>el.getAnimations().filter(a=>Number(a.effect?.getTiming().duration)>1).length)).toBe(0);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('rapid navigation keeps the latest destination and fallback handles browser history',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 const {writes,errors}=await prepare(page);await page.goto('/calendar');
 const selector=info.project.name==='desktop'?'.sidebar-navigation':'.mobile-navigation';
 await expect(page.getByRole('button',{name:'月视图',exact:true})).toBeVisible();
 await page.evaluate(selector=>{
  const link=(to:string)=>(document.querySelector(`${selector} a[href="${to}"]`) as HTMLAnchorElement).click();
  link('/profile');link('/microtasks');link('/profile');
 },selector);
 await expect(page).toHaveURL(/\/profile$/);await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 await page.evaluate(selector=>{
  (document.querySelector(`${selector} a[href="/calendar"]`) as HTMLAnchorElement).click();
  (document.querySelector(`${selector} a[href="/profile"]`) as HTMLAnchorElement).click();
 },selector);
 await page.waitForTimeout(450); // The deferred snapshot must not replay the cancelled destination.
 await expect(page).toHaveURL(/\/profile$/);
 // Exercise the non-native implementation in an independent document.
 await page.addInitScript(()=>{
  Object.defineProperty(document,'startViewTransition',{value:undefined,configurable:true});
  const animate=Element.prototype.animate;
  (window as unknown as {motionStarts:number}).motionStarts=0;
  Element.prototype.animate=function(...args:Parameters<typeof animate>){
   if(this.classList.contains('route-surface'))(window as unknown as {motionStarts:number}).motionStarts++;
   return animate.apply(this,args);
  };
 });
 await page.goto('/calendar');
 await expect(page.getByRole('button',{name:'月视图',exact:true})).toBeVisible();
 await page.locator(selector).getByRole('link',{name:'我的',exact:true}).click();
 await expect(page).toHaveURL(/\/profile$/);await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 await page.goBack();await expect(page).toHaveURL(/\/calendar$/);await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 expect(await page.evaluate(()=>(window as unknown as {motionStarts:number}).motionStarts)).toBeGreaterThanOrEqual(2);
 expect(await page.locator('.route-surface').evaluate(el=>getComputedStyle(el).willChange)).toBe('auto');
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('native page snapshots animate content once while navigation stays live',async({page},info)=>{
 const {writes,errors}=await prepare(page);
 await page.addInitScript(()=>{
  const start=document.startViewTransition.bind(document);
  document.startViewTransition=update=>{
   const transition=start(update);
   void transition.ready.then(()=>{
    const animations=document.getAnimations().filter(animation=>(animation.effect as KeyframeEffect)?.pseudoElement?.includes('view-transition'));
    animations.forEach(animation=>animation.pause());
    (window as unknown as {snapshots:string[]}).snapshots=animations.map(animation=>(animation.effect as KeyframeEffect).pseudoElement!);
   }).catch(()=>{});
   return transition;
  };
 });
 await page.goto('/calendar');
 await expect(page.getByRole('button',{name:'月视图',exact:true})).toBeVisible();
 const nav=page.getByRole('navigation',{name:info.project.name==='desktop'?'主导航':'移动端导航'});
 await nav.getByRole('link',{name:'我的',exact:true}).click();await expect(page).toHaveURL(/\/profile$/);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {snapshots:string[]}).snapshots?.length??0)).toBeGreaterThan(0);
 const snapshots=await page.evaluate(()=>(window as unknown as {snapshots:string[]}).snapshots);
 expect(snapshots.every(snapshot=>snapshot.includes('workbench-page'))).toBe(true);
 expect(snapshots.some(snapshot=>snapshot==='::view-transition-new(workbench-page)')).toBe(true);
 expect(await page.locator('.route-surface').evaluate(el=>el.getAnimations().length)).toBe(0);
 await expect(nav.getByRole('link',{name:'我的',exact:true})).toHaveAttribute('aria-current','page');
 await page.evaluate(()=>document.getAnimations().filter(animation=>(animation.effect as KeyframeEffect)?.pseudoElement?.includes('view-transition')).forEach(animation=>{animation.currentTime=Number(animation.effect!.getTiming().duration)*.5;}));
 const output=path.resolve('../../.appdata/qa/web-motion');await mkdir(output,{recursive:true});
 await page.screenshot({path:path.join(output,`${info.project.name}-page-half.png`)});
 const selected=nav.getByRole('link',{name:'我的',exact:true});
 const during=await selected.screenshot({path:path.join(output,`${info.project.name}-nav-during.png`)});
 await page.evaluate(()=>document.getAnimations().filter(animation=>(animation.effect as KeyframeEffect)?.pseudoElement?.includes('view-transition')).forEach(animation=>animation.finish()));
 await expect(page.locator('.route-surface')).toHaveAttribute('data-motion-state','open');
 const after=await selected.screenshot({path:path.join(output,`${info.project.name}-nav-after.png`)});expect(during.equals(after)).toBe(true);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('secondary handoffs retain the draft and interrupted drawers settle without stale overlays',async({page})=>{
 const {writes,errors}=await prepare(page);await page.goto('/calendar?new=1');
 let editor=page.getByRole('dialog',{name:'新增日程',exact:true});await expect(editor).toHaveAttribute('data-motion-state','open');
 const title=editor.getByLabel('日程标题',{exact:true});await title.fill('跨界面保留的草稿');
 await editor.getByRole('button',{name:/导入课表或已有日程/}).click();
 const importer=page.locator('[role="dialog"][data-drawer-edge="right"]');await expect(importer).toHaveAttribute('data-motion-state','open');
 await expect(editor).toHaveCount(0);await page.keyboard.press('Escape');
 editor=page.getByRole('dialog',{name:'新增日程',exact:true});await expect(editor).toHaveAttribute('data-motion-state','open');
 await expect(editor.getByLabel('日程标题',{exact:true})).toHaveValue('跨界面保留的草稿');
 await expect(importer).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 // Reopen before the previous opening/closing animation finishes.
 await page.evaluate(()=>{
  const button=document.querySelector('.topbar-actions button[aria-label="设置"]') as HTMLButtonElement;
  button.click();
 });
 await expect(page.getByRole('dialog')).toBeAttached();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>(document.querySelector('.topbar-actions button[aria-label="设置"]') as HTMLButtonElement).click());
 await expect(page.getByRole('dialog',{name:'系统偏好与设置'})).toHaveAttribute('data-motion-state','open');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.locator('.dialog-overlay').count()).toBe(0);
 expect(await page.locator('body').getAttribute('data-scroll-locked')).toBeNull();
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('slow-motion frames preserve opaque surfaces and symmetric entry and exit',async({page},info)=>{
 const {writes,errors}=await prepare(page);
 await page.addInitScript(()=>{
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(...args:Parameters<typeof animate>){const animation=animate.apply(this,args);animation.updatePlaybackRate(.1);return animation;};
 });
 await page.goto('/calendar');await page.getByRole('button',{name:'设置',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'系统偏好与设置'});
 await expect(panel).toHaveAttribute('data-motion-state','opening');
 const output=path.resolve('../../.appdata/qa/web-motion');await mkdir(output,{recursive:true});
 for(const progress of [.15,.5,.85]){
  await page.locator('.dialog-overlay,.dialog-content').evaluateAll((elements,progress)=>{
   elements.forEach(el=>el.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*progress;}));
  },progress);
  await page.screenshot({path:path.join(output,`${info.project.name}-enter-${progress}.png`)});
  expect(await panel.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
 }
 await page.locator('.dialog-overlay,.dialog-content').evaluateAll(elements=>elements.forEach(el=>el.getAnimations().forEach(animation=>animation.finish())));
 await expect(panel).toHaveAttribute('data-motion-state','open');
 const open=(await panel.boundingBox())!;await page.keyboard.press('Escape');
 await expect(panel).toHaveAttribute('data-motion-state','closing');
 await page.locator('.dialog-overlay,.dialog-content').evaluateAll(elements=>elements.forEach(el=>el.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*.5;})));
 const closing=(await panel.boundingBox())!;
 if(info.project.name==='mobile'){expect(closing.y).toBeGreaterThan(open.y);expect(closing.x).toBe(open.x);}
 else{expect(closing.x).toBeGreaterThan(open.x);expect(closing.y).toBe(open.y);}
 await page.screenshot({path:path.join(output,`${info.project.name}-exit-half.png`)});
 await page.emulateMedia({reducedMotion:'reduce'});await expect(panel).toHaveCount(0);
 expect(await page.locator('.dialog-overlay').count()).toBe(0);expect(writes).toEqual([]);expect(errors).toEqual([]);
});

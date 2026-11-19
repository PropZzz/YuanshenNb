import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@/components/ui/reference-icons";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
export interface DialogProps { open:boolean;onOpenChange:(open:boolean)=>void;title:string;description?:string;children:ReactNode;wide?:boolean;variant?:"modal"|"drawer";width?:number;className?:string;footer?:ReactNode;edge?:"responsive"|"right";onAfterClose?:()=>void; }

export function Dialog({ open,onOpenChange,title,description,children,wide=false,variant="modal",width=480,className,footer,edge="responsive",onAfterClose }:DialogProps) {
  const drawer=variant==="drawer",[present,setPresent]=useState(open);
  const [panel,setPanel]=useState<HTMLDivElement|null>(null),[scrim,setScrim]=useState<HTMLDivElement|null>(null),lastPanel=useRef<HTMLElement|null>(null);
  const animations=useRef(new Map<HTMLElement,Animation>()),generation=useRef(0),opener=useRef<HTMLElement|null>(open&&typeof document!=="undefined"?document.activeElement as HTMLElement:null),touchStart=useRef<number|null>(null);
  const closeCallback=useRef(onAfterClose);closeCallback.current=onAfterClose;
  const [motionRevision,setMotionRevision]=useState(0);
  useEffect(()=>{
    if(typeof window.matchMedia!=="function")return;
    const queries=[window.matchMedia("(max-width: 780px)"),window.matchMedia("(prefers-reduced-motion: reduce)")],change=()=>setMotionRevision(value=>value+1);
    queries.forEach(query=>query.addEventListener?.("change",change));return()=>queries.forEach(query=>query.removeEventListener?.("change",change));
  },[]);
  useLayoutEffect(()=>{
    if(!drawer)return;
    if(open&&!present){opener.current=document.activeElement as HTMLElement;setPresent(true);return;}
    if(!present||!panel||!scrim)return;
    const content=panel,overlay=scrim,turn=++generation.current;
    for(const [node,animation] of animations.current){const property=node===content?"transform":"opacity";const frozen=getComputedStyle(node)[property];animation.cancel();node.style[property]=frozen;node.style.removeProperty("will-change");}animations.current.clear();
    const vertical=edge!=="right"&&(typeof window.matchMedia==="function"?window.matchMedia("(max-width: 780px)").matches:window.innerWidth<=780);
    const closed=vertical?"translate3d(0,100%,0)":"translate3d(100%,0,0)";
    if(lastPanel.current!==content){lastPanel.current=content;content.style.transform=closed;overlay.style.opacity="0";}
    const reduced=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transform=getComputedStyle(content).transform;
    let progress=1;
    if(typeof DOMMatrixReadOnly!=="undefined"){const matrix=new DOMMatrixReadOnly(transform);const distance=vertical?content.getBoundingClientRect().height:content.getBoundingClientRect().width;progress=Math.min(1,Math.max(0,Math.abs(vertical?matrix.m42:matrix.m41)/(distance||1)));}
    const remaining=open?progress:1-progress,duration=Math.max(80,(open?300:220)*remaining),jobs:Promise<unknown>[]=[];
    for(const [node,property,end] of [[content,"transform",open?"translate3d(0,0,0)":closed],[overlay,"opacity",open?"1":"0"]] as const){
      const start=getComputedStyle(node)[property];node.style[property]=end;
      if(reduced||remaining<.001||typeof node.animate!=="function")continue;
      node.style.willChange=property;const animation=node.animate([{[property]:start},{[property]:end}],{duration,easing:open?"cubic-bezier(.22,1,.36,1)":"cubic-bezier(.4,0,1,1)",fill:"both"});animations.current.set(node,animation);jobs.push(animation.finished.catch(()=>{}));
    }
    void Promise.all(jobs).then(()=>{if(turn!==generation.current)return;for(const [node,animation] of animations.current){animation.cancel();node.style.removeProperty("will-change");}animations.current.clear();content.dataset.motionState=open?"open":"closed";if(!open){setPresent(false);lastPanel.current=null;closeCallback.current?.();}});
    content.dataset.motionState=open?"opening":"closing";
  },[open,present,drawer,panel,scrim,edge,motionRevision]);
  useLayoutEffect(()=>()=>{generation.current++;for(const animation of animations.current.values())animation.cancel();animations.current.clear();},[]);
  const visible=drawer?present:open;
  return <DialogPrimitive.Root open={visible} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay ref={setScrim} className={cn("dialog-overlay",drawer&&"drawer-overlay")} /><DialogPrimitive.Content ref={setPanel} data-surface={variant} data-drawer-edge={edge} className={cn("dialog-content",wide&&"dialog-wide",drawer&&"drawer-content",className)} style={drawer?{"--drawer-width":`${width}px`} as CSSProperties:undefined} onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus({preventScroll:true});opener.current=null;}}}>
    {drawer&&edge!=="right"&&<div className="drawer-grab-zone" onPointerDown={event=>{touchStart.current=event.clientY;event.currentTarget.setPointerCapture?.(event.pointerId);}} onPointerCancel={()=>{touchStart.current=null;}} onPointerUp={event=>{if(touchStart.current!==null&&event.clientY-touchStart.current>72)onOpenChange(false);touchStart.current=null;}}><span/></div>}
    <header className="dialog-header"><div><DialogPrimitive.Title className="font-headline text-xl font-bold text-primary">{title}</DialogPrimitive.Title>{description&&<DialogPrimitive.Description className="dialog-description">{description}</DialogPrimitive.Description>}{!description&&<DialogPrimitive.Description className="sr-only">{title}表单与操作</DialogPrimitive.Description>}</div><DialogPrimitive.Close className={cn("button button-ghost button-icon shrink-0",drawer&&"drawer-close")} aria-label="关闭"><X size={19}/></DialogPrimitive.Close></header><div className="dialog-body">{children}</div>{footer&&<footer className="dialog-footer">{footer}</footer>}
  </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}


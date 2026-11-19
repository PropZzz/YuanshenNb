import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiComponents } from "@/api/client";
import { unwrap } from "@/api/unwrap";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { InlineError, Notice } from "@/components/ui/states";
import { privacyLabels } from "./queries";

export function WorkspaceDialog({mode,open=true,onClose,onJoined}:{open?:boolean;mode:"create"|"join";onClose:()=>void;onJoined:(id:string)=>void}) {
 const cache=useQueryClient(),[validation,setValidation]=useState<unknown>(null);
 const mutation=useMutation({mutationFn:async (form:FormData)=>{
   const privacyLevel=form.get("privacy") as ApiComponents["PrivacyLevel"];
   return mode==="create"?unwrap(await apiClient.POST("/api/v1/workspaces",{body:{name:String(form.get("name")).trim(),description:String(form.get("description")??"").trim(),privacyLevel}})):unwrap(await apiClient.POST("/api/v1/workspaces/join",{body:{inviteCode:String(form.get("inviteCode")).trim(),privacyLevel}}));
 },onSuccess:async workspace=>{await cache.invalidateQueries({queryKey:queryKeys.workspaces.all});onJoined(workspace.id);onClose();}});
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setValidation(null);try{mutation.mutate(new FormData(e.currentTarget));}catch(error){setValidation(error);}}
 return <Drawer open={open} onOpenChange={open=>{if(!open&&!mutation.isPending)onClose();}} title={mode==="create"?"创建工作区":"加入工作区"} description="共享范围由你决定，原始生理数据始终只对本人可见。" width={480} className="team-workspace-drawer"><form onSubmit={submit} className="form-stack">
  {mode==="create"?<><label className="field">工作区名称<input name="name" required maxLength={64} placeholder="例如：产品研发协作组" autoFocus/></label><label className="field">工作区说明<textarea name="description" placeholder="这个团队将一起完成什么？"/></label></>:<label className="field">工作区邀请码<input name="inviteCode" required autoFocus autoComplete="off" placeholder="输入成员分享给你的邀请码"/></label>}
  <label className="field">我的共享范围<select name="privacy" defaultValue="busy_only">{Object.entries(privacyLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
  <Notice>默认只共享忙闲。你可以在“账号与隐私”中随时调整授权。</Notice><InlineError error={validation??mutation.error}/><div className="form-actions"><Button variant="outline" onClick={onClose} disabled={mutation.isPending}>取消</Button><Button type="submit" variant="secondary" pending={mutation.isPending}>{mode==="create"?"确认创建工作区":"确认加入工作区"}</Button></div>
 </form></Drawer>;
}

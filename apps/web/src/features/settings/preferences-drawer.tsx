import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiComponents } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { InlineError } from "@/components/ui/states";
import { applyThemeToDom, useAuthStore } from "@/stores/auth-store";
import "./preferences.css";

const themes: { value: ApiComponents["ThemeMode"]; title: string; icon: string }[] = [
  { value: "system", title: "跟随系统", icon: "desktop_windows" },
  { value: "light", title: "浅色模式", icon: "light_mode" },
  { value: "dark", title: "深色模式", icon: "dark_mode" },
];
const swatches = [{ name: "深青色 #163d3d", color: "#163d3d" }, { name: "经典时间地图青绿 #83AFA5", color: "#81a8a7" }, { name: "截止橙 #E5A15B", color: "#e5a15b" }, { name: "沉静石墨灰 #414848", color: "#414848" }, { name: "工作台动力蓝 #005db5", color: "#005db5" }];
function Symbol({ children }: { children: string }) { return <span className="material-symbols-outlined" aria-hidden="true">{children}</span>; }
function UnavailableSwitch({ title, description }: { title: string; description: string }) {
  return <div className="preference-switch-row"><div><strong>{title}</strong><p>{description}</p></div><label className="preference-switch" title="当前服务器未提供此设置的保存接口"><input type="checkbox" aria-label={title} disabled /><span /></label></div>;
}

export function PreferencesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuthStore(state => state.user), savedTheme = useAuthStore(state => state.themeMode), cache = useQueryClient();
  const [draft, setDraft] = useState(savedTheme);
  useEffect(() => {
    if (!open) return;
    setDraft(useAuthStore.getState().themeMode);
    return () => applyThemeToDom(useAuthStore.getState().themeMode);
  }, [open, user?.id]);
  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("请登录后保存账户外观");
      return unwrap(await apiClient.PATCH("/api/v1/auth/me", { body: { themeMode: draft } }));
    },
    onSuccess: updated => {
      const auth = useAuthStore.getState();
      if (auth.accessToken && auth.user?.id === updated.id) {
        auth.setSession(auth.accessToken, updated);
        cache.setQueryData(queryKeys.auth.me, updated);
      }
      onClose();
    },
  });
  function preview(theme: ApiComponents["ThemeMode"]) { setDraft(theme); save.reset(); applyThemeToDom(theme); }
  function close() { if (save.isPending) return; applyThemeToDom(useAuthStore.getState().themeMode); save.reset(); onClose(); }
  return <Drawer open={open} onOpenChange={next => { if (!next) close(); }} width={420} className="preferences-drawer" title="系统偏好与设置" description="个性化您的工作台外观、语言与系统偏好" footer={<div className="preferences-footer"><Button variant="ghost" disabled={save.isPending} onClick={() => preview("system")}>恢复默认设置</Button><Button variant="secondary" pending={save.isPending} onClick={() => save.mutate()}>保存并应用配置</Button></div>}>
    <div className="preferences-sections">
      <section><h3><Symbol>translate</Symbol>语言与国际化</h3><div className="preference-segment preference-languages"><button type="button" className="selected" disabled><Symbol>check</Symbol>简体中文 (当前)</button><button type="button" disabled aria-label="English" title="当前账户API未提供语言偏好保存">English</button></div><p className="preference-unavailable">语言切换暂未接入账户保存接口。</p></section>
      <section><div className="preference-section-line"><h3><Symbol>notifications_active</Symbol>系统通知与外部提醒</h3><span className="preference-reserved">预留能力</span></div><div className="preference-box"><UnavailableSwitch title="桌面系统推送通知" description="任务即将超时或缓冲即将耗尽时弹出" /><UnavailableSwitch title="浏览器 Web Push 静默同步" description="在后台接收工作台的更新与提醒" /><p className="preference-note"><Symbol>info</Symbol>通知推送尚未接入保存接口，当前不会发送外部提醒。</p></div></section>
      <section><h3><Symbol>palette</Symbol>外观模式与强调色</h3><div className="preference-segment preference-themes" aria-label="外观模式">{themes.map(theme => <button type="button" key={theme.value} className={draft === theme.value ? "selected" : ""} aria-label={theme.title} aria-pressed={draft === theme.value} disabled={save.isPending} onClick={() => preview(theme.value)}><Symbol>{theme.icon}</Symbol>{theme.title}</button>)}</div><div className="preference-palette-label"><span>强调主题色板</span><strong>深青色 (Deep Forest Teal)</strong></div><div className="preference-swatches">{swatches.map((swatch, index) => <button type="button" key={swatch.name} aria-label={swatch.name} title={`${swatch.name} · 当前服务器未提供保存接口`} disabled className={index === 0 ? "selected" : ""} style={{ backgroundColor: swatch.color }}>{index === 0 && <Symbol>check</Symbol>}</button>)}</div><p className="preference-unavailable">主题可预览并保存；强调色暂未提供账户保存接口。</p></section>
      <section><h3><Symbol>instant_mix</Symbol>时序引擎行为偏好</h3><div className="preference-box"><UnavailableSwitch title="开启紧急任务自动三方案推演" description="遭遇冲突事件时，预计算可比较的缓冲转移方案" /><div className="preference-locked"><div><strong>重排前显示代价比较确认</strong><span>严禁静默覆盖</span><p>任何时间表重排均须人工审视确认</p></div><Symbol>lock</Symbol></div><UnavailableSwitch title="日程写入自动创建撤销快照" description="每次重编排保存快照，支持安全回滚" /><p className="preference-unavailable">以上开关暂不可配置。方案比较、明确确认与救援快照由现有服务端规则执行。</p></div></section>
      <InlineError error={save.error} />
    </div>
  </Drawer>;
}

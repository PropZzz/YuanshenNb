import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Braces, CalendarDays, ClipboardList, FileText, Network, LockKeyhole, Mail, MessageSquare, Save, Server, ShieldCheck, WandSparkles } from "@/components/ui/reference-icons";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { unwrap } from "@/api/unwrap";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { CapabilityNote, EmptyBlock, LegacyHeader, LocalBadge, SectionHeading, SystemNav } from "./legacy-shared";
import { useLocalWorkspace } from "./local-data";
import { useAuthStore } from "@/stores/auth-store";

const sources = [
  { id: "outlook", label: "Outlook 邀请", detail: "跨团队评审会议", icon: Mail, placeholder: "粘贴你收到的邮件邀请原文…" },
  { id: "chat", label: "飞书 / Slack", detail: "协同沟通文本", icon: MessageSquare, placeholder: "粘贴需要整理的协同消息…" },
  { id: "ics", label: "ICS 原生", detail: "iCalendar 文本", icon: Braces, placeholder: "粘贴你自己的 iCalendar 文本以保存草稿；ICS 文件请使用日历导入入口…" },
  { id: "note", label: "即时随笔", detail: "自然语言碎片", icon: FileText, placeholder: "写下你想整理的事情…" },
];
export function IntegrationsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const identity = useAuthStore(state => state.user?.id ?? "anonymous");
  return <IntegrationsWorkspace key={identity} embedded={embedded} />;
}
function IntegrationsWorkspace({ embedded }: { embedded: boolean }) {
  const workspace = useLocalWorkspace(), navigate = useNavigate();
  const [source, setSource] = useState("outlook"), [raw, setRaw] = useState(workspace.data.drafts.integration ?? ""), [notice, setNotice] = useState("");
  const health = useQuery({ queryKey: queryKeys.system.health, queryFn: async () => unwrap(await apiClient.GET("/api/v1/health")), staleTime: 30_000 });
  function save() { if (workspace.update(current => ({ ...current, drafts: { ...current.drafts, integration: raw } }))) setNotice("草稿已保存 · 仅本机，尚未解析或导入日历"); }
  return <div className={`legacy-page legacy-integrations${embedded ? " legacy-integrations-embedded" : ""}`}>{!embedded && <><SystemNav /><LegacyHeader eyebrow="MCP Protocol / 接入与诊断子系统" title="MCP 外部文本接入与日程智能解析" subtitle="集中整理外部邮件、协同聊天与 ICS 原文；当前文本只作为本机草稿保存。" actions={<span className="legacy-badge"><Network size={14} />协议解析尚未接入</span>} /></>}
    <div className="legacy-integration-grid"><section className="legacy-card legacy-payload"><SectionHeading icon={WandSparkles} title="外部信源类型" detail="选择输入格式" /><div className="legacy-source-options">{sources.map(({ id, label, detail, icon: Icon }) => <button key={id} aria-pressed={source === id} onClick={() => setSource(id)}><Icon size={20} /><span><strong>{label}</strong><small>{detail}</small></span></button>)}</div><div className="legacy-payload-heading"><span><Braces size={15} />外部非结构化上下文（Raw Payload）</span><LocalBadge /></div><label className="sr-only" htmlFor="integration-payload">导入日历或协同消息</label><textarea id="integration-payload" className="legacy-payload-editor" value={raw} onChange={event => { setRaw(event.target.value); setNotice(""); }} placeholder={sources.find(option => option.id === source)?.placeholder} spellCheck={false} /><div className="legacy-payload-meta"><span>{raw.length} 字符 · {sources.find(option => option.id === source)?.label}</span><Button size="sm" variant="ghost" onClick={() => { setRaw(""); setNotice("输入已清空，已保存的草稿仍保留，点击保存后更新。"); }}>清空</Button></div><CapabilityNote>自动解析服务尚未接入。不会上传这段原文，也不会在前端生成日程、冲突分析或模型置信度。</CapabilityNote><div className="legacy-actions"><Button onClick={save}><Save size={15} />保存本机草稿</Button><Button disabled><WandSparkles size={15} />智能解析（未接入）</Button></div><InlineError error={workspace.error} />{notice && <p className="notice" role="status">{notice}</p>}<div className="legacy-console-line"><span>Protocol Session</span><code>未建立 MCP 会话</code></div></section>
      <section className="legacy-preview-card"><div className="legacy-preview-heading"><ClipboardList size={21} /><h2>解析结果结构化预览</h2></div><div className="legacy-card"><EmptyBlock title="等待可验证的解析结果" description="当前没有可用的文本解析接口。此处不会展示预填邀请、冲突报告或导入成功状态。" /><div className="legacy-preview-fields"><div><small>提取日程标题</small><strong>—</strong></div><div><small>识别时段</small><strong>—</strong></div><div><small>优先级与会议属性</small><strong>—</strong></div><div><small>认知负荷预估</small><strong>未接入</strong></div></div><div className="legacy-preview-warning"><ShieldCheck size={18} /><div><h3>时空重叠校验</h3><p>只有明确的日程时间和服务端校验结果，才能判断是否冲突。</p></div></div><div className="legacy-stack"><Link className="button button-secondary" to="/calendar-import"><CalendarDays size={16} />使用 ICS 文件导入</Link><Button variant="outline" disabled={!raw.trim()} onClick={() => { if (workspace.update(current => ({ ...current, drafts: { ...current.drafts, microtask: raw } }))) navigate("/microtask-entry"); }}>手动录入为微任务<ArrowRight size={15} /></Button></div></div></section></div>
    <section><SectionHeading icon={Server} title="外部接入协议与服务状态" detail="真实状态 / 预留能力" /><div className="legacy-gateway-grid"><article className="legacy-card"><span className="legacy-gateway-icon"><Server size={22} /></span><h3>时序服务 API</h3><p>使用现有健康检查契约核对服务端与数据库连接，不推断 MCP 是否注册。</p><span className="legacy-badge">{health.isPending ? "正在检查" : health.isError ? "暂不可用" : health.data.ok && health.data.dbStatus === "up" ? "健康检查通过" : "服务报告异常"}</span>{health.data && !health.isError && <small>服务版本：{health.data.version}</small>}<InlineError error={health.error} /></article><article className="legacy-card"><span className="legacy-gateway-icon"><CalendarDays size={22} /></span><h3>Calendar ICS 导入</h3><p>通过文件导入入口选择你自己的日历文件；在确认预览后才能写入日程。</p><Link className="legacy-text-link" to="/calendar-import">打开导入入口<ArrowRight size={14} /></Link></article><article className="legacy-card"><span className="legacy-gateway-icon"><LockKeyhole size={22} /></span><h3>Slack / MCP Gateway</h3><p>待接入 · 预留。当前没有凭据配置或会话契约，不会轮询、保存令牌或声称已同步。</p><span className="legacy-badge">离线等待服务接入</span><Button variant="outline" disabled size="sm">配置凭据（未接入）</Button></article></div></section>
  </div>;
}

import { AlertCircle, ArrowRight, Inbox, LoaderCircle, type LucideIcon } from "@/components/ui/reference-icons";
import { Link } from "react-router-dom";
import { errorMessage } from "@/api/unwrap";
import { Button } from "./button";
export function LoadingState({ label = "正在读取你的数据" }: { label?: string }) { return <div role="status" className="state-panel"><LoaderCircle className="size-5 animate-spin text-secondary" /><p>{label}</p><div className="skeleton-lines"><i /><i /><i /></div></div>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) { return <div role="alert" className="state-panel state-error"><AlertCircle className="size-6" /><h3>暂时无法读取数据</h3><p>{errorMessage(error)}</p>{retry && <Button variant="outline" onClick={retry}>重新加载</Button>}</div>; }
export function EmptyState({ title, description, action, to, icon: Icon = Inbox, onAction }: { title: string; description: string; action?: string; to?: string; icon?: LucideIcon; onAction?: () => void }) { return <div className="state-panel"><span className="empty-icon"><Icon size={27} /></span><h3 className="font-semibold text-on-surface">{title}</h3><p>{description}</p>{action && (to ? <Link to={to} className="button button-secondary">{action}<ArrowRight size={15} /></Link> : <Button variant="secondary" onClick={onAction}>{action}<ArrowRight size={15} /></Button>)}</div>; }
export function InlineError({ error }: { error: unknown }) { return error ? <div role="alert" className="inline-error"><AlertCircle size={16} className="shrink-0" />{errorMessage(error)}</div> : null; }
export function Notice({ children }: { children: React.ReactNode }) { return <p role="status" className="notice"><span className="status-dot" />{children}</p>; }


import type { ReactNode } from "react";
import { HardDrive, Info, type LucideIcon } from "@/components/ui/reference-icons";
import { Link } from "react-router-dom";
import "./legacy.css";

export function LegacyHeader({ eyebrow, title, titleSuffix, subtitle, actions, children }: { eyebrow: string; title: string; titleSuffix?: string; subtitle?: string; actions?: ReactNode; children?: ReactNode }) {
  return <header className="legacy-page-heading"><div><p className="legacy-eyebrow">{eyebrow}</p><h1>{title}{titleSuffix && <span className="legacy-title-suffix">{titleSuffix}</span>}</h1>{subtitle && <p className="legacy-subtitle">{subtitle}</p>}{children}</div>{actions && <div className="legacy-actions">{actions}</div>}</header>;
}
export function LocalBadge() { return <span className="legacy-badge"><HardDrive size={12} />仅本机</span>; }
export function CapabilityNote({ children }: { children: ReactNode }) { return <div className="legacy-capability"><Info size={16} /><p>{children}</p></div>; }
export function SectionHeading({ icon: Icon, title, detail, children }: { icon?: LucideIcon; title: string; detail?: string; children?: ReactNode }) { return <div className="legacy-section-heading"><div>{Icon && <Icon size={18} />}<h2>{title}</h2>{detail && <span className="legacy-muted">{detail}</span>}</div>{children}</div>; }
export function Metric({ label, value, unit, detail, icon: Icon }: { label: string; value: ReactNode; unit?: string; detail?: string; icon?: LucideIcon }) { return <article className="legacy-metric"><p>{label}{Icon && <Icon size={17} />}</p><div><strong>{value}</strong>{unit && <span>{unit}</span>}</div>{detail && <small>{detail}</small>}</article>; }
export function EmptyBlock({ title, description, children }: { title: string; description: string; children?: ReactNode }) { return <div className="legacy-empty"><span className="legacy-empty-mark">＋</span><h3>{title}</h3><p>{description}</p>{children}</div>; }
export function SystemNav() { return <nav className="legacy-system-nav" aria-label="接入与诊断子页面"><Link to="/diagnostics">系统诊断</Link><Link to="/integrations">外部文本接入</Link><Link to="/bluetooth">蓝牙设备管理</Link></nav>; }

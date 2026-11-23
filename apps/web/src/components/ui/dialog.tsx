import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@/components/ui/reference-icons';
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useDialogMotion } from './use-dialog-motion';

export interface DialogProps {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string;
  children: ReactNode; wide?: boolean; variant?: 'modal' | 'drawer'; width?: number;
  className?: string; footer?: ReactNode; edge?: 'responsive' | 'right'; onAfterClose?: () => void;
}

export function Dialog({ open, onOpenChange, title, description, children, wide = false, variant = 'modal', width = 480, className, footer, edge = 'responsive', onAfterClose }: DialogProps) {
  const drawer = variant === 'drawer';
  const opener = useRef<HTMLElement | null>(open && typeof document !== 'undefined' ? document.activeElement as HTMLElement : null);
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement;
    wasOpen.current = open;
  }, [open]);
  const { present, setPanel, setScrim, dragHandlers } = useDialogMotion({ open, drawer, edge, onOpenChange, onAfterClose });
  const retained = useRef({ title, description, children, footer });
  if (open) retained.current = { title, description, children, footer };
  const content = open ? { title, description, children, footer } : retained.current;

  return <DialogPrimitive.Root open={present} onOpenChange={next => { if (open || next) onOpenChange(next); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay ref={setScrim} className={cn('dialog-overlay', drawer && 'drawer-overlay')} />
      <DialogPrimitive.Content ref={setPanel} data-surface={variant} data-drawer-edge={edge}
        className={cn('dialog-content', wide && 'dialog-wide', drawer && 'drawer-content', className)}
        style={drawer ? { '--drawer-width': `${width}px` } as CSSProperties : undefined}
        onCloseAutoFocus={event => {
          if (document.querySelector('[role="dialog"]:not([data-motion-state="closing"]):not([data-motion-state="closed"])')) { event.preventDefault(); return; }
          if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); opener.current = null; }
        }}>
        {drawer && edge !== 'right' && <div className="drawer-grab-zone" {...dragHandlers}><span /></div>}
        <header className="dialog-header"><div>
          <DialogPrimitive.Title className="font-headline text-xl font-bold text-primary">{content.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className={content.description ? 'dialog-description' : 'sr-only'}>{content.description || `${content.title}表单与操作`}</DialogPrimitive.Description>
        </div><DialogPrimitive.Close className={cn('button button-ghost button-icon shrink-0', drawer && 'drawer-close')} aria-label="关闭"><X size={19} /></DialogPrimitive.Close></header>
        <div className="dialog-body">{content.children}</div>
        {content.footer && <footer className="dialog-footer">{content.footer}</footer>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

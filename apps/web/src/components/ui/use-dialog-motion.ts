import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

type Property = 'transform' | 'opacity';
type Job = { animation: Animation; properties: Property[] };
type Gesture = { pointer: number; start: number; offset: number; position: number; height: number; samples: { y: number; time: number }[] };
const clamp = (value: number, max = 1) => Math.min(max, Math.max(0, value));
const mobile = () => window.matchMedia?.('(max-width: 780px)').matches ?? window.innerWidth <= 780;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useDialogMotion({ open, drawer, edge, onOpenChange, onAfterClose }: {
  open: boolean; drawer: boolean; edge: 'responsive' | 'right';
  onOpenChange: (open: boolean) => void; onAfterClose?: () => void;
}) {
  const [present, setPresent] = useState(open);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [scrim, setScrim] = useState<HTMLDivElement | null>(null);
  const [revision, revise] = useState(0);
  const jobs = useRef(new Map<HTMLElement, Job>()), generation = useRef(0);
  const initialized = useRef<HTMLElement | null>(null), base = useRef('');
  const axis = useRef(false), gesture = useRef<Gesture | null>(null);
  const release = useRef<{ offset: number; velocity: number; height: number } | null>(null);
  const afterClose = useRef(onAfterClose); afterClose.current = onAfterClose;

  function freeze() {
    generation.current++;
    for (const [node, job] of jobs.current) {
      const style = getComputedStyle(node);
      const values = job.properties.map(property => [property, style[property]] as const);
      job.animation.cancel();
      values.forEach(([property, value]) => { node.style[property] = value; });
      node.style.removeProperty('will-change');
    }
    jobs.current.clear();
  }

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const queries = [window.matchMedia('(max-width: 780px)'), window.matchMedia('(max-width: 779px)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const change = () => { gesture.current = null; release.current = null; revise(value => value + 1); };
    queries.forEach(query => query.addEventListener?.('change', change));
    return () => queries.forEach(query => query.removeEventListener?.('change', change));
  }, []);

  useLayoutEffect(() => {
    if (open && !present) { setPresent(true); return; }
    if (!present || !panel || !scrim) return;
    freeze(); gesture.current = null;
    const turn = generation.current, vertical = mobile() && edge !== 'right';
    const closed = vertical ? 'translate3d(0,100%,0)' : 'translate3d(100%,0,0)';
    if (!drawer) {
      const live = getComputedStyle(panel).transform;
      panel.style.removeProperty('transform');
      base.current = getComputedStyle(panel).transform.replace(/^none$/, '');
      panel.style.transform = live;
    }
    if (initialized.current !== panel) {
      initialized.current = panel;
      if (drawer) base.current = 'translate3d(0,0,0)';
      panel.style.transform = drawer ? closed : `${base.current} translate3d(0,8px,0) scale(.98)`;
      panel.style.opacity = drawer ? '1' : '0'; scrim.style.opacity = '0';
    } else if (drawer && axis.current !== vertical) {
      // Never reuse an offset from the other axis after a responsive edge change.
      panel.style.transform = open ? base.current : closed; scrim.style.opacity = open ? '1' : '0';
    }
    axis.current = vertical;
    const settled = release.current; release.current = null;
    const opacity = Number(getComputedStyle(drawer ? scrim : panel).opacity);
    const remaining = open ? 1 - opacity : opacity;
    const duration = settled && open ? 360 : Math.max(80, (drawer ? open ? 300 : 220 : open ? 180 : 160) * remaining);
    let easing = settled && open ? 'linear' : open ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.4,0,1,1)';
    if (settled && !open && drawer && vertical) {
      const slope = settled.velocity * duration / Math.max(1, settled.height - settled.offset);
      easing = `cubic-bezier(.25,${Math.max(-.2, Math.min(1, slope * .25))},.7,1)`;
    }
    const promises: Promise<unknown>[] = [];
    const endTransform = open ? base.current || 'none' : drawer ? closed : `${base.current} translate3d(0,8px,0) scale(.98)`;
    const spring = settled && settled.offset > .1 && open && vertical && drawer ? Array.from({ length: 25 }, (_, index) => {
      const time = index / 24 * .36;
      // Critically damped return, inheriting the finger's release velocity (px/s).
      const offset = index === 24 ? 0 : clamp((settled.offset + (settled.velocity * 1000 + 28 * settled.offset) * time) * Math.exp(-28 * time), settled.height);
      return { transform: `translate3d(0,${offset}px,0)`, opacity: String(1 - offset / settled.height), offset: index / 24 };
    }) : null;
    const animate = (node: HTMLElement, properties: Property[], ends: Record<string, string>) => {
      const start = Object.fromEntries(properties.map(property => [property, getComputedStyle(node)[property]]));
      properties.forEach(property => { node.style[property] = ends[property]; });
      if (reducedMotion() || (!spring && remaining < .001) || typeof node.animate !== 'function') { node.style.removeProperty('will-change'); return; }
      const end = Object.fromEntries(properties.map(property => [property, ends[property]]));
      const frames: Keyframe[] = spring ? spring.map(frame => node === panel
        ? { transform: frame.transform, offset: frame.offset }
        : { opacity: frame.opacity, offset: frame.offset }) : [start, end];
      node.style.willChange = properties.join(',');
      const animation = node.animate(frames, { duration, easing, fill: 'both' });
      jobs.current.set(node, { animation, properties }); promises.push(animation.finished.catch(() => {}));
    };
    panel.dataset.motionState = scrim.dataset.motionState = open ? 'opening' : 'closing';
    animate(panel, drawer ? ['transform'] : ['transform', 'opacity'], { transform: endTransform, opacity: open ? '1' : '0' });
    animate(scrim, ['opacity'], { opacity: open ? '1' : '0' });
    void Promise.all(promises).then(() => {
      if (turn !== generation.current) return;
      for (const [node, job] of jobs.current) { job.animation.cancel(); node.style.removeProperty('will-change'); }
      jobs.current.clear(); panel.dataset.motionState = scrim.dataset.motionState = open ? 'open' : 'closed';
      if (open && !drawer) panel.style.removeProperty('transform');
      if (!open) { setPresent(false); initialized.current = null; afterClose.current?.(); }
    });
  }, [open, present, panel, scrim, drawer, edge, revision]);

  useLayoutEffect(() => () => {
    generation.current++; gesture.current = null;
    for (const job of jobs.current.values()) job.animation.cancel();
    jobs.current.clear();
  }, []);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!open || !drawer || edge === 'right' || !mobile() || event.button !== 0 || !panel || !scrim) return;
    freeze(); release.current = null;
    const transform = getComputedStyle(panel).transform;
    const offset = typeof DOMMatrixReadOnly === 'function' ? new DOMMatrixReadOnly(transform).m42 : 0;
    gesture.current = { pointer: event.pointerId, start: event.clientY, offset, position: offset, height: panel.getBoundingClientRect().height || 1, samples: [{ y: event.clientY, time: event.timeStamp }] };
    // Embedded browsers can lose the active pointer before capture is requested.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Release still settles safely. */ }
    panel.dataset.motionState = scrim.dataset.motionState = 'dragging';
    panel.style.willChange = 'transform'; scrim.style.willChange = 'opacity';
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId || !panel || !scrim) return;
    const offset = clamp(active.offset + event.clientY - active.start, active.height);
    active.position = offset;
    panel.style.transform = `translate3d(0,${offset}px,0)`; scrim.style.opacity = String(1 - offset / active.height);
    active.samples = [...active.samples.filter(sample => event.timeStamp - sample.time < 100), { y: event.clientY, time: event.timeStamp }];
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    const offset = active.position;
    const samples = active.samples.filter(sample => event.timeStamp - sample.time < 100);
    const first = samples[0], velocity = !cancelled && first && event.timeStamp > first.time ? (event.clientY - first.y) / (event.timeStamp - first.time) : 0;
    const threshold = Math.min(160, active.height * .3);
    const dismiss = !cancelled && velocity >= -.25 && offset > 12 && offset + Math.max(0, velocity) * 180 >= threshold;
    release.current = { offset, velocity: cancelled ? 0 : velocity, height: active.height };
    if (dismiss) onOpenChange(false);
    revise(value => value + 1); // Return home too when a pending form refuses dismissal.
  }

  return { present, setPanel, setScrim, dragHandlers: {
    onPointerDown: pointerDown, onPointerMove: pointerMove,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => pointerEnd(event),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => pointerEnd(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => pointerEnd(event, true),
  } };
}

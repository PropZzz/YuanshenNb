import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface Transition { skipTransition: () => void; finished: Promise<void>; ready: Promise<void>; }
type MotionDocument = Document & { startViewTransition?: (update: () => Promise<void>) => Transition };

export function useRouteMotion() {
  const location = useLocation(), navigate = useNavigate();
  const surfaceRef = useRef<HTMLDivElement>(null), previousPath = useRef(location.pathname);
  const active = useRef<Transition | null>(null), entrance = useRef<Animation | null>(null);
  const pendingCommit = useRef<(() => void) | null>(null), sequence = useRef(0);
  const currentPath = useRef(location.pathname); currentPath.current = location.pathname;

  const go = useCallback((to: string) => {
    const doc = document as MotionDocument;
    sequence.current++; const turn = sequence.current;
    active.current?.skipTransition(); active.current = null;
    pendingCommit.current?.(); pendingCommit.current = null;
    if (new URL(to, window.location.href).pathname === currentPath.current) {
      if (surfaceRef.current && !entrance.current) surfaceRef.current.dataset.motionState = 'open';
      navigate(to); return;
    }
    entrance.current?.cancel(); entrance.current = null;
    surfaceRef.current?.style.removeProperty('will-change');
    if (!doc.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { active.current = null; navigate(to); return; }
    const header = document.querySelector('.workbench-topbar')?.getBoundingClientRect();
    const navigation = document.querySelector('.mobile-navigation')?.getBoundingClientRect();
    const content = surfaceRef.current?.parentElement?.getBoundingClientRect();
    // Snapshot overlays otherwise paint above fixed navigation, even when it is not captured.
    const top = Math.max(0, header?.bottom ?? 0);
    const bottom = navigation?.height ? Math.max(0, innerHeight - navigation.top) : 0;
    document.documentElement.style.setProperty('--route-clip', `${top}px 0px ${bottom}px ${Math.max(0, content?.left ?? 0)}px`);
    const transition = doc.startViewTransition(async () => {
      if (turn !== sequence.current) return;
      // Wait for React's committed route, including lazy content, before taking the new snapshot.
      await new Promise<void>(resolve => { pendingCommit.current = resolve; navigate(to); });
    });
    active.current = transition;
    void transition.ready.catch(() => {}); // Skipping an interrupted snapshot rejects ready.
    void transition.finished.catch(() => {}).then(() => {
      if (active.current !== transition) return;
      active.current = null;
      if (surfaceRef.current) surfaceRef.current.dataset.motionState = 'open';
    });
  }, [navigate]);

  useLayoutEffect(() => {
    const commit = pendingCommit.current;
    commit?.(); pendingCommit.current = null;
    if (active.current && !commit) { sequence.current++; active.current.skipTransition(); active.current = null; }
    const surface = surfaceRef.current;
    if (!surface) return;
    if (previousPath.current === location.pathname) {
      if (!active.current && !entrance.current) surface.dataset.motionState = 'open';
      return;
    }
    previousPath.current = location.pathname;
    const liveOpacity = getComputedStyle(surface).opacity, liveTransform = getComputedStyle(surface).transform;
    const interrupted = !!entrance.current;
    entrance.current?.cancel(); entrance.current = null;
    surface.style.removeProperty('will-change');
    if (active.current) { surface.dataset.motionState = 'opening'; return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof surface.animate !== 'function') { surface.dataset.motionState = 'open'; return; }
    surface.dataset.motionState = 'opening'; surface.style.willChange = 'opacity,transform';
    const animation = surface.animate([
      { opacity: interrupted ? liveOpacity : '.65', transform: interrupted ? liveTransform : 'translate3d(0,8px,0)' },
      { opacity: '1', transform: 'none' },
    ], { duration: 180, easing: 'cubic-bezier(.2,0,0,1)' });
    entrance.current = animation;
    void animation.finished.catch(() => {}).then(() => {
      if (entrance.current !== animation) return;
      animation.cancel(); entrance.current = null;
      surface.style.removeProperty('will-change'); surface.dataset.motionState = 'open';
    });
  }, [location.pathname, location.key]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduce = () => {
      if (!media?.matches) return;
      active.current?.skipTransition(); entrance.current?.finish();
    };
    media?.addEventListener?.('change', reduce);
    return () => {
      media?.removeEventListener?.('change', reduce);
      sequence.current++; active.current?.skipTransition(); pendingCommit.current?.(); entrance.current?.cancel();
    };
  }, []);
  return { surfaceRef, go };
}

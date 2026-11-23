# Web motion refinement

Scope: shared web page transitions, dialogs and secondary drawers. Preserve the current reference colors, layout, forms, navigation and backend contracts. Android is outside scope. Execute in this session without committing or publishing.

## Design

- Keep desktop drawers entering from the right and responsive mobile drawers entering from below; preserve the right-edge import exception.
- Use one content-only page transition, approximately 180 ms. Keep navigation chrome stable. Avoid restarting the page on query-only changes. Retain the existing Suspense boundary so lazy pages can finish loading without replacing the previous view with a flash.
- Use the existing 300 ms drawer entry and 220 ms exit curves. Interrupt from the current transform and opacity. Keep content and focus trapping until exit finishes. Apply the same retained lifecycle to ordinary modals with a smaller 160–180 ms opacity/scale transition.
- Track mobile handle gestures continuously, use distance and recent release velocity to decide dismissal, and settle an incomplete gesture back to the open position. Cancelled gestures, resize, reduced motion and unmount must clear animation state.
- Preserve forms and focus through secondary switches; an outgoing surface must not steal focus from an incoming dialog.

## Execution

- [x] Add focused failing browser/unit regressions for continuous drag, interrupted lifecycle, stable content, content-only navigation, history and reduced motion.
- [x] Refine shared dialog motion and gesture handling; preserve feature page APIs.
- [x] Refine shared navigation motion with a single animation owner and an imperative/history fallback.
- [x] Run unit tests, type check, production build and focused browser/calendar regressions. Inspect slow motion frames on desktop and mobile.
- [x] Review the diff for scope and unintended changes; leave a runnable local preview.

## Verification notes

Browser gesture fixtures are explicit isolated test data. Real authenticated regression tests are separate. Do not infer successful production writes from fixture responses.

### Results

- `npm test`: 24 files / 146 tests passed after the final implementation.
- `npm run build`: TypeScript check and production Vite build passed; no new dependency added.
- `e2e/motion.pw.ts` + `e2e/calendar-selection.pw.ts`: 16 passed, 2 intentionally skipped desktop-only counterparts of mobile scenarios. Covers native snapshots, non-native fallback, history, repeated navigation including returning to the current page, interrupted opening/closing, secondary import round trips without losing the draft, continuous handle drag, cancellation, resize during drag and reduced motion during exit.
- `e2e/full-fidelity.pw.ts`: all 4 real-service desktop/mobile scenarios passed, covering the full reference entry matrix and original drawer timing/focus/keyboard/theme behavior. After the final modal cleanup adjustment, both real-service drawer motion scenarios passed again.
- `git diff --check`: passed. All new changes are restricted to shared Web motion, Web tests and documentation. Earlier uncommitted calendar work and nested worktrees were preserved; Android, backend and contracts were not edited.
- Inspected 10%-speed drawer entry at 15/50/85% and exit at 50%, plus paused native page snapshots. Evidence is in ignored `.appdata/qa/web-motion`. A snapshot painting over the mobile navigation was reproduced, fixed by clipping the transition overlay to the content viewport, and covered by a visual equality check on the selected navigation item.
- Ordinary modals return transform ownership to CSS after motion, allowing content growth and responsive repositioning without frozen pixel offsets.
- Local Vite and API listeners verified at `127.0.0.1:5173` and `127.0.0.1:8080`. No commit, push or deployment performed.

### Deliberate limits

No global visual redesign, new animation library, background parallax, artificial loading delays or decorative staggered card motion. Browser checks use desktop Chrome and mobile viewport/touch emulation; physical iOS/Safari hardware was not tested.

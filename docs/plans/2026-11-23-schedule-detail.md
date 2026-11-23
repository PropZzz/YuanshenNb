# Schedule detail refinement

Scope: Web schedule detail drawer only. Preserve the current palette, fonts, drawer motion, all earlier uncommitted changes and Android. No commit, push or deployment.

Design: Replace nested generic pills and repetitive gray boxes with a clear title/status header, an attribute-colored time interval, compact execution facts, one authoritative protection mode, goal/notes sections and expandable record information. Read all displayed facts from the saved schedule and account timezone. Show missing values honestly. Reminder time is calculated from the saved offset; explicitly identify the current lack of system notification delivery. Do not claim recurrence, imported source, goal progress or live energy data absent from the contract.

- [x] Add focused regression coverage for all statuses, cross-day reminder/end/deadline times, saved presentation, exclusive protection, missing data and mutation outcomes.
- [x] Refine schedule-detail.tsx with semantic sections, time/dl markup, pending/error handling, reversible delete confirmation and truthful team restrictions.
- [x] Replace only obsolete detail styles with scoped responsive styling; keep neighboring drawers intact.
- [x] Run focused/full Web tests, production build and real authenticated desktop/mobile browser flow; inspect a bounded screenshot batch and fix observed defects.

Verification commands (apps/web): `npm test -- --maxWorkers=2`; `npm run build`; `npm run test:e2e -- e2e/schedule-detail.pw.ts e2e/calendar-feedback.pw.ts e2e/calendar-selection.pw.ts e2e/motion.pw.ts --workers=1` with the configured local Chrome executable. Use independent QA accounts and never mutate user records.

## Verified outcome

- Full Web suite passed: 27 files / 167 tests. After the final localized delete-error cleanup, the detail and secondary regression suite passed again: 2 files / 29 tests, including the new failure/cancel regression.
- Final TypeScript/production build passed; no new dependency was installed.
- Combined browser suite passed 26 scenarios, with 2 deliberate desktop skips of mobile-only scenarios. After final visual corrections, all 4 detail scenarios passed again on desktop/mobile with actual API persistence. Cases cover complete/reopen/edit/confirmed delete, cross-day reminder/end/deadline times, actual goal selection, long content, narrow layouts, dark mode and an explicitly injected failed write followed by successful retry.
- Checked one desktop/mobile screenshot batch and a final confirmation batch. Corrected the date tile's dark-mode ink, the primary action's inherited dark-mode hover contrast and mobile delete touch height. Browser checks require at least 4.5:1 contrast for the tile and hovered primary button; body/footer overflow checks passed down to a 320px viewport.
- The mechanical design scan returned no findings. `git diff --check` passed; Android has no diff. Earlier dirty files and nested worktrees remain intact. No commit, push or deployment.
- Evidence: `.appdata/qa/schedule-detail/` (ignored). Browser tests use independent QA accounts. The error shown in dark-mode QA captures is deliberate test input, not a fabricated live user failure. Mobile verification uses Chromium touch/viewport emulation, not physical iOS/Safari hardware.

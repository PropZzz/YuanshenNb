# Calendar browser feedback implementation

Scope: the seven annotated calendar issues. Preserve the existing Web visual identity and all uncommitted work. Do not change Android. Small additive API/database support is necessary for real persistent schedule attributes; do not hide them in notes or use fabricated successful writes.

## Decisions

- A schedule has one primary display attribute from the existing eleven chips. Store optional presentation metadata with the schedule, retain it on partial updates and rescue operations, and use a shared semantic palette in day/week/month/agenda/Gantt views. Existing category data remains compatible.
- Optional goal links point to actual account-isolated goals already stored by the current goal module. Explicitly identify these as browser-local goal sources; store the selected id and title as schedule presentation metadata. Never infer a goal from a title.
- Keep file import's explicit preview/confirm boundary. Verify CSV, ICS, JSON and spreadsheet/course parsing, duplicate handling, actual API persistence and partial failures. Correct misleading format hints and preserve imported attributes.
- Display the three mutually exclusive scheduling modes as an explicit single choice, with the saved flexibility value as the authority.
- Each display toggle controls its stated presentation consistently across available views. Explain when a view has no hourly axis or when a datum is absent. No placeholder goal relationships, unsupported buffer values or invented energy curves.
- Summary statistics describe the selected day and visible period separately. Values come from returned schedules/energy; errors are not shown as zero, and baseline/replay estimates are identified as estimates or test data.
- Adjust only the marked title spacing and date input's duplicated border/focus styling. Verify desktop and mobile together.

## Work

- [x] Add regression tests and additive persistence for attributes/selected goal snapshots.
- [x] Implement shared attribute presentation, editor selection, real goal association and all-view filter semantics.
- [x] Verify imports and preserve recognized attributes through preview/write/read-back.
- [x] Correct summary data states, title spacing and date field styling.
- [x] Run unit/API/integration/browser checks, inspect one desktop/mobile batch, repair observed defects and confirm once.

No commit, push or deployment is authorized by this task. Existing local preview can be refreshed after verification.

## Verified outcome

- Web unit suite: 26 files / 153 tests passed with two workers. Focused final editor/summary/presentation/secondary regression also passed.
- Production build and TypeScript check passed; no additional dependency was installed.
- Go `go test ./... -count=1` passed with real PostgreSQL integration enabled through `TEST_DATABASE_URL`; after adding explicit rescue metadata preservation coverage, schedule/API tests passed again.
- Combined browser run (`calendar-feedback`, `calendar-selection`, `motion`): 22 passed, 2 deliberate desktop skips of mobile-only scenarios. Of the six new feedback cases, four exercise real authenticated persistence and imports, and two explicitly inject read failures to verify honest error states. Existing selection and motion cases use their documented fixtures.
- Actual CSV, ICS, JSON and XLSX course files were previewed and explicitly confirmed through the UI; the resulting six records per import account were read back from the real API. Tests used independent QA accounts and did not edit the user's schedules.
- Day/week/month/agenda/Gantt attribute colors matched after reload; distinct attributes sharing the same underlying category had distinct colors. Goal labels originated from an actual browser-created account-local goal; the selected id/title and single constraint value survived server persistence.
- Final desktop/mobile inspection confirmed title padding, the single date frame, clear exclusive radio selection, and all three mobile summary values. The earlier mobile `:last-child` rule was hiding the third real statistic after removal of the old decorative fourth element; the correction now targets the actual three-item summary.
- Mechanical design scan reported only the pre-existing event/agenda color marker borders. These were retained as meaningful calendar color coding and part of the requested incumbent style.
- Applied only the Up section of additive migration `0003_schedule_presentation.sql` to the existing local development database after checking that the column was absent. Restarted the local development API with the same existing configuration. Service startup does not automatically apply database migrations; the deployment prerequisite is documented.
- Updated the OpenAPI contract and generated Web types. Android source was not modified; its existing JSON configuration was read-only checked and already ignores additive fields.
- `git diff --check` passed. Prior calendar/motion edits and nested worktree changes were preserved. No commit, push or remote deployment was performed.

## Deliberate data boundaries

Energy marked as a rhythm baseline or replay remains an estimate/test source, not a claim of live wearable measurement. Goal definitions remain browser-local; only the explicitly selected goal id/title snapshot is persisted with the schedule. Hourly energy bands apply to day/week views and are explicitly unavailable in month/Gantt views. Unknown imported labels remain in notes rather than being assigned an invented attribute.

Screenshots: ignored `.appdata/qa/calendar-feedback`. Local preview: `http://127.0.0.1:5173/calendar`.

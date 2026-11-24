# Calm Precision Bento

The web workbench pairs compact scheduling controls with a calm, readable surface system. The live UI uses a light canvas by default, with a deep-teal focus/energy surface to keep the timer and energy score visually prominent. This note records the current implementation in `src/styles/tokens.css`, `src/styles/visual-system.css`, feature styles, and the shell; it is not a separate token source.

## Surfaces and color

- Light canvas: `#F6F8F9`; cards: `#FFFFFF`; primary teal: `#0F4C4C`.
- Dark canvas: `#0A1113`; card surface: `#111C1F`; primary teal: `#2DD4BF`. Supporting surfaces step through darker teal-charcoal layers.
- Energy tiers use green (peak), blue (steady), amber (strained), and red (depleted), with separate soft backgrounds. Dark mode uses brighter foreground variants and translucent tier backgrounds.
- The focus timer and energy hero are deep-teal gradient feature surfaces in light mode as well as dark mode. Their inner timer/source panels use translucent fills and light borders.
- Cards use restrained borders and soft shadows. Shared cards are generally 16px radius; feature/inner panels use 12px; buttons and common controls use 10px, with compact field variants at 8px. Status pills are fully rounded.

## Type, icons, and layout

Headings use the Noto Serif SC / Noto Serif / Source Han Serif SC / Georgia stack; body text uses Inter with PingFang SC, Microsoft YaHei, and system fallbacks. Scores and times use tabular numerals. Lucide icons in the shell and auth canvas use a 1.75px stroke.

The desktop shell has a 260px collapsible side rail and a sticky translucent top bar. Both use backdrop blur; the rail and bar blend into the surface instead of reading as solid chrome. At widths below 1024px the rail gives way to a fixed bottom navigation; narrower layouts simplify top-bar actions and reflow feature grids. The captured 390px layouts show the same cards in a single-column reading order.

## Interaction and state cues

Active navigation, selected segments, progress, and primary actions reuse the teal token. Card hover lift and the spring navigation indicator add restrained movement. Reduced-motion preferences disable route transitions and shorten or remove CSS animation and transition effects.

Connection and energy-source labels distinguish connection state, server estimates, wearable samples, and replay data. Empty, loading, error, and offline states remain explicit; energy charts do not fill missing server data with a fabricated curve. Focus substeps and quick mood feedback identify their browser-local scope. Team sharing defaults to `busy_only`; that view exposes occupancy without event titles or energy tiers, and the privacy settings state that raw physiological data is not shared at any level.

## Current captures

`.impeccable/review/visual-qa-report.json` records 48 route captures from November 24, 2026: 12 routes at 1440px desktop and 390px mobile in both light and dark themes. The report shows no horizontal overflow or page errors; separate captures cover the light-theme drawers and the dark preferences drawer. `/integrations` intentionally opens its integration panel over the calendar and the report records that dialog title. These are deterministic visual-QA captures backed by mocked API fixtures, not production data. Representative views: [desktop focus](.impeccable/review/desktop-focus.png), [mobile focus](.impeccable/review/mobile-focus.png), [dark desktop focus](.impeccable/review/desktop-dark-focus.png), [dark mobile team](.impeccable/review/mobile-dark-team.png), [desktop integrations panel](.impeccable/review/desktop-integrations.png), and [mobile calendar](.impeccable/review/mobile-calendar.png).

For implementation details, see [tokens.css](src/styles/tokens.css), [visual-system.css](src/styles/visual-system.css), [workbench-shell.tsx](src/components/shell/workbench-shell.tsx), [energy-page.tsx](src/features/energy/energy-page.tsx), [focus-page.tsx](src/features/focus/focus-page.tsx), and [settings-page.tsx](src/features/settings/settings-page.tsx).

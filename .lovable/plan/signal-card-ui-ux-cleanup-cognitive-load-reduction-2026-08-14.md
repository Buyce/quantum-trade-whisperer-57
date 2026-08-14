# Signal Card UI/UX Cleanup — Cognitive Load Reduction

## Goal
Restructure `SignalCard.tsx` so a trader can grasp the setup in under 5 seconds, with progressive disclosure hiding secondary detail until requested.

## Changes

### 1. Header Consolidation
- Strip the summary row to six tokens only:
  - **Left:** Instrument | GradeBadge | Direction badge
  - **Right:** R:R | Confidence | Time Ago
- Remove from the header row: `BUY LIMIT`/`SELL LIMIT` badge, `CAPPED` badge, `ExecutionChip`, `DistanceChip`, `TIF` badge.
- Keep the left grade rail and the expand/collapse chevron.
- Keep the collapsed state responsive: the 2x2 labelled metric grid on mobile collapses back to the inline right cluster on `sm` and up.

### 2. Action Zone Banner
- Add a full-width banner immediately **below the price matrix** (inside the expanded detail) and **above** the qualitative/confluence section.
- **State 1 — Safe:** soft green background (`bg-long/15 border-long/30 text-long`). Text: "SAFE ENTRY: Market or Limit at [Entry]. Cancel un-filled orders in 30m."
- **State 2 — Beyond safe limit:** amber/warning background (`bg-warning/15 border-warning/30 text-warning`). Text: "⚠️ RETEST ONLY: Price ran past safe limit. Place Limit Order at [Entry]. Cancel un-filled orders in 30m."
- If capped, append: "Note: Extension is capped at [max_r]R by H4 barrier."
- Reuse existing `executionRead` and `isCapped` helpers; do not change backend logic.
- Remove the scattered grey subheader text that currently duplicates this guidance.

### 3. Price Matrix Visual Hierarchy
- In the `Metric` grid, render **Entry (limit)** and **Stop-loss** with larger/bolder typography than the Take Profit levels and R:R.
- Options: use `text-lg font-bold` for Entry and Stop-loss, keep targets at `text-base font-semibold`.
- Preserve the `tone` colors (long/short/foreground).

### 4. Progressive Disclosure for Qualitative Breakdown
- Hide the qualitative-breakdown paragraph by default.
- Replace it with a toggle button: `[+] View Qualitative Analysis` / `[-] Hide Qualitative Analysis`.
- Clicking expands the paragraph in place with a smooth transition (if Motion is available, otherwise instant).
- Keep the Confluence Pillar progress bars and the H4/H1/M15/ATR context line visible by default.

## Technical Details
- File to edit: `src/components/SignalCard.tsx`.
- Use existing design tokens only (`bg-long`, `bg-warning`, `text-short`, `--color-grade-aplus`, etc.). No hardcoded hex values.
- No backend changes; no database migrations; no new server functions.
- Maintain existing accessibility: `aria-expanded`, `aria-controls`, keyboard focusable toggle.
- Keep the `Metric` component generic; add an optional `emphasis` prop rather than hard-coding instrument-specific sizes.

## Verification
- Run the dev build/typecheck to confirm no compile errors.
- Inspect the Signal Feed on desktop and mobile viewport widths to confirm:
  - Header row has only the six tokens.
  - Action Zone banner shows correct safe/retest state.
  - Entry and Stop-loss are visually heavier than TPs.
  - Qualitative paragraph is hidden until the toggle is clicked.

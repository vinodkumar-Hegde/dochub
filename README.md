# DocHub — Programme-first Student Tiles V20

React 19 / TypeScript / Vite interactive frontend prototype. This version refines the student learning flow around a simple programme → subjects → materials hierarchy.

## Start on macOS

Extract `DocHub-Tiles-V20.zip` into your working folder, then run:

```bash
cd DocHub-Tiles-V20
npm install
npm run dev
```

Open **http://localhost:5190/**. Cognito requires this exact local callback URL; using `127.0.0.1` causes `redirect_mismatch`.

## Student navigation in V20

1. Student home shows navigation tiles and a **Browse by programme** grid. No subject cards are mixed across programmes.
2. Select a programme to open its subject tiles only.
3. Select a subject to open the published study materials as 2D document tiles.
4. Use breadcrumbs or the back control to move up one level. No permanent left-side tree is used.
5. Document tiles retain PDF opening, reading progress, and pin/unpin interactions.

## Visual system

- Light-filled tiles, consistent 1px borders and compact spacing.
- Medical 2D pictograms with subject-specific accent colours.
- Hover lift, soft shadow, visible keyboard focus and reduced-motion support.
- Responsive tile grids for desktop, tablet and mobile.

## Key files

- `src/StudentLauncher.tsx` — student home and programme catalogue.
- `src/StudentLearning.tsx` — programme → subject → material navigation.
- `src/StudentPortal.tsx` — student top navigation, app switcher and header.
- `src/student-tiles.css` — tile styling, responsive layout and hover motion.
- `src/TilePictogram.tsx` — reusable 2D icon pairs.
- `src/App.tsx` and `src/data.ts` — existing prototype state, entitlements, PDF reader, sessions and sample data.

## Verification and limitations

- TSX syntax/transpilation check passed.
- Full `npm run build` and visual browser QA remain unverified because `npm install` timed out while downloading dependencies in this environment. Run `npm install && npm run build` locally.
- This remains a frontend prototype using local mock data. Backend persistence, real document storage/processing, and server-side authorization are not implemented by this UI change.

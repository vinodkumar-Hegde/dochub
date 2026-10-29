# DocHub V18 — Start-style Admin Launcher

This is a frontend-only update to the V17 prototype, inspired by the Windows Start tile interface provided by the user.

## Navigation behavior

- Super Admin loads a Start-style dashboard instead of a horizontal tab strip or permanent left menu.
- Click any app tile once to open its existing workspace: Academic Mapping, Uploads, Live Sessions, Subscribers, Analytics, or Employee Access.
- Click **Start** (grid icon) at the top-left to return to the launcher.
- Click **All apps** from any module to open a compact application switcher without returning home.
- Press **Command+K** on Mac (**Control+K** elsewhere) to open the searchable app switcher; press Escape to close.
- Tiles can be pinned or unpinned using the pin button (locally stored in the browser); pinned apps appear first.
- Previously opened modules appear in **Recently opened** on the Start dashboard.
- Selecting **Student preview** switches to the existing student prototype.
- The launcher uses responsive Metro-style tiles and compact mobile layout.

The white workspace backgrounds, official DocTutorials logo, mock mapping data, multi-course subscriber editor, mock permissions, and other V17 screens remain unchanged.

## Mac installation

The ZIP contains exactly one root folder named `DocHub-Windows-Start-V18`.

```bash
cd ~/Desktop/atte && \
unzip -o DocHub-Windows-Start-V18.zip && \
cd DocHub-Windows-Start-V18 && \
npm install && \
npm run dev
```

Open **http://127.0.0.1:5188**.

## Test coverage / limitations

TypeScript/JSX syntax-transpilation checks and archive integrity checks completed. `npm install` could not reach the npm registry in the execution environment, so the full TypeScript build and Chrome/Safari/Firefox device tests remain unverified.

This is an interactive UI prototype, not a backend or authorization implementation. Module permissions and subscriber mappings must be enforced server-side in production. Pinned shortcuts are browser-local.

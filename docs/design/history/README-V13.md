# DocHub Clean V13 — Student learning refinement

## Implemented
- My Learning: programme is initially closed. Select a programme to expand its subjects; select again to close it.
- Subject selection is explicit; only subjects of the expanded programme are shown.
- Course/subject pane can collapse and expand independently of the global sidebar.
- Gallery cards have improved responsive document-cover illustrations (mock previews, not first-page PDF renders).
- Pin/unpin in List and Gallery without opening a document. Pins are keyed by student and persisted in localStorage for the prototype; pinned documents float to the top of their subject listing.
- Clicking the title/cover/row (outside the pin control) opens the simulated PDF reader.
- Global sidebar collapse/expand remains available from prior releases.

## Known limitations
This remains a frontend mock. Real PDF thumbnails, persisted server-side pin state, actual PDF parsing, backend storage and authorization still require integration. Full npm install, TypeScript build and Chrome/Safari/Firefox cross-browser checks have not been verified in this environment.

## Run on Mac
Unzip in ~/Desktop/atte and run `cd ~/Desktop/atte/DocHub-Clean-V13 && npm install && npm run dev`.
Visit http://127.0.0.1:5183

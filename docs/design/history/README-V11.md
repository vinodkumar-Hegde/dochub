# DocHub V11 — UI review build

- Selected programme prominently highlighted in My Learning.
- Pointer-based drawing overlay for Pen and Highlight in normal and Fit Page modes; Eraser removes nearby stroke and Undo removes last stroke. The overlay stores page-specific strokes in React state for the active session, not in the PDF file.
- Thumbnail rail stays visible while drawing and zooming.
- Fit Page retains toolbar and annotation controls.
- Student font controls remain unavailable.
- PDF pages are simulated; actual PDF ingestion, persistence, browser compatibility and printing/export of annotations are not implemented.

Run from `~/Desktop/atte`:

```bash
cd ~/Desktop/atte && unzip -o DocHub-Premium-V11.zip && cd DocHub-Premium-V11 && npm install && npm run dev
```

Open http://127.0.0.1:5181

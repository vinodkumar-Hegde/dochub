# DocHub V6 — Identify the correct project

This build has a visible green `V6 COMPACT` marker in the top bar and `by DocTutorials · V6` in the sidebar.

From this directory (the one containing `package.json`):

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5176** (NOT port 5175). If you do not see `V6 COMPACT`, the wrong app is being served. Confirm `pwd` in the terminal and ensure the output path ends with `DocHub-Verified-V6`. The `--strictPort` setting prevents silent fallback to another port.

On macOS you can also double-click `RUN-ON-MAC.command`, approving execution if prompted.

V6 contains the source-level V5 fixes: the large gradient student learning banner and Prototype Mode panel are absent; the course summary, sidebar, and material rows are compact. PDF rendering remains simulated.

# SteelTakeoff AI

A private, local steel takeoff and estimating workspace for Australian fabrication. Python performs the calculations and PDF processing; SQLite stores projects, calculation snapshots, rate overrides and revision history. The browser talks only to the local server unless you explicitly approve optional OpenAI analysis.

## Start on Windows

1. Install **Python 3.11 or newer** from https://www.python.org/downloads/. Select **Add Python to PATH**.
2. [Download the application ZIP](https://github.com/shahilavneel-dev/New/archive/refs/heads/main.zip), or open [the repository](https://github.com/shahilavneel-dev/New) and choose **Code > Download ZIP**. Sign in to GitHub if the repository requires it.
3. Right-click the downloaded ZIP and choose **Extract All** into a folder you can write to, such as `Documents\SteelTakeoff`. Open the extracted folder containing `START_STEELTAKEOFF.bat`, then double-click it. On the first launch, internet access is needed to install the free Python packages.
4. Keep the command window open. Chrome or Edge opens the application; if needed enter `http://127.0.0.1:8765` in your browser.
5. Close the command window to stop the application. Projects remain in the `app_data` folder.

The launcher checks packages on subsequent launches and reuses `.venv`. It does not require paid hosting. This release was exercised on Linux with Chromium; Windows launcher behavior and Edge must still be verified on your Windows computer. If the port is already occupied, close the previous application window before starting another instance. Do not open `index.html` directly.

For Linux/macOS: run `bash start_linux_mac.sh` with Python 3.11+ installed.

## First estimate

- Start an enquiry, enter its customer and scope, then upload the structural/architectural drawings.
- The PDF reader extracts **candidates** locally. Check each source reference, quantities, dimensions, scope and unit mass before approving and importing. A repeated mark can reference the same member on several sheets.
- Import a verified section table in Settings or enter verified kg/m manually. Unknown section masses stay unknown. UB/UC designations can contain their nominal kg/m; a section table still needs supplier verification.
- Review stock allocation, plate quantities, fabrication, finishes and subcontract quotations. Blank required costs cause an **Incomplete** profit result. Enter zero only when you have confirmed no cost applies.
- Save your project to SQLite. Changes also autosave after a short pause; check the save status before closing. Browser recovery storage is a fallback, not your backup.
- Review final prices and unresolved flags. Download the **internal** Excel/PDF report, then prepare the separate editable customer email. The application never sends email.

The supplied `SAMPLE_TEST_DRAWING.pdf` contains B1, C1 and B2. Its scope requests B1 and C1 only. C1 needs verified kg/m; do not import B2 unless the scope is changed. Demo data is explicitly labelled and is not a supplier section database.

## Rates, section tables and assemblies

Settings contains editable commercial rates, a section library with provenance, and an assembly library. The two initial post assembly examples come from your supplied estimating rules; apply them only when the assembly details match. New estimates use workspace rates. You can pin and edit a project's rate overrides; every saved revision retains its calculation and effective rate snapshot. Reopening or restoring a saved project retains its saved rates; clear its project rate override in Settings to use current workspace rates.

Verified CSV/Excel import supports a header such as:

```text
designation,family,kgm,stock_lengths,supplier_price,material,source
```

Use semicolons between stock lengths inside a CSV cell. `supplier_price` is AUD/tonne. Positive kg/m, a valid family and a verification source are required. Supported families include UB, UC, PFC, SHS, RHS, Pipe (including CHS), Angle and Flat bar. The application does not supply invented hollow-section weights.

Saw nesting compares section-specific stock and available supplier cut options using a cost-aware heuristic. It is not a global optimum guarantee. Preliminary tolerance is an estimating allowance. Production checks require confirmed lengths, kerf and stock details. Tube usable lengths are 8m→7.75m, 9m→8.75m and 12m→11.5m; PFC over 200 is excluded. Confirm actual supplier availability.

Detailed plates use conservative rectangular geometric packing, grouped by thickness, with rotation and cutting gaps. Whole sheets are purchased. Irregular contours and machine toolpaths require workshop software/review. The provisional 12% rule uses gross purchased structural stock and quarter-sheet equivalent costing; fabricated plate weight stays separate from charged material.

## Drawing interpretation and optional AI

Digital PDFs are extracted with PyMuPDF, with word coordinates retained for source highlighting and schedule-row review. You can zoom, pan, calibrate a known dimension and measure; calibrated measurements remain estimating evidence requiring confirmation. Drawing revisions and duplicate marks stay visible. The explicit Cross-reference local drawings action compares up to eight files / 150 combined pages. It links repeated marks, section/revision conflicts and explicit same-column top/base RL evidence across structural and architectural drawings. Level differences stay provisional; connection offsets and final fabrication lengths are not inferred.

Scanned pages can use **local Tesseract OCR**, when Tesseract and its English language data are installed. Tesseract is optional and is not bundled by the Windows launcher. If unavailable, use manual takeoff or explicitly selected optional AI. OCR does not verify dimensions.

Optional OpenAI analysis needs your own API account and separately billed API key. Configure the key in backend environment variable `OPENAI_API_KEY`, or enter it in the session-only key field. It is never saved in project JSON or the database. The external analysis dialog discloses the selected page images, extracted text and scope before asking you to authorize transmission. Nothing is transmitted just by uploading drawings. Missing credentials leave local extraction, manual estimating and all core features available.

External AI interpretation is not a verified automatic whole-job takeoff. Approval is required for every imported row. Complex plan/elevation association, connection geometry and fabrication dimensions still require review. An optional API route being present does not establish its live accuracy or availability; no paid service is needed for local validation.

## Saving, backup and old projects

- Projects and revisions: `app_data/steeltakeoff.sqlite3`.
- Drawings: `app_data/uploads`.
- Dashboard **Download full backup** exports the database plus uploaded drawings. Keep this ZIP outside the application folder.
- **Restore** validates a backup before replacing local data and preserves the previous data folder alongside it for recovery. Open a restored project from Dashboard afterward. Stop other application instances before restoring.
- Existing V1/V2 project JSON can be opened and exported. Unknown legacy fields are retained. An old drawing reference needs its original `app_data/uploads` file; JSON alone does not contain drawing bytes.
- Revision history restores an earlier estimate as a new revision. Concurrent stale saves are rejected rather than silently replacing newer work.

The server binds to loopback only. Local host/origin guards reject cross-site mutation requests; do not expose the server through public forwarding. Backup ZIPs and internal reports contain confidential project information.

## Development and validation

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
.venv/bin/python -m pip install -r requirements-dev-lock.txt
.venv/bin/python -m pytest -q
STEELTAKEOFF_NO_BROWSER=1 .venv/bin/python server.py
```

Browser tests use system Chromium when available or Playwright's installed Chromium. To install the latter: `.venv/bin/python -m playwright install chromium`. Browser checks start their own loopback test server and temporary data directory. OCR integration requires Tesseract; tests report skips if optional capabilities are absent.

`requirements-lock.txt` records tested runtime versions. `requirements.txt` declares supported ranges. Keep TLS and package verification enabled when refreshing packages.

Main files:

- `estimating.py`: deterministic quantities, stock/plate packing and costing.
- `storage.py`, `project_api.py`: SQLite, revisions, verified data imports, reports and backups.
- `drawing_analysis.py`, `server.py`: local PDF/OCR processing and explicitly approved optional AI.
- `app.js`, `workspace.js`, `settings.js`, `pdf_extension.js`: estimating UI, persistence and drawing review.
- `tests/`: calculation, persistence, drawing and browser checks.

Set `STEELTAKEOFF_DATA_DIR` to an alternative writable data directory for isolated tests or a different local storage location. `STEELTAKEOFF_NO_BROWSER=1` suppresses automatic browser opening. Future cloud tasks should use this existing checkout; each task is already isolated and does not need a Git worktree.

Create a portable source release with `.venv/bin/python package_release.py`. The ZIP deliberately excludes your local database, uploaded private drawings and virtual environment. Use the separate full backup for project data.

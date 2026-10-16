# Validation record

Validated in this cloud environment on 16 October 2026 using Python 3.12, Linux, Chromium and local Tesseract. This records current-instance checks; it does not establish Windows/Edge behavior or a newly published cloud snapshot.

| Check | Result |
| --- | --- |
| Full automated suite | **101 passed**, plus 18 passing calculation subtests; no failures or skips |
| Calculation engine | User's nesting, plates, HDG minimum, fabrication, priming, drafting, installation and material-margin examples passed |
| Incomplete/invalid data | Missing costs suppress verified profit/margin; negative, zero, nonfinite and excessive inputs tested |
| Project persistence | SQLite round trips, revisions, concurrent saves, conflict detection, pinned rate snapshots passed |
| Reports | Real Excel and PDF artifacts opened and checked; internal figures kept separate from generated customer email |
| Backups | Database plus drawings round trip; invalid archives rejected; previous data preserved |
| Sample PDF | B1/C1/B2 extracted with expected quantities and lengths; C1 mass remains unknown |
| Scanned sample | Actual local Tesseract OCR recovered schedule candidates without inventing hollow-section mass |
| Drawing references | Duplicate marks/revisions, explicit schedule columns, rotated pages, unconfirmed dimensions and cross-file top/base RL evidence tested |
| Browser workflow | Save/reopen, edited email persistence, Excel/PDF downloads, approval gates, source highlights, zoom, calibration, measurement and cross-file review passed in real Chromium |
| Settings browser checks | Rates, pinned overrides, verified section CSV/XLSX import, edits/removal, assembly factors and adding catalog members checked in isolated Chromium session |
| Local startup | Linux/macOS launcher launched server; health and functional two-4m-beam request passed |
| Dependency consistency | Pinned install repeated successfully; pip check passed |
| Syntax | All frontend scripts checked by Node; Python modules compiled |
| Source archive | ZIP CRC and file inventory checked; runtime data and environments excluded |

The full test command is `.venv/bin/python -m pytest -q`. Optional dependencies are listed in `requirements-dev-lock.txt`; runtime versions are in `requirements-lock.txt`.

The dependency test client emits one deprecation warning about its HTTP transport. It does not affect these passing checks; test-client upgrades should be reviewed with future dependency refreshes.

## Limits and next validation

- **Windows launcher and Edge have not been executed here.** Install Python 3.11+, extract the release and double-click `START_STEELTAKEOFF.bat` to validate on your machine.
- **Live OpenAI analysis is untested.** No API key was configured and no drawing was sent externally. Missing-key behavior, disclosure, consent gates and response sanitization are tested. External AI is optional and separately billed.
- Drawing extraction produces candidates, not a complete verified whole-job takeoff. Local cross-references link explicit mark/section/RL evidence; they do not resolve arbitrary drawing geometry or final connection conditions.
- Stock nesting is a cost-aware heuristic, and plate nesting is conservative rectangular packing. Global optimality, arbitrary contour nesting and production machine toolpaths are not claimed.
- A verified supplier section table is not bundled. Add/import your verified data, available stock lengths and buying prices. Unknown unit weights remain blank.
- Reusable cloud installation and startup instructions have been saved. Validation in a fresh cloud task has not been performed.

The application source excludes customer drawings, saved estimates, local databases, credentials and the original private project brief. The application does not send email automatically.

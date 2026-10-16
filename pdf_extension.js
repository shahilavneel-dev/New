/* Review-first, local PDF extraction and optional explicitly approved external AI. */
"use strict";
let pdfBusy = false,
  pdfHealth = null,
  pdfFocused = -1,
  pdfAIPagesValue = "1";
let pdfMessage =
  "Upload a drawing, review local candidates and approve verified lines before import.";
let pdfZoom = 1,
  pdfTool = "pan",
  pdfPoints = [],
  pdfExternalPreview = null,
  pdfReferenceHighlight = null;
const pdfViewportScroll = {};
let pdfRenderedViewKey = "";
const pdfState = () => {
  for (const key of [
    "pdfFiles",
    "pdfCandidates",
    "pdfFlags",
    "pdfMeasurements",
    "pdfMarkups",
  ])
    if (!Array.isArray(state[key])) state[key] = [];
  if (!state.pdfCalibrations || typeof state.pdfCalibrations !== "object")
    state.pdfCalibrations = {};
  if (typeof state.pdfScope !== "string") state.pdfScope = "";
  if (!state.pdfActiveFile && state.pdfFiles.length)
    state.pdfActiveFile = state.pdfFiles[0].file_id;
  if (!Number.isInteger(Number(state.pdfPage)) || Number(state.pdfPage) < 1)
    state.pdfPage = 1;
  return state;
};
function pdfCurrentDoc() {
  pdfState();
  return state.pdfFiles.find((d) => d.file_id === state.pdfActiveFile) || null;
}
async function pdfRequest(url, opts) {
  const response = await fetch(url, opts);
  let body;
  try {
    body = await response.json();
  } catch (e) {
    body = { detail: response.statusText };
  }
  if (!response.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail || "Request failed"),
    );
  return body;
}
async function pdfCheckHealth() {
  try {
    pdfHealth = await pdfRequest("/api/health");
  } catch (e) {
    pdfHealth = { status: "offline", ai_ready: false };
  }
  if (tab === "PDF / AI") render();
}
function pdfStatus(message) {
  pdfMessage = message;
  if (tab === "PDF / AI") render();
}
function pdfCandidateKey(c) {
  return [
    c.file_id,
    c.origin,
    c.kind,
    c.page,
    c.section || c.label,
    c.mark || "",
    c.evidence || "",
  ]
    .join("|")
    .toLowerCase();
}
function pdfDuplicateWarnings() {
  const groups = new Map();
  for (const c of state.pdfCandidates) {
    c.duplicate_mark = false;
    if (!c.mark || c.status === "rejected") continue;
    let key = String(c.mark).toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const rows of groups.values())
    if (rows.length > 1) for (const c of rows) c.duplicate_mark = true;
}
function pdfAddCandidates(candidates, file, origin) {
  pdfState();
  const existing = new Set(state.pdfCandidates.map(pdfCandidateKey));
  let added = 0;
  for (const c of candidates || []) {
    if (!c || !["member", "plate"].includes(c.kind)) continue;
    const next = {
      ...c,
      file_id: file.file_id,
      filename: file.filename,
      origin: origin || c.origin,
      selected: false,
      imported: false,
      status: "pending",
    };
    const key = pdfCandidateKey(next);
    if (existing.has(key)) continue;
    state.pdfCandidates.push(next);
    existing.add(key);
    added++;
  }
  pdfDuplicateWarnings();
  return added;
}
async function pdfUploadFiles(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  pdfState();
  pdfBusy = true;
  pdfStatus("Reading " + files.length + " drawing file(s) locally…");
  let success = 0,
    total = 0;
  const errors = [];
  for (const f of files) {
    try {
      if (f.size > 35 * 1024 * 1024) throw Error("Over 35 MB file limit");
      const fd = new FormData();
      fd.append("file", f);
      const data = await pdfRequest("/api/upload", {
        method: "POST",
        body: fd,
      });
      const first = data.page_info?.[0] || {};
      const doc = {
        file_id: data.file_id,
        filename: data.filename,
        pages: data.pages,
        page_info: data.page_info || [],
        drawing_number: first.drawing_number || "",
        revision: first.revision || "",
        uploaded_at: new Date().toISOString(),
      };
      state.pdfFiles.push(doc);
      state.pdfActiveFile = doc.file_id;
      state.pdfPage = 1;
      pdfFocused = -1;
      pdfPoints = [];
      pdfZoom = 1;
      total += pdfAddCandidates(data.candidates, doc, "PDF text");
      for (const flag of data.flags || [])
        state.pdfFlags.push(`${doc.filename}: ${flag}`);
      success++;
    } catch (e) {
      errors.push(f.name + ": " + e.message);
    }
  }
  pdfBusy = false;
  save();
  pdfStatus(
    `Uploaded ${success}/${files.length}; ${total} candidate callout(s). ${errors.join(" · ")}`,
  );
}
function pdfSelectFile(id) {
  state.pdfActiveFile = id;
  state.pdfPage = 1;
  pdfAIPagesValue = "1";
  pdfFocused = -1;
  pdfPoints = [];
  pdfZoom = 1;
  pdfExternalPreview = null;
  pdfReferenceHighlight = null;
  save();
  render();
}
function pdfGoPage(page) {
  const d = pdfCurrentDoc();
  if (!d) return;
  state.pdfPage = Math.max(1, Math.min(d.pages, Number(page) || 1));
  pdfAIPagesValue = String(state.pdfPage);
  pdfFocused = -1;
  pdfPoints = [];
  pdfExternalPreview = null;
  pdfReferenceHighlight = null;
  save();
  render();
}
function pdfInvalidateApprovals(reason, fileId) {
  for (const c of state.pdfCandidates || []) {
    if (
      c.imported ||
      c.status !== "approved" ||
      (fileId && c.file_id !== fileId)
    )
      continue;
    c.status = "pending";
    c.selected = false;
    c.approved_at = null;
    c.approval_invalidated = reason;
  }
}
function pdfUpdateScope(v) {
  if (v !== state.pdfScope)
    pdfInvalidateApprovals(
      "Customer scope changed; approve against the updated enquiry",
    );
  state.pdfScope = v;
  pdfExternalPreview = null;
  save();
}
function pdfScopeMarks() {
  const value = state.pdfScope || "";
  // Exact selected-mark suggestions only when exclusivity is explicit. User still approves scope.
  if (!/\bonly\b|\bselected\b|\bjust\b/i.test(value)) return [];
  const segment = (
    value.match(/\b(?:only|selected|just)\b([\s\S]*)/i)?.[1] || ""
  ).split(/[.;\n]|\b(?:exclude|excluding|except|outside|not)\b/i)[0];
  return [
    ...new Set(
      (segment.match(/\b(?:SB|SC|BR|LB|B|C|P)\d+[A-Z]?\b/gi) || []).map((m) =>
        m.toUpperCase(),
      ),
    ),
  ];
}
function pdfEditDoc(key, value) {
  const d = pdfCurrentDoc();
  if (!d) return;
  if (value !== d[key])
    pdfInvalidateApprovals(
      "Drawing metadata changed; verify source and revision again",
      d.file_id,
    );
  d[key] = String(value).slice(0, 80);
  save();
  render();
}
function pdfFamilyFromSection(section) {
  const s = String(section).toUpperCase();
  for (const token of ["PFC", "SHS", "RHS", "UB", "UC"])
    if (s.includes(token)) return token;
  if (s.includes("CHS") || s.includes("PIPE")) return "Pipe";
  if (/EA\b|UA\b|ANGLE/.test(s)) return "Angle";
  if (/FB(?=\d|\s)|FLAT/.test(s)) return "Flat bar";
  return "";
}
function pdfEdit(i, key, value) {
  const c = state.pdfCandidates[i];
  if (!c || c.imported) return;
  c[key] = value;
  if (key !== "selected") {
    c.status = "pending";
    c.approved_at = null;
    c.selected = false;
  }
  if (key === "section") {
    c.family = pdfFamilyFromSection(value);
    const match = String(value)
      .replace(/\s+/g, "")
      .match(/^\d{2,4}(?:UB|UC)(\d+(?:\.\d+)?)$/i);
    c.kgm = match ? Number(match[1]) : null;
    c.kgm_source = match ? "UB/UC designation" : null;
    c.review =
      "Section edited — verify dimensions, unit mass, quantity and source";
  }
  pdfDuplicateWarnings();
  save();
  render();
}
function pdfUseSectionDatabase(i) {
  const c = state.pdfCandidates[i];
  const db =
    typeof workspaceSettings !== "undefined"
      ? workspaceSettings.sections || []
      : state.sectionDatabase || state.sections || [];
  const rows = Array.isArray(db) ? db : [];
  const norm = (s) =>
    String(s || "")
      .replace(/\s+/g, "")
      .toUpperCase();
  const found = rows.find(
    (s) => norm(s.designation || s.section) === norm(c.section),
  );
  if (!found || !(Number(found.kgm) > 0)) {
    pdfStatus(
      "No verified mass for this designation in the section database. Enter supplier-verified kg/m manually.",
    );
    return;
  }
  pdfEdit(i, "kgm", Number(found.kgm));
  c.kgm_source = "Editable section database";
  save();
}
function pdfFocus(i) {
  const c = state.pdfCandidates[i];
  if (!c) return;
  state.pdfActiveFile = c.file_id;
  state.pdfPage = c.page;
  pdfFocused = i;
  pdfReferenceHighlight = null;
  pdfAIPagesValue = String(c.page);
  pdfPoints = [];
  save();
  render();
}
function pdfFocusReference(fileId, page, bbox) {
  state.pdfActiveFile = fileId;
  state.pdfPage = Number(page);
  pdfFocused = -1;
  pdfReferenceHighlight = { file_id: fileId, page: Number(page), bbox };
  pdfAIPagesValue = String(page);
  pdfPoints = [];
  save();
  render();
}
function pdfHighlightHTML(doc) {
  const c = pdfReferenceHighlight || state.pdfCandidates[pdfFocused];
  const meta = doc.page_info?.[Number(state.pdfPage) - 1];
  if (
    !c ||
    c.file_id !== doc.file_id ||
    Number(c.page) !== Number(state.pdfPage) ||
    !Array.isArray(c.bbox) ||
    !meta?.width ||
    !meta?.height
  )
    return "";
  const [x1, y1, x2, y2] = c.bbox;
  return `<div class="pdfHighlight" style="left:${Math.max(0, (100 * x1) / meta.width)}%;top:${Math.max(0, (100 * y1) / meta.height)}%;width:${Math.max(1, (100 * (x2 - x1)) / meta.width)}%;height:${Math.max(1, (100 * (y2 - y1)) / meta.height)}%"></div>`;
}
function pdfCalibrationKey() {
  return state.pdfActiveFile + ":" + state.pdfPage;
}
function pdfRememberViewport() {
  const box = document.getElementById("pdfViewport");
  if (box && pdfRenderedViewKey)
    pdfViewportScroll[pdfRenderedViewKey] = {
      left: box.scrollLeft,
      top: box.scrollTop,
    };
}
function pdfSetTool(tool) {
  pdfTool = tool;
  pdfPoints = [];
  render();
}
function pdfSetZoom(value) {
  pdfZoom = Math.max(0.5, Math.min(4, Number(value) || 1));
  render();
}
function pdfPanStart(ev) {
  if (pdfTool !== "pan" || ev.button !== 0) return;
  const box = document.getElementById("pdfViewport");
  const start = {
    x: ev.clientX,
    y: ev.clientY,
    left: box.scrollLeft,
    top: box.scrollTop,
  };
  const move = (e) => {
    box.scrollLeft = start.left - (e.clientX - start.x);
    box.scrollTop = start.top - (e.clientY - start.y);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  ev.preventDefault();
}
function pdfDrawingClick(ev) {
  if (pdfTool === "pan") return;
  const image = document.getElementById("pdfDrawingImage");
  const rect = image.getBoundingClientRect();
  const point = {
    x: Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)),
  };
  if (pdfTool === "note") {
    const note = prompt("Drawing note / assumption:");
    if (!note) return;
    state.pdfMarkups.push({
      file_id: state.pdfActiveFile,
      page: Number(state.pdfPage),
      ...point,
      text: note.slice(0, 500),
    });
    save();
    render();
    return;
  }
  pdfPoints.push(point);
  if (pdfPoints.length < 2) {
    pdfStatus("First point set. Click the other end of the dimension.");
    return;
  }
  const d = pdfCurrentDoc(),
    meta = d.page_info?.[Number(state.pdfPage) - 1];
  if (!meta?.width || !meta?.height) {
    pdfPoints = [];
    pdfStatus("Page metadata unavailable; upload the source again.");
    return;
  }
  const [a, b] = pdfPoints,
    pointsDistance = Math.hypot(
      (a.x - b.x) * meta.width,
      (a.y - b.y) * meta.height,
    );
  if (pointsDistance < 1) {
    pdfPoints = [];
    pdfStatus("Select two different points.");
    return;
  }
  if (pdfTool === "calibrate") {
    const value = prompt(
      "Enter the real, explicitly dimensioned distance between these points in millimetres. Calibration applies to this page only:",
    );
    const mm = Number(value);
    if (value && Number.isFinite(mm) && mm > 0 && mm <= 100000) {
      state.pdfCalibrations[pdfCalibrationKey()] = {
        mm_per_point: mm / pointsDistance,
        reference_mm: mm,
        points: [a, b],
        created_at: new Date().toISOString(),
      };
      save();
      pdfMessage =
        "Page calibrated. Measured lengths remain provisional; printed scales and scan distortion can vary.";
    } else pdfMessage = "Calibration cancelled or invalid distance.";
  } else {
    const cal = state.pdfCalibrations[pdfCalibrationKey()];
    if (!cal) {
      pdfPoints = [];
      pdfStatus(
        "Calibrate this page against an explicit dimension before measuring.",
      );
      return;
    }
    const mm = Math.round(pointsDistance * cal.mm_per_point);
    state.pdfMeasurements.push({
      file_id: state.pdfActiveFile,
      page: Number(state.pdfPage),
      points: [a, b],
      length_mm: mm,
      provisional: true,
      calibration: cal.mm_per_point,
    });
    save();
    pdfMessage = `Provisional measurement: ${mm.toLocaleString()} mm. Confirm source dimensions before fabrication; it has not changed a candidate.`;
  }
  pdfPoints = [];
  render();
}
function pdfOverlayHTML(doc) {
  const meta = doc.page_info?.[Number(state.pdfPage) - 1];
  if (!meta) return "";
  let out = "";
  const rows = state.pdfMeasurements.filter(
    (m) =>
      m.file_id === doc.file_id && Number(m.page) === Number(state.pdfPage),
  );
  for (const m of rows) {
    const [a, b] = m.points;
    out += `<line x1="${a.x * 100}%" y1="${a.y * 100}%" x2="${b.x * 100}%" y2="${b.y * 100}%" stroke="#007c91" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${(a.x + b.x) * 50}%" y="${(a.y + b.y) * 50}%" fill="#00505f" font-size="12" stroke="white" stroke-width=".4">${Math.round(m.length_mm)} mm provisional</text>`;
  }
  for (const p of pdfPoints)
    out += `<circle cx="${p.x * 100}%" cy="${p.y * 100}%" r="5" fill="#ed6518"/>`;
  const notes = state.pdfMarkups
    .filter(
      (m) =>
        m.file_id === doc.file_id && Number(m.page) === Number(state.pdfPage),
    )
    .map(
      (m) =>
        `<span class="pdfNote" style="left:${m.x * 100}%;top:${m.y * 100}%" title="${esc(m.text)}">${esc(m.text)}</span>`,
    )
    .join("");
  return `<svg class="pdfMeasureOverlay" aria-hidden="true">${out}</svg>${notes}`;
}
function pdfClearPageMarkups() {
  if (!confirm("Clear measurements and notes on this page?")) return;
  state.pdfMeasurements = state.pdfMeasurements.filter(
    (m) =>
      m.file_id !== state.pdfActiveFile ||
      Number(m.page) !== Number(state.pdfPage),
  );
  state.pdfMarkups = state.pdfMarkups.filter(
    (m) =>
      m.file_id !== state.pdfActiveFile ||
      Number(m.page) !== Number(state.pdfPage),
  );
  save();
  render();
}
async function pdfConfigureKey() {
  const node = document.getElementById("pdfKeyInput");
  let apiKey = node?.value?.trim() || "";
  if (!apiKey) {
    pdfStatus(
      "Enter your optional API key first. Digital text and local OCR need no key.",
    );
    return;
  }
  try {
    const r = await pdfRequest("/api/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    pdfHealth = { ...(pdfHealth || {}), ai_ready: r.ai_ready };
    pdfStatus(
      "Optional AI configured in server memory. It will contact OpenAI only after disclosure and confirmation.",
    );
  } catch (e) {
    pdfStatus("Could not configure AI: " + e.message);
  } finally {
    apiKey = "";
    if (node) node.value = "";
  }
}
async function pdfClearKey() {
  try {
    await pdfRequest("/api/key", { method: "DELETE" });
    pdfHealth = { ...(pdfHealth || {}), ai_ready: false };
    pdfExternalPreview = null;
    pdfStatus("AI key cleared from server memory.");
  } catch (e) {
    pdfStatus(e.message);
  }
}
function pdfSetPages(value) {
  pdfAIPagesValue = value;
  pdfExternalPreview = null;
}
function pdfSelectedPages(maximum = 4) {
  const doc = pdfCurrentDoc(),
    parts = pdfAIPagesValue.split(",").map((s) => s.trim());
  if (!doc || parts.some((s) => !/^\d+$/.test(s)))
    throw Error("Enter valid page numbers separated by commas.");
  const pages = [...new Set(parts.map(Number))];
  if (
    !pages.length ||
    pages.length > maximum ||
    pages.some((p) => p < 1 || p > doc.pages)
  )
    throw Error(`Select 1–${maximum} valid pages.`);
  return pages;
}
async function pdfRunOCR() {
  const doc = pdfCurrentDoc();
  if (!doc) return;
  let pages;
  try {
    pages = pdfSelectedPages(2);
  } catch (e) {
    pdfStatus(e.message);
    return;
  }
  pdfBusy = true;
  pdfStatus(
    "Running optional Tesseract locally; no drawing information is transmitted…",
  );
  try {
    const data = await pdfRequest("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: doc.file_id, pages }),
    });
    const added = pdfAddCandidates(data.candidates, doc, "Local OCR");
    for (const f of data.flags || [])
      state.pdfFlags.push(doc.filename + ": " + f);
    save();
    pdfMessage = `Local OCR added ${added} candidate(s). Verify every field against the image.`;
  } catch (e) {
    pdfMessage = "Local OCR: " + e.message;
  }
  pdfBusy = false;
  render();
}
async function pdfCrossReference() {
  pdfState();
  if (!state.pdfFiles.length) return;
  if (
    state.pdfFiles.length > 8 ||
    state.pdfFiles.reduce((n, d) => n + Number(d.pages || 0), 0) > 150
  ) {
    pdfStatus(
      "Cross-reference supports at most 8 files and 150 combined pages. Review a smaller drawing set.",
    );
    return;
  }
  pdfBusy = true;
  pdfStatus(
    "Cross-referencing explicit local member marks and column TOP/BASE RL text…",
  );
  try {
    const result = await pdfRequest("/api/cross-reference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: state.pdfFiles.map((d) => d.file_id) }),
    });
    state.pdfCrossReferences = {
      ...result,
      reviewed_at: new Date().toISOString(),
    };
    const suggestions = new Map(
      result.rl_suggestions.map((r) => [r.mark.toUpperCase(), r]),
    );
    const conflicts = new Set(
      result.marks
        .filter((r) => r.section_conflict || r.revisions.length > 1)
        .map((r) => r.mark.toUpperCase()),
    );
    for (const c of state.pdfCandidates) {
      delete c.rl_suggestion;
      c.cross_reference_conflict = conflicts.has(
        String(c.mark || "").toUpperCase(),
      );
      if (suggestions.has(String(c.mark || "").toUpperCase()))
        c.rl_suggestion = suggestions.get(c.mark.toUpperCase());
      if (c.cross_reference_conflict && !c.imported) {
        c.status = "pending";
        c.selected = false;
        c.approved_at = null;
      }
    }
    for (const flag of result.flags)
      if (!state.pdfFlags.includes("Cross-reference: " + flag))
        state.pdfFlags.push("Cross-reference: " + flag);
    for (const r of result.rl_suggestions) {
      const message = `Cross-reference: ${r.mark} provisional RL difference ${r.suggested_length_mm} mm. ${r.review}`;
      if (!state.pdfFlags.includes(message)) state.pdfFlags.push(message);
    }
    save();
    pdfMessage = `Reviewed ${result.files.length} local file(s) / ${result.pages_reviewed} page(s). ${result.rl_suggestions.length} provisional RL difference(s). Candidate lengths and quantities were not changed.`;
  } catch (e) {
    pdfMessage = "Local cross-reference: " + e.message;
  }
  pdfBusy = false;
  render();
}
function pdfCrossReferenceHTML() {
  const result = state.pdfCrossReferences;
  if (!result) return "";
  const refButton = (r) => {
    const d = state.pdfFiles.find((f) => f.file_id === r.file_id);
    const box = Array.isArray(r.bbox)
      ? JSON.stringify(r.bbox.map(Number))
      : "null";
    const action = `pdfFocusReference(${JSON.stringify(String(r.file_id))},${Number(r.page)},${box})`;
    return `<button class="btn small" onclick="${esc(action)}">${esc(d?.filename || r.file_id)} · page ${Number(r.page)}</button>`;
  };
  const levels = (result.rl_suggestions || [])
    .map(
      (r) =>
        `<tr><td>${esc(r.mark)}</td><td>${Number(r.suggested_length_mm)} mm <b>provisional</b></td><td>${r.references.map(refButton).join(" ")}<div class="tiny">${esc(r.review)}</div></td></tr>`,
    )
    .join("");
  const marks = (result.marks || [])
    .filter((r) => r.references.length > 1 || r.section_conflict)
    .map(
      (r) =>
        `<tr><td>${esc(r.mark)}</td><td>${r.section_conflict ? "Section conflict" : r.revisions.length > 1 ? "Multiple revisions" : "Repeated references"}</td><td>${r.references.map(refButton).join(" ")}<div class="tiny">${esc([...new Set(r.references.map((e) => e.section))].join(" / "))}</div></td></tr>`,
    )
    .join("");
  return `<details open><summary>Local structural / architectural references — ${Number(result.pages_reviewed)} pages</summary><p class="tiny">${esc(result.review)} Run cross-reference again after adding drawings or changing revisions. Scanned text needs manual review; this action uses embedded text.</p><div class="tablewrap"><table><thead><tr><th>Mark</th><th>Review finding</th><th>Source evidence</th></tr></thead><tbody>${levels}${marks || (!levels ? '<tr><td colspan="3">No unique explicit level pairs or repeated section references established.</td></tr>' : "")}</tbody></table></div></details>`;
}
async function pdfPrepareAI() {
  const doc = pdfCurrentDoc();
  if (!doc) return;
  let pages;
  try {
    pages = pdfSelectedPages();
  } catch (e) {
    pdfStatus(e.message);
    return;
  }
  if (!pdfHealth?.ai_ready) {
    pdfStatus(
      "Optional AI is not configured. Use local text/OCR or configure your own key.",
    );
    return;
  }
  try {
    pdfExternalPreview = await pdfRequest("/api/ai/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: doc.file_id,
        pages,
        scope: state.pdfScope || "",
      }),
    });
    pdfExternalPreview.file_id = doc.file_id;
    render();
  } catch (e) {
    pdfStatus("Could not prepare disclosure: " + e.message);
  }
}
async function pdfRunAI() {
  const preview = pdfExternalPreview,
    doc = pdfCurrentDoc();
  if (!preview || !doc || doc.file_id !== preview.file_id) return;
  if (!document.getElementById("pdfExternalConsent")?.checked) {
    pdfStatus(
      "Tick the disclosure confirmation after reviewing the selected information.",
    );
    return;
  }
  if (
    !confirm(
      "Send the displayed page images, text and scope to OpenAI now? API charges may apply.",
    )
  )
    return;
  pdfBusy = true;
  pdfStatus(
    "Sending only the displayed selection to OpenAI for optional analysis…",
  );
  try {
    const data = await pdfRequest("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: doc.file_id,
        pages: preview.pages,
        scope: preview.scope,
        consent: true,
      }),
    });
    const added = pdfAddCandidates(
      [...(data.members || []), ...(data.plates || [])],
      doc,
      "AI vision",
    );
    if (data.summary)
      state.pdfFlags.push(doc.filename + " AI summary: " + data.summary);
    for (const flag of data.flags || [])
      state.pdfFlags.push(doc.filename + " AI: " + flag);
    pdfExternalPreview = null;
    save();
    pdfMessage = `AI returned ${added} new candidate(s). Results are unverified; review and approve before import.`;
  } catch (e) {
    pdfMessage = "Optional AI: " + e.message;
  }
  pdfBusy = false;
  render();
}
function pdfCandidateIssue(c) {
  const qty = Number(c.qty),
    length = Number(c.length_mm);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10000)
    return "Enter an integer quantity from 1 to 10,000";
  if (!Number.isFinite(length) || length <= 0 || length > 100000)
    return "Enter a verified length in millimetres";
  if (c.kind === "member") {
    if (!c.family || !c.section) return "Enter a recognised steel section";
    const kgm = Number(c.kgm);
    if (!Number.isFinite(kgm) || kgm <= 0 || kgm > 1000)
      return "Enter positive supplier-verified kg/m";
  } else {
    for (const key of ["width_mm", "thick_mm"])
      if (!Number.isFinite(Number(c[key])) || Number(c[key]) <= 0)
        return "Enter positive plate width and thickness";
  }
  return "";
}
function pdfApprove(i) {
  const c = state.pdfCandidates[i];
  if (!c || c.imported) return;
  const issue = pdfCandidateIssue(c);
  if (issue) {
    alert(issue + ". Candidate remains pending.");
    return;
  }
  const scope = pdfScopeMarks();
  const prompts = [
    "Approve this candidate only after checking scope, section, quantity, length and mass/dimensions against the source.",
  ];
  if (c.duplicate_mark)
    prompts.push(
      "This mark appears more than once. Confirm it is not a duplicate schedule/reference or superseded revision.",
    );
  if (scope.length && !scope.includes(String(c.mark).toUpperCase()))
    prompts.push(
      "This mark is outside the selected-mark scope suggestion. Confirm it is included in the actual enquiry.",
    );
  if (!confirm(prompts.join("\n\n"))) return;
  c.status = "approved";
  c.approved_at = new Date().toISOString();
  c.approval_invalidated = null;
  c.selected = true;
  save();
  render();
}
function pdfReject(i) {
  const c = state.pdfCandidates[i];
  if (!c || c.imported) return;
  c.status = c.status === "rejected" ? "pending" : "rejected";
  c.selected = false;
  save();
  pdfDuplicateWarnings();
  render();
}
function pdfAddManual() {
  const d = pdfCurrentDoc();
  if (!d) {
    pdfStatus(
      "Upload a drawing to attach a manual candidate to a source page. Manual estimating is also available in Takeoff.",
    );
    return;
  }
  state.pdfCandidates.push({
    kind: "member",
    file_id: d.file_id,
    filename: d.filename,
    page: Number(state.pdfPage),
    origin: "Manual drawing review",
    mark: "",
    family: "",
    section: "",
    qty: null,
    length_mm: null,
    kgm: null,
    finish: "",
    status: "pending",
    selected: false,
    evidence: "Manual candidate — add source reference",
    review: "Enter verified fields and approve",
  });
  save();
  render();
}
function pdfImportSelected() {
  pdfState();
  const rows = state.pdfCandidates.filter((c) => c.selected && !c.imported);
  if (!rows.length) {
    alert("Select approved candidates first.");
    return;
  }
  const issues = rows
    .map((c) =>
      c.status !== "approved"
        ? `${c.mark || c.section || c.label}: approval required`
        : pdfCandidateIssue(c)
          ? `${c.mark || c.section || c.label}: ${pdfCandidateIssue(c)}`
          : "",
    )
    .filter(Boolean);
  if (issues.length) {
    alert("No candidates imported:\n" + issues.join("\n"));
    return;
  }
  const members = rows.filter((c) => c.kind === "member"),
    plates = rows.filter((c) => c.kind === "plate");
  const repeated = members.filter(
    (c) =>
      c.mark &&
      state.members.some(
        (m) => String(m.mark).toUpperCase() === String(c.mark).toUpperCase(),
      ),
  );
  if (
    repeated.length &&
    !confirm(
      "Marks already present in the estimate: " +
        repeated.map((c) => c.mark).join(", ") +
        ". These may be duplicate references or revisions. Import additional quantities anyway?",
    )
  )
    return;
  if (
    !confirm(
      `Import ${members.length} approved member line(s) and ${plates.length} approved plate line(s)?`,
    )
  )
    return;
  if (plates.length && state.plateMode !== "detailed") {
    if (
      !confirm(
        "Replace the provisional 12% plate allowance with the detailed dimensional plate list?",
      )
    )
      return;
    state.plateMode = "detailed";
  }
  let count = 0;
  for (const c of rows) {
    const list = c.kind === "member" ? state.members : state.plates;
    if (list.some((r) => r.sourceKey === pdfCandidateKey(c))) continue;
    const doc = state.pdfFiles.find((d) => d.file_id === c.file_id) || {};
    const source = {
      sourceFile: c.filename,
      sourceFileId: c.file_id,
      sourcePage: c.page,
      sourceDrawing: doc.drawing_number || "",
      sourceRevision: doc.revision || "",
      sourceBBox: c.bbox,
      sourceEvidence: c.evidence,
      sourceKey: pdfCandidateKey(c),
      sourceApproval: c.approved_at,
    };
    if (c.kind === "member")
      list.push({
        ...newMember(),
        mark: c.mark || "",
        family: c.family,
        section: c.section,
        kgm: Number(c.kgm),
        qty: Number(c.qty),
        length: Number(c.length_mm),
        finish: c.finish || state.project.finish,
        process: "saw",
        cuts: 1,
        fabEach: "",
        efficiency: 100,
        ...source,
      });
    else
      list.push({
        ...newPlate(),
        label: c.label || "PL",
        length: Number(c.length_mm),
        width: Number(c.width_mm),
        thick: Number(c.thick_mm),
        qty: Number(c.qty),
        ...source,
      });
    c.imported = true;
    c.status = "imported";
    c.selected = false;
    count++;
  }
  save();
  emailEdit = null;
  pdfStatus(
    `Imported ${count} approved line(s). Source drawing, page, revision and approval are retained.`,
  );
  showTab("Takeoff");
}
function pdfRemoveUnimported() {
  if (
    !confirm(
      "Remove unimported drawing candidates? Existing estimate members remain.",
    )
  )
    return;
  state.pdfCandidates = state.pdfCandidates.filter((c) => c.imported);
  save();
  pdfStatus("Unimported candidates cleared.");
}
function pdfMemberCandidateRow(c, i) {
  const locked = c.imported ? "disabled" : "";
  const input = (key, val, type = "text", width = "80px") =>
    `<input aria-label="${esc(key)} for ${esc(c.mark || c.label || "candidate")}" class="cellInput" style="width:${width}" type="${type}" ${locked} value="${esc(val ?? "")}" onchange="pdfEdit(${i},'${key}',this.value)">`;
  const mass =
    c.kind === "member"
      ? input("kgm", c.kgm, "number")
      : input("thick_mm", c.thick_mm, "number");
  const weight =
    c.kind === "member" &&
    Number(c.qty) > 0 &&
    Number(c.length_mm) > 0 &&
    Number(c.kgm) > 0
      ? (
          ((Number(c.qty) * Number(c.length_mm)) / 1000) *
          Number(c.kgm)
        ).toFixed(1) + " kg"
      : "—";
  const scope = pdfScopeMarks(),
    scopeNote = scope.length
      ? scope.includes(String(c.mark).toUpperCase())
        ? "Selected-mark scope suggestion"
        : "Outside selected-mark suggestion"
      : "Scope needs review";
  const finishOptions = ["", "Raw", "Primed", "HDG", "Powder"]
    .map(
      (v) =>
        `<option value="${v}" ${v === (c.finish || "") ? "selected" : ""}>${v || "Unspecified"}</option>`,
    )
    .join("");
  const rl = c.rl_suggestion
    ? `<div class="pdfWarning">RL difference suggestion: ${Number(c.rl_suggestion.suggested_length_mm)} mm. ${esc(c.rl_suggestion.review)}</div>`
    : "";
  return `<tr class="${pdfFocused === i ? "pdfFocused" : ""} ${c.status === "rejected" ? "pdfRejected" : ""}"><td><input aria-label="Select ${esc(c.mark || "candidate")} for import" type="checkbox" ${c.selected ? "checked" : ""} ${c.imported || c.status !== "approved" ? "disabled" : ""} onchange="pdfEdit(${i},'selected',this.checked)"></td><td>${input(c.kind === "plate" ? "label" : "mark", c.kind === "plate" ? c.label : c.mark, "text", "65px")}<div class="tiny">${esc(c.origin || "")} · ${esc(c.status || "pending")}</div><button class="btn small" onclick="pdfFocus(${i})">Page ${Number(c.page) || 1}</button></td>
  <td>${c.kind === "member" ? input("section", c.section, "text", "145px") : "Plate"}<div class="tiny">${esc(scopeNote)}</div>${c.duplicate_mark ? '<div class="pdfWarning">Duplicate mark / revision check</div>' : ""}${c.cross_reference_conflict ? '<div class="pdfWarning">Section / revision conflict — establish controlling drawing</div>' : ""}${c.approval_invalidated ? `<div class="pdfWarning">${esc(c.approval_invalidated)}</div>` : ""}</td><td>${input("qty", c.qty, "number", "55px")}</td><td>${input("length_mm", c.length_mm, "number", "85px")}<div class="tiny">${esc(c.length_status || "Verify length")}</div>${c.suggested_length_mm ? `<div class="pdfWarning">Unconfirmed: ${Number(c.suggested_length_mm)} mm</div>` : ""}</td><td>${mass}<div class="tiny">${c.kind === "member" ? "kg/m" : "mm thick"}</div>${c.kind === "member" ? `<button class="btn small" ${locked} onclick="pdfUseSectionDatabase(${i})">Use database</button>` : ""}</td><td>${c.kind === "member" ? `<select aria-label="Candidate finish" ${locked} onchange="pdfEdit(${i},'finish',this.value)">${finishOptions}</select><div class="tiny">${weight}</div>` : input("width_mm", c.width_mm, "number") + " mm wide"}</td><td><div class="tiny">${esc(c.review || "Verify source")}</div>${rl}<details><summary>Evidence</summary><div class="tiny">${esc(c.evidence || "No copied source text")}</div></details>${!c.imported ? `<button class="btn small" onclick="pdfApprove(${i})">Approve</button> <button class="btn small" onclick="pdfReject(${i})">${c.status === "rejected" ? "Restore" : "Reject"}</button>` : "Imported"}</td></tr>`;
}
function pdfExternalHTML() {
  if (!pdfExternalPreview) return "";
  const p = pdfExternalPreview;
  return `<div class="notice pdfDisclosure"><h3>Review information before external analysis</h3><p>${esc(p.disclosure)}</p><p><b>Destination:</b> ${esc(p.destination)} · <b>Model:</b> ${esc(p.model)}</p><p><b>Scope:</b> ${esc(p.scope || "[Scope unconfirmed]")}</p><div class="pdfPreviewImages">${p.images.map((i) => `<div><b>Page ${i.page}</b><img alt="Selected external analysis page ${i.page}" src="${esc(i.preview_url)}"></div>`).join("")}</div>${p.text.map((t) => `<details><summary>Extracted text transmitted from page ${t.page}</summary><pre>${esc(t.text || "[No selectable text]")}</pre></details>`).join("")}<label><input id="pdfExternalConsent" type="checkbox"> I reviewed these selected images, extracted text and scope and authorise sending them to OpenAI.</label><p><button class="btn primary" ${pdfBusy ? "disabled" : ""} onclick="pdfRunAI()">Confirm and send selected information</button><button class="btn" onclick="pdfExternalPreview=null;render()">Cancel</button></p></div>`;
}
function renderPdfReader() {
  pdfRememberViewport();
  pdfState();
  pdfDuplicateWarnings();
  const doc = pdfCurrentDoc();
  const viewKey = pdfCalibrationKey();
  pdfRenderedViewKey = viewKey;
  setTimeout(() => {
    if (pdfRenderedViewKey !== viewKey) return;
    const box = document.getElementById("pdfViewport"),
      position = pdfViewportScroll[viewKey];
    if (box && position) {
      box.scrollLeft = position.left;
      box.scrollTop = position.top;
    }
  }, 0);
  const visible = state.pdfCandidates
    .map((c, i) => ({ c, i }))
    .filter((x) => !doc || x.c.file_id === doc.file_id);
  const selected = state.pdfCandidates.filter(
    (c) => c.selected && !c.imported && c.status === "approved",
  ).length;
  const rows = visible.map(({ c, i }) => pdfMemberCandidateRow(c, i)).join("");
  const candidates = `<div class="pdfCandidatePanel"><h3>Candidate takeoff — ${visible.length} reference(s)</h3><p class="tiny">Edit → inspect source → Approve / Reject → import. Missing values stay empty. Editing an approved line resets approval.</p><div class="row"><button class="btn primary" ${!selected ? "disabled" : ""} onclick="pdfImportSelected()">Import ${selected} approved line(s)</button><button class="btn" onclick="pdfAddManual()">Add manual candidate</button><button class="btn small" onclick="pdfRemoveUnimported()">Clear unimported</button></div><div class="tablewrap pdfCandidateTable"><table><thead><tr><th>Import</th><th>Mark / source</th><th>Section</th><th>Qty</th><th>Length mm</th><th>Mass / thick.</th><th>Finish / weight</th><th>Review</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No candidates. Add one manually or run local OCR on a selected page.</td></tr>'}</tbody></table></div></div>`;
  let viewer = "";
  if (doc) {
    const docs = state.pdfFiles
      .map(
        (d) =>
          `<option value="${esc(d.file_id)}" ${d.file_id === doc.file_id ? "selected" : ""}>${esc(d.filename)} · ${esc(d.drawing_number || "drawing no?")} · rev ${esc(d.revision || "?")}</option>`,
      )
      .join("");
    const pageOptions = Array.from(
      { length: doc.pages },
      (_, i) =>
        `<option value="${i + 1}" ${i + 1 === Number(state.pdfPage) ? "selected" : ""}>Page ${i + 1}</option>`,
    ).join("");
    viewer = `<div class="pdfDrawing" id="pdfImagePanel"><div class="row"><select aria-label="Drawing file" onchange="pdfSelectFile(this.value)">${docs}</select><button class="btn small" onclick="pdfGoPage(Number(state.pdfPage)-1)">Previous</button><select aria-label="Drawing page" onchange="pdfGoPage(this.value)">${pageOptions}</select><button class="btn small" onclick="pdfGoPage(Number(state.pdfPage)+1)">Next</button></div><div class="row pdfToolbar"><button class="btn small" onclick="pdfSetZoom(pdfZoom-.25)">−</button><span>${Math.round(pdfZoom * 100)}%</span><button class="btn small" onclick="pdfSetZoom(pdfZoom+.25)">+</button><button class="btn small" onclick="pdfSetZoom(1)">Fit width</button>${[
      ["pan", "Pan"],
      ["calibrate", "Calibrate"],
      ["measure", "Measure"],
      ["note", "Note"],
    ]
      .map(
        ([tool, label]) =>
          `<button class="btn small ${pdfTool === tool ? "primary" : ""}" onclick="pdfSetTool('${tool}')">${label}</button>`,
      )
      .join(
        "",
      )}<button class="btn small" onclick="pdfClearPageMarkups()">Clear marks</button></div><p class="tiny">${state.pdfCalibrations[pdfCalibrationKey()] ? "Page calibrated. Measurements are provisional." : "Calibrate each page against an explicit dimension before measuring."} ${pdfTool === "pan" ? "Drag to pan." : "Click drawing points."}</p><div id="pdfViewport" class="pdfViewport" onpointerdown="pdfPanStart(event)"><div class="pdfCanvas pdfDrawingStage" style="width:${pdfZoom * 100}%;cursor:${pdfTool === "pan" ? "grab" : "crosshair"}" onclick="pdfDrawingClick(event)"><img id="pdfDrawingImage" draggable="false" alt="Drawing page ${Number(state.pdfPage)}" src="/api/page/${esc(doc.file_id)}/${Number(state.pdfPage)}">${pdfHighlightHTML(doc)}${pdfOverlayHTML(doc)}</div></div><div class="two pdfMetadata"><div class="field"><label>Drawing number (verify)</label><input value="${esc(doc.drawing_number || "")}" onchange="pdfEditDoc('drawing_number',this.value)"></div><div class="field"><label>Drawing revision (verify)</label><input value="${esc(doc.revision || "")}" onchange="pdfEditDoc('revision',this.value)"></div></div><p class="tiny">Highlight follows the source PDF text rectangle. A repeated mark on a new drawing/revision remains a separate reference requiring duplicate review.</p></div>`;
  }
  const flags = state.pdfFlags
    .slice(-15)
    .reverse()
    .map((f) => `<li>${esc(f)}</li>`)
    .join("");
  const scope = pdfScopeMarks();
  return (
    section(
      "Drawing review & assisted takeoff",
      "Digital text and optional local OCR keep drawings on this computer. Candidates need manual approval before they affect an estimate.",
      `<div class="notice"><b>Reader:</b> ${pdfHealth?.status === "offline" ? "Start the local server to use drawings." : esc(pdfMessage)}</div><div class="two"><div class="field"><label>Drawings / photographs — PDF, PNG, JPG; 35 MB / 150 pages</label><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple onchange="pdfUploadFiles(event)" ${pdfBusy ? "disabled" : ""}></div><div class="field"><label>Customer email / requested scope</label><textarea placeholder="For example: quote only B1 and C1 in HDG" onchange="pdfUpdateScope(this.value);render()">${esc(state.pdfScope)}</textarea><span class="hint">${scope.length ? "Selected-mark suggestions: " + esc(scope.join(", ")) + ". Verify exclusions and scope manually." : "No exclusive mark list established. Review which candidates belong to the enquiry."}</span></div></div><div class="pdfWorkspace">${viewer}${candidates}</div>`,
    ) +
    section(
      "Local OCR & optional external AI",
      "Text extraction has no API cost. Local OCR requires Tesseract installed on this computer. Optional AI requires your own separately billed API account.",
      `<div class="two"><div><div class="field"><label>Selected page numbers (comma separated)</label><input value="${esc(pdfAIPagesValue)}" oninput="pdfSetPages(this.value)" placeholder="1,2"></div><p class="tiny">Local OCR: ${pdfHealth?.ocr_available ? "Tesseract available" : "Tesseract unavailable; install optionally for scans"}. Up to 2 pages per OCR operation.</p><button class="btn" ${pdfBusy || !doc ? "disabled" : ""} onclick="pdfRunOCR()">Run local OCR</button> <button class="btn" ${pdfBusy || !doc ? "disabled" : ""} onclick="pdfCrossReference()">Cross-reference local drawings</button><p class="tiny">No dimensions are inferred from drawing scale or unlabelled numbers. Provisional RL differences only appear when matching column top and bottom RLs are explicit; verify connection conditions.</p></div><div><p class="tiny">${pdfHealth?.ai_ready ? "Optional AI key configured in server memory." : "Optional AI key absent. Core takeoff works without it."}</p><div class="field"><label>OpenAI API key — optional, stored in server memory only</label><input type="password" id="pdfKeyInput" autocomplete="off" placeholder="sk-…"></div><div class="row"><button class="btn small" onclick="pdfConfigureKey()">Configure key</button><button class="btn small" onclick="pdfClearKey()">Clear key</button><button class="btn primary" ${pdfBusy || !doc ? "disabled" : ""} onclick="pdfPrepareAI()">Preview selected information for AI</button></div><p class="tiny">Up to 4 selected images, their extracted text and your scope are disclosed before you confirm transmission. No background external analysis.</p></div></div>${pdfExternalHTML()}${pdfCrossReferenceHTML()}${flags ? `<details><summary>Drawing analysis notes</summary><ul>${flags}</ul></details>` : ""}`,
    )
  );
}
const pdfStyle = document.createElement("style");
pdfStyle.textContent = `
.pdfWorkspace{display:grid;grid-template-columns:minmax(360px,1fr) minmax(560px,1.15fr);gap:16px;margin-top:20px;align-items:start}.pdfDrawing{min-width:0}.pdfViewport{height:650px;overflow:auto;background:#e2e8f0;border:1px solid #bac9d8;border-radius:8px;touch-action:none}.pdfDrawingStage{position:relative;border:0;border-radius:0;overflow:visible;max-width:none!important}.pdfDrawingStage img{width:100%;height:auto;user-select:none;pointer-events:none;max-width:none}.pdfToolbar{gap:6px;margin-top:10px;flex-wrap:wrap}.pdfMeasureOverlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}.pdfNote{position:absolute;background:#fff2ad;color:#4b3c00;padding:4px;border:1px solid #d4ac35;font-size:11px;line-height:1.25;max-width:160px;pointer-events:none}.pdfMetadata{margin-top:12px}.pdfCandidatePanel{min-width:0}.pdfCandidateTable{max-height:825px;overflow:auto;margin-top:12px}.pdfCandidateTable table{min-width:1040px;font-size:12px}.pdfCandidateTable th{position:sticky;top:0;background:#eaf0f7;z-index:2}.pdfCandidateTable td{vertical-align:top}.pdfCandidateTable td:last-child{min-width:230px}.pdfCandidateTable .cellInput{max-width:none}.pdfWarning{font-size:11px;color:#975308;margin:5px 0}.pdfRejected{opacity:.52}.pdfFocused{background:#fff4db!important}.pdfPreviewImages{display:flex;gap:10px;overflow:auto;margin-bottom:12px}.pdfPreviewImages img{max-height:250px;max-width:340px;display:block}.pdfDisclosure pre{white-space:pre-wrap;max-height:200px;overflow:auto;font-size:11px}.pdfDisclosure label{display:block;margin-top:16px}.pdfDisclosure input[type=checkbox]{width:auto;margin-right:6px}@media(max-width:1250px){.pdfWorkspace{grid-template-columns:1fr}.pdfViewport{height:600px}.pdfCandidateTable{max-height:650px}}
`;
document.head.appendChild(pdfStyle);
setTimeout(pdfCheckHealth, 250);

"use strict";
let calculationCache = null,
  workspaceSettings = { rates: {}, sections: [], assemblies: [] };
let projectList = [],
  projectMeta = null,
  renderSequence = 0,
  saveTimer = null,
  saveQueue = Promise.resolve(),
  toastTimer;
try {
  projectMeta = JSON.parse(
    localStorage.getItem("steeltakeoff_current") || "null",
  );
} catch (_) {}
const tabLabels = {
  Dashboard: "Overview & projects",
  Project: "Enquiry & scope",
  "PDF / AI": "Drawings & AI takeoff",
  Takeoff: "Material takeoff",
  "Stock plan": "Steel stock nesting",
  Plates: "Plates & nesting",
  Costing: "Cutting & fabrication",
  Finishing: "Finishing & delivery",
  Review: "Costing & profit",
  Email: "Reports & quotation",
  Settings: "Settings & rates",
};
async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let data;
    try {
      data = await response.json();
    } catch (_) {
      data = { detail: response.statusText };
    }
    const error = Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function notify(message, isError = false) {
  let node = $("workspaceToast");
  if (!node) {
    node = document.createElement("div");
    node.id = "workspaceToast";
    document.body.appendChild(node);
  }
  node.className = "toast" + (isError ? " error" : "");
  node.setAttribute("role", "status");
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 7000);
}
function status(message, pending = false) {
  const node = $("saveStatus");
  node.textContent = message;
  node.classList.toggle("pending", pending);
}
function normalise(data) {
  const result = {
    ...blank(),
    ...data,
    project: { ...blank().project, ...(data.project || {}) },
  };
  result.project.boltEnabled = String(result.project.boltEnabled) !== "false";
  return result;
}
save = function () {
  try {
    localStorage.setItem("steeltakeoff_v2", JSON.stringify(state));
    localStorage.setItem("steeltakeoff_dirty", "true");
  } catch (_) {
    notify("Browser recovery storage is full. Use Save project.", true);
  }
  status("Unsaved changes", true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistProject(false).catch(() => {});
  }, 1200);
};
async function persistProject(showMessage = true) {
  clearTimeout(saveTimer);
  saveTimer = null;
  const snapshot = JSON.parse(JSON.stringify(state));
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      status("Saving locally…", true);
      const payload = { state: snapshot };
      if (projectMeta?.id) {
        payload.id = projectMeta.id;
        payload.expected_revision = projectMeta.revision;
      }
      try {
        const result = await api("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        projectMeta = { id: result.id, revision: result.revision };
        localStorage.setItem(
          "steeltakeoff_current",
          JSON.stringify(projectMeta),
        );
        if (JSON.stringify(state) === JSON.stringify(snapshot))
          localStorage.removeItem("steeltakeoff_dirty");
        status(
          JSON.stringify(state) === JSON.stringify(snapshot)
            ? "Saved locally · revision " + result.revision
            : "Unsaved changes",
          JSON.stringify(state) !== JSON.stringify(snapshot),
        );
        if (showMessage) notify("Project saved to the local SQLite database.");
        projectList = (await api("/api/projects")).projects;
        return result;
      } catch (error) {
        status("Save failed · recovery copy in browser", true);
        notify(
          error.status === 409
            ? "This estimate changed in another window. Your browser recovery copy is preserved. Open the latest project or use Save current as copy on the dashboard."
            : "Could not save project: " + error.message,
          true,
        );
        throw error;
      }
    });
  return saveQueue;
}
function newProjectState() {
  const result = blank(),
    r = workspaceSettings.rates || {};
  const values = {
    fabHoursT: "fabrication_hours_per_tonne",
    installerMargin: "installation_margin",
    draftMargin: "subcontract_margin",
    powderMargin: "subcontract_margin",
    supplyOnlyMargin: "material_supply_margin",
    plateLaserHours: "plate_laser_min_hours",
  };
  for (const [field, rate] of Object.entries(values))
    if (r[rate] !== undefined) result[field] = r[rate];
  for (const [field, rate] of Object.entries({
    target: "target_margin",
    deliverySell: "own_delivery_sell",
    transportMargin: "subcontract_margin",
  }))
    if (r[rate] !== undefined) result.project[field] = r[rate];
  return result;
}
async function newProject() {
  try {
    if (
      saveTimer ||
      projectMeta ||
      JSON.stringify(state) !== JSON.stringify(blank())
    )
      await persistProject(false);
    state = newProjectState();
    projectMeta = null;
    localStorage.removeItem("steeltakeoff_current");
    emailEdit = null;
    save();
    showTab("Project");
  } catch (_) {}
}
async function openSavedProject(id) {
  try {
    if (saveTimer) await persistProject(false);
    await saveQueue;
    const data = await api("/api/projects/" + encodeURIComponent(id));
    state = normalise(data.state);
    if (data.result?.effectiveRates)
      state.rates = { ...data.result.effectiveRates };
    if (Array.isArray(data.result?.resolvedMembers))
      state.members = structuredClone(data.result.resolvedMembers);
    projectMeta = { id: data.id, revision: data.revision };
    localStorage.setItem("steeltakeoff_v2", JSON.stringify(state));
    localStorage.setItem("steeltakeoff_current", JSON.stringify(projectMeta));
    emailEdit = state.emailDraft ?? null;
    status("Saved locally · revision " + data.revision);
    showTab("Project");
  } catch (error) {
    notify(error.message, true);
  }
}
async function showRevisions(id) {
  try {
    const data = await api(
      "/api/projects/" + encodeURIComponent(id) + "/revisions",
    );
    $("revisionPanel").innerHTML = section(
      "Estimate revisions",
      "Restore an earlier revision as a new revision. Existing history is retained.",
      `<div class="project-list">${data.revisions.map((r) => `<div class="project-card"><div>Revision ${r.revision} · ${esc(r.saved_at || r.created_at || r.updated_at || "")}</div><button class="btn small" data-project="${esc(id)}" data-revision="${r.revision}" onclick="restoreRevision(this.dataset.project,Number(this.dataset.revision))">Restore revision</button></div>`).join("")}</div>`,
    );
  } catch (error) {
    notify(error.message, true);
  }
}
async function restoreRevision(id, revision) {
  if (
    !confirm(
      "Use this earlier revision as the current estimate? Your current estimate will be saved first.",
    )
  )
    return;
  try {
    const data = await api(
      "/api/projects/" + encodeURIComponent(id) + "/revisions/" + revision,
    );
    if (
      saveTimer ||
      projectMeta ||
      JSON.stringify(state) !== JSON.stringify(blank())
    )
      await persistProject(false);
    const latest = await api("/api/projects/" + encodeURIComponent(id));
    projectMeta = { id, revision: latest.revision };
    state = normalise(data.state);
    if (data.result?.effectiveRates)
      state.rates = { ...data.result.effectiveRates };
    if (Array.isArray(data.result?.resolvedMembers))
      state.members = structuredClone(data.result.resolvedMembers);
    emailEdit = state.emailDraft ?? null;
    save();
    await persistProject();
    showTab("Project");
  } catch (error) {
    notify(error.message, true);
  }
}
function renderDashboard(x) {
  const list = projectList
    .map(
      (p) =>
        `<div class="project-card"><div><h3>${esc(p.name || "Untitled enquiry")}</h3><p>${esc(p.client || "Customer not entered")} · Rev ${p.revision} · ${esc((p.updated_at || "").slice(0, 16).replace("T", " "))} UTC</p></div><div class="row"><button class="btn primary small" data-id="${esc(p.id)}" onclick="openSavedProject(this.dataset.id)">Open estimate</button><button class="btn small" data-id="${esc(p.id)}" onclick="showRevisions(this.dataset.id)">History</button></div></div>`,
    )
    .join("");
  return `<div class="dashboard-grid"><div>${section("Your estimates", "Projects, drawings and rate overrides stay on this computer.", `<div class="sticky-actions"><button class="btn primary" onclick="newProject()">+ New enquiry</button><button class="btn" onclick="document.getElementById('import').click()">Import V1 / V2 JSON</button><button class="btn" onclick="saveAsCopy()">Save current as copy</button></div><div class="project-list">${list || '<div class="empty-state">No saved estimates yet. Start an enquiry or open your existing project JSON.</div>'}</div>`)}<div id="revisionPanel"></div></div><div>${section("From enquiry to quotation", "A review step connects each part of your estimate.", `<div class="flow"><div><strong>01 · Confirm customer scope</strong><small>Record inclusions, exclusions and drawing revisions.</small></div><div><strong>02 · Build the verified takeoff</strong><small>Review PDF candidates or add members manually.</small></div><div><strong>03 · Plan purchasing and fabrication</strong><small>Allocate stock, plates, processes and subcontract quotes.</small></div><div><strong>04 · Review profit and issue quotation</strong><small>Resolve missing costs. Keep internal reports private.</small></div></div><div class="sticky-actions"><button class="btn" onclick="loadExample()">Load labelled example</button></div>`)}${section("Backup & restoration", "Backups include the database and uploaded drawings. Keep a copy outside this folder.", `<button class="btn" onclick="downloadBackup()">Download full backup (.zip)</button><div class="field" style="margin-top:14px"><label for="restoreBackup">Restore a SteelTakeoff backup</label><input id="restoreBackup" type="file" accept=".zip" onchange="restoreBackup(event)"></div>`)}</div></div>`;
}
async function downloadBackup() {
  try {
    await persistProject(false);
    window.location.href = "/api/backup";
  } catch (_) {}
}
async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (
    !confirm(
      "Restore this backup? The current database and drawings will be preserved in a local recovery backup.",
    )
  ) {
    event.target.value = "";
    return;
  }
  try {
    await persistProject(false);
    clearTimeout(saveTimer);
    saveTimer = null;
    await saveQueue.catch(() => {});
    const form = new FormData();
    form.append("file", file);
    await api("/api/restore", { method: "POST", body: form });
    state = blank();
    projectMeta = null;
    localStorage.removeItem("steeltakeoff_v2");
    localStorage.removeItem("steeltakeoff_current");
    workspaceSettings = await api("/api/settings");
    projectList = (await api("/api/projects")).projects;
    notify("Backup restored. Open a project from the dashboard.");
    showTab("Dashboard");
  } catch (error) {
    notify(error.message, true);
  }
  event.target.value = "";
}
async function saveAsCopy() {
  clearTimeout(saveTimer);
  saveTimer = null;
  await saveQueue.catch(() => {});
  projectMeta = null;
  localStorage.removeItem("steeltakeoff_current");
  try {
    await persistProject();
    if (tab === "Dashboard") render();
  } catch (_) {}
}
async function loadExample() {
  try {
    if (
      saveTimer ||
      projectMeta ||
      JSON.stringify(state) !== JSON.stringify(blank())
    ) {
      if (!confirm("Save the current estimate and load the labelled example?"))
        return;
      await persistProject(false);
    }
    projectMeta = null;
    localStorage.removeItem("steeltakeoff_current");
    state = blank();
    loadSample();
  } catch (_) {}
}
newMember = function () {
  return {
    id: Date.now() + Math.random(),
    mark: "",
    family: "UB",
    section: "",
    kgm: "",
    qty: 1,
    length: "",
    finish: state.project.finish,
    process: "saw",
    heavy: false,
    cuts: 1,
    fabEach: "",
    efficiency: 100,
    stocks: "",
    confirmed: false,
  };
};
const baseEditRow = editRow;
editRow = function (list, index, field, value) {
  if (list === "members" && field === "section") {
    const row = state.members[index];
    const section = String(value).replace(/\s+/g, "").toUpperCase();
    const cat = workspaceSettings.sections.find(
      (s) =>
        String(s.designation).replace(/\s+/g, "").toUpperCase() === section,
    );
    const mass = section.match(/^\d+(?:UB|UC)(\d+(?:\.\d+)?)$/);
    row.kgm = cat ? cat.kgm : mass ? Number(mass[1]) : "";
    row.stocks = "";
    delete row.supplierRate;
    delete row.supplier_price;
    delete row.supplier_rate;
    if (cat) {
      row.family = cat.family;
      row.stocks = (cat.stock_lengths || []).join(",");
      if (cat.supplier_price != null) row.supplierRate = cat.supplier_price;
    }
    row.confirmed = false;
  }
  if (list === "members" && ["length", "qty", "kgm"].includes(field))
    state.members[index].confirmed = false;
  baseEditRow(list, index, field, value);
};
const baseRenderProject = renderProject;
renderProject = function (x) {
  return (
    baseRenderProject(x) +
    section(
      "Enquiry and quotation scope",
      "Keep the customer request separate from internal allowances.",
      `<div class="formgrid">${inputField("Customer contact", "project.contact", state.project.contact || "")}${inputField("Lead time", "project.leadTime", state.project.leadTime || "")}${inputField("Drawing / enquiry revision", "project.revision", state.project.revision || "")}</div><div class="two scopebox"><div class="field"><label>Confirmed scope</label><textarea onchange="setField('project.quoteScope',this.value)">${esc(state.project.quoteScope || "")}</textarea></div><div class="field"><label>Inclusions and exclusions</label><textarea onchange="setField('project.exclusions',this.value)">${esc(state.project.exclusions || "")}</textarea></div></div>`,
    )
  );
};
const baseRenderMembers = renderMembers;
renderMembers = function (x) {
  let body = baseRenderMembers(x);
  body = body.replace(
    '</div><div class="tablewrap">',
    `</div>${typeof renderSectionPicker === "function" ? renderSectionPicker() : ""}${typeof renderAssemblyPicker === "function" ? renderAssemblyPicker() : ""}<div class="tablewrap">`,
  );
  return (
    body +
    renderProcurementSettings(x) +
    section(
      "Dimension verification",
      "Production mode uses kerf without estimating tolerance and requires confirmed member dimensions.",
      `<div class="formgrid">${selectField(
        "Nesting mode",
        "project.nestingMode",
        state.project.nestingMode || "estimate",
        [
          ["estimate", "Preliminary estimate"],
          ["production", "Production checks"],
        ],
      )}</div><p><label><input type="checkbox" ${state.project.stockLengthsConfirmed ? "checked" : ""} onchange="setField('project.stockLengthsConfirmed',this.checked)"> Stock availability, actual stock lengths and cutting kerf confirmed with workshop</label></p><div class="production-controls">${state.members.map((r, i) => `<label style="display:block;margin:7px 0"><input type="checkbox" ${r.confirmed ? "checked" : ""} onchange="editRow('members',${i},'confirmed',this.checked)"> Confirm ${esc(r.mark || r.section || "unnamed member")} quantity, length and unit mass against source</label>`).join("") || '<span class="muted">Add members to verify dimensions.</span>'}</div>`,
    )
  );
};

function renderProcurementSettings(x) {
  const sections = [
    ...new Set(state.members.map((r) => r.section).filter(Boolean)),
  ];
  return section(
    "Section purchasing availability",
    "Confirm supplier cut availability for each exact section. Overrides apply to this estimate and are retained in its revisions.",
    sections.length
      ? `<div class="tablewrap"><table><thead><tr><th>Section</th><th>Supplier cut sizes available</th><th>Cut-size lengths (m)</th><th>Full-stock buying ($/t)</th><th>Supplier cut buying ($/t)</th></tr></thead><tbody>${sections
          .map((name, i) => {
            const data = state.sectionSettings?.[name] || {};
            return `<tr><td>${esc(name)}</td><td><select aria-label="Supplier cuts for ${esc(name)}" onchange="setProcurement(${i},'supplierCuts',this.value==='true')"><option value="true" ${data.supplierCuts !== false ? "selected" : ""}>Available — confirm with supplier</option><option value="false" ${data.supplierCuts === false ? "selected" : ""}>Unavailable</option></select></td><td><input class="cellInput" value="${esc(Array.isArray(data.supplierCutLengths) ? data.supplierCutLengths.join(",") : data.supplierCutLengths || "1.5,3,4.5,6,7.5")}" onchange="setProcurement(${i},'supplierCutLengths',this.value)"></td><td><input class="cellInput" type="number" min="0" value="${esc(data.rate ?? "")}" placeholder="Default" onchange="setProcurement(${i},'rate',this.value)"></td><td><input class="cellInput" type="number" min="0" value="${esc(data.supplier_cut_rate ?? "")}" placeholder="${x.rates.supplier_cut_per_tonne}" onchange="setProcurement(${i},'supplier_cut_rate',this.value)"></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<p class="muted">Add section sizes to configure availability.</p>',
  );
}
function setProcurement(index, key, value) {
  const names = [
      ...new Set(state.members.map((r) => r.section).filter(Boolean)),
    ],
    name = names[index];
  if (!name) return;
  state.sectionSettings ||= {};
  state.sectionSettings[name] ||= {};
  if (value === "") delete state.sectionSettings[name][key];
  else state.sectionSettings[name][key] = value;
  if (key === "rate")
    for (const member of state.members.filter((m) => m.section === name)) {
      if (value === "") delete member.supplierRate;
      else member.supplierRate = value;
    }
  save();
  render();
}

const baseRenderStock = renderStock;
renderStock = function (x) {
  return (
    section(
      "Purchasing totals",
      "Purchased and net weights stay separate.",
      `<div class="statstrip"><div>Net allocated members <b>${fmt(x.purchase.net)} kg</b></div><div>Gross purchased <b>${fmt(x.purchase.gross)} kg</b></div><div>Offcuts / unused stock <b>${fmt(x.purchase.waste)} kg</b></div><div>Stock material cost <b>${money(x.purchase.cost)}</b></div></div>`,
    ) +
    baseRenderStock(x).replace(
      "Supplier cut size: $2,050/t + $50 supplier cut charge included.",
      `Supplier cut rate: ${money(x.rates.supplier_cut_per_tonne)}/t + ${money(x.rates.supplier_cut_operation)} per operation.`,
    )
  );
};
const baseRenderPlates = renderPlates;
renderPlates = function (x) {
  let html = baseRenderPlates(x)
    .replaceAll(
      "Detailed plate list (area-based sheet allowance)",
      "Detailed plates — geometric rectangular packing",
    )
    .replace(
      "Detailed plate sheet quantities are approximated by area in V1; confirm the actual geometric nest before ordering.",
      "Detailed plates use conservative rectangular packing with rotation and a cutting gap; review layouts before ordering.",
    );
  html = html.replace(
    /Reference plate:.*?<\/p>/,
    `Reference plate: 1200×2400×10 mm. Costing reference ${fmt(x.rates.plate_reference_weight)} kg / ${money(x.rates.plate_reference_price)}. Plate laser: ${money(x.rates.plate_laser_cost_per_hour)} cost/hr, ${money(x.rates.plate_laser_sell_per_hour)} sell/hr.</p>`,
  );
  const layouts = x.plateLayouts || x.plate_layouts || [];
  html += section(
    "Plate cutting layout",
    "Rectangular packing is conservative; irregular contours and machine-specific lead-ins need workshop review.",
    `<div class="formgrid">${inputField("Plate cutting gap (mm)", "project.plateGap", state.project.plateGap ?? x.rates.plate_gap_mm, "number")}</div>${
      layouts
        .map((sheet, i) => {
          const sw = sheet.width || sheet.sheet_width || 1200,
            sh = sheet.height || sheet.sheet_height || 2400;
          return `<p>Sheet ${i + 1} · ${sheet.thick || sheet.thickness || ""} mm</p><div class="sheet-diagram" style="aspect-ratio:${sw}/${sh}">${(sheet.parts || sheet.placements || []).map((p) => `<div class="plate-piece" style="left:${(p.x / sw) * 100}%;top:${(p.y / sh) * 100}%;width:${((p.width || p.w) / sw) * 100}%;height:${((p.height || p.h) / sh) * 100}%">${esc(p.label || "Plate")}</div>`).join("")}</div>`;
        })
        .join("") ||
      '<p class="muted">Detailed dimensional plates create a geometric layout. The 12% allowance remains provisional equivalent sheet material.</p>'
    }`,
  );
  return html;
};
function renderFinishing(x) {
  return section(
    "Finishing, delivery and installation",
    "Quantities follow the members and plate allocation. Enter confirmed subcontract quotations; all commercial defaults are editable in Settings.",
    `<div class="statstrip">${Object.entries(x.finishWeights)
      .map(([f, w]) => `<div>${esc(f)}: <b>${fmt(w)} kg</b></div>`)
      .join(
        "",
      )}</div><div class="formgrid" style="margin-top:18px">${inputField("Powder-coating quote ($)", "powderQuote", state.powderQuote, "number")}${inputField("Powder-coating margin (%)", "powderMargin", state.powderMargin, "number")}${inputField("Cold galvanising internal cost ($)", "coldGalvCost", state.coldGalvCost ?? "", "number")}${inputField("Cold galvanising selling charge ($)", "coldGalvSell", state.coldGalvSell ?? "", "number")}${selectField(
      "Delivery",
      "project.delivery",
      state.project.delivery,
      [
        ["none", "No delivery"],
        ["own", "Own truck"],
        ["external", "External quotation"],
      ],
    )}${inputField("Own-truck selling ($)", "project.deliverySell", state.project.deliverySell, "number")}${inputField("Own-truck internal cost ($)", "project.deliveryCost", state.project.deliveryCost, "number")}${inputField("Transport quotation ($)", "project.transportCost", state.project.transportCost, "number")}${inputField("Transport gross margin (%)", "project.transportMargin", state.project.transportMargin, "number")}${state.project.scope === "sfi" ? inputField("Installation quotation ($)", "installerQuote", state.installerQuote, "number") + inputField("Installation margin (%)", "installerMargin", state.installerMargin, "number") : ""}</div><div class="notice">${x.net < 3000 && x.longest < 10000 ? "Own-truck delivery suggested: $100–$150. Confirm its internal cost." : "External transport quotation suggested because weight or longest member reaches the truck limit."}</div>${costTable(x)}`,
  );
}
metrics = function (x) {
  return `<div class="cards"><div class="metric"><label>Net steel weight</label><strong>${fmt(x.net / 1000, 3)} t</strong><small>Members + fabricated plates</small></div><div class="metric"><label>Known internal cost</label><strong>${money(x.totalCost)}</strong><small>${x.cost_complete ? "Costs entered" : "Incomplete estimate · see review flags"}</small></div><div class="metric"><label>Estimated selling price</label><strong>${money(x.totalSell)}</strong><small>Excluding GST</small></div><div class="metric ${x.cost_complete && x.margin >= 24 && x.margin <= 28 ? "positive" : "warning"}"><label>Overall gross margin</label><strong>${x.cost_complete ? fmt(x.margin, 1) + "%" : "Incomplete"}</strong><small>${x.cost_complete ? "Target 24–28%" : "Required costs or inputs are missing"}</small></div></div>`;
};
const baseCostTable = costTable;
costTable = function (x) {
  return baseCostTable(x).replace(
    `<th class="right">${money(x.profit)}</th>`,
    `<th class="right">${x.cost_complete ? money(x.profit) : "Incomplete"}</th>`,
  );
};
renderReport = function (x) {
  const complete = x.cost_complete;
  return section(
    "Cost and profit review",
    "Resolve required costs before relying on profit. Target margins and price-per-tonne bands are advisory.",
    `<div class="formgrid">${inputField("Final supply selling override ($)", "finalSupply", state.finalSupply, "number", "Blank uses calculated selling price.")}${state.project.scope === "sfi" ? inputField("Final installation override ($)", "finalInstall", state.finalInstall, "number") : ""}${inputField("Target gross margin (%)", "project.target", state.project.target, "number")}</div><div class="statstrip"><div>Known internal cost <b>${money(x.totalCost)}</b></div><div>Total sell <b>${money(x.totalSell)}</b></div><div>Gross profit <b>${complete ? money(x.profit) : "Incomplete estimate"}</b></div><div>Margin <b>${complete ? fmt(x.margin) + "%" : "Unverified"}</b></div><div>Supply per tonne <b>${x.net ? money(x.supplySell / (x.net / 1000)) : "—"}</b></div></div>${!complete ? '<div class="notice error">Required costs or member data are missing. Profit is unverified. Enter zero explicitly only when you have confirmed no cost applies.</div>' : ""}${warningBox(x)}<p>${esc(benchmark(x))}</p>${costTable(x)}<div class="sticky-actions"><button class="btn primary" onclick="exportInternal('xlsx')">Internal Excel report</button><button class="btn" onclick="exportInternal('pdf')">Internal PDF report</button><button class="btn" onclick="exportJSON()">Project JSON</button></div>`,
  );
};
async function exportInternal(extension) {
  try {
    await persistProject(false);
    window.location.href =
      "/api/projects/" +
      encodeURIComponent(projectMeta.id) +
      "/report." +
      extension;
  } catch (_) {}
}
buildEmail = function (x) {
  const p = state.project;
  return `Hi ${p.contact || p.client || "[Customer]"},\n\nPlease find our quotation for ${p.name || "[Project]"}${p.address ? " — " + p.address : ""}.\n\nSupply & Fabrication: ${money(x.supplySell)} + GST\n${p.scope === "sfi" ? "Installation: " + money(x.instSell) + " + GST\n" : ""}\nScope: ${p.quoteScope || "[Confirm scope]"}\nFinish: [Confirm finish]\nLead time: ${p.leadTime || "[Enter lead time]"}\nInclusions / exclusions: ${p.exclusions || "[Enter details]"}\n\nPlease let us know if you would like to proceed.\n\nKind regards,\n${p.signature || "SHAHIL KUMAR\nSALES ESTIMATOR\nMascot Steel"}`;
};
const baseRenderQuote = renderQuote;
renderQuote = function (x) {
  if (emailEdit === null) emailEdit = state.emailDraft ?? buildEmail(x);
  return (
    section(
      "Internal reports",
      "These documents include buying prices and profit. Keep them for internal use.",
      `<div class="row"><button class="btn primary" onclick="exportInternal('xlsx')">Download Excel</button><button class="btn" onclick="exportInternal('pdf')">Download PDF</button><button class="btn" onclick="exportJSON()">Export project JSON</button></div>`,
    ) +
    baseRenderQuote(x).replace(
      "emailEdit=buildEmail(calculate());render()",
      "emailEdit=buildEmail(calculate());state.emailDraft=emailEdit;save();render()",
    )
  );
};
importJSON = function (event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (
        !data.project ||
        !Array.isArray(data.members) ||
        !Array.isArray(data.plates)
      )
        throw Error("This is not a SteelTakeoff project.");
      if (saveTimer) await persistProject(false);
      await saveQueue;
      state = normalise(data);
      projectMeta = null;
      localStorage.removeItem("steeltakeoff_current");
      emailEdit = state.emailDraft ?? null;
      save();
      await persistProject();
      showTab("Project");
    } catch (error) {
      notify("Import failed: " + error.message, true);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
};
render = async function () {
  const sequence = ++renderSequence;
  try {
    const snapshot = JSON.stringify(state);
    const result = await api("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (sequence !== renderSequence || snapshot !== JSON.stringify(state))
      return;
    calculationCache = result;
    $("tabs").innerHTML = tabNames
      .map(
        (t) =>
          `<button class="tab ${tab === t ? "active" : ""}" onclick="showTab('${t}')">${esc(tabLabels[t] || t)}</button>`,
      )
      .join("");
    $("metrics").innerHTML = metrics(result);
    const views = {
      Dashboard: () => renderDashboard(result),
      Project: () => renderProject(result),
      "PDF / AI": () => renderPdfReader(),
      Takeoff: () => renderMembers(result),
      "Stock plan": () => renderStock(result),
      Plates: () => renderPlates(result),
      Costing: () => renderCosts(result),
      Finishing: () => renderFinishing(result),
      Review: () => renderReport(result),
      Email: () => renderQuote(result),
      Settings: () => renderSettings(),
    };
    $("view").innerHTML = (views[tab] || views.Dashboard)();
  } catch (error) {
    if (sequence === renderSequence) {
      notify("Calculation unavailable: " + error.message, true);
      $("view").innerHTML = section(
        "Local backend unavailable",
        "Start the application with its launcher and retry.",
        `<p>${esc(error.message)}</p><button class="btn" onclick="render()">Retry</button>`,
      );
    }
  }
};
async function bootWorkspace() {
  try {
    workspaceSettings = await api("/api/settings");
    projectList = (await api("/api/projects")).projects;
    const recovered = localStorage.getItem("steeltakeoff_dirty") === "true";
    status(
      recovered
        ? "Recovered unsaved browser changes"
        : projectMeta
          ? "Saved locally · revision " + projectMeta.revision
          : "New enquiry · not saved",
      recovered,
    );
    if (recovered) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        persistProject(false).catch(() => {});
      }, 1200);
    }
    emailEdit = state.emailDraft ?? null;
    await render();
  } catch (error) {
    notify(error.message, true);
    await render();
  }
}
bootWorkspace();

exportCSV = function () {
  return exportInternal("xlsx");
};
exportReport = function () {
  return exportInternal("pdf");
};

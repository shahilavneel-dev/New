/* Editable local rate, verified section and assembly libraries. */
let settingsSectionEdit = -1;
let settingsAssemblyEdit = -1;
const CATALOG_FAMILIES = [
  "UB",
  "UC",
  "PFC",
  "SHS",
  "RHS",
  "CHS",
  "Pipe",
  "Angle",
  "Flat bar",
];

function settingsData() {
  return {
    rates: workspaceSettings.rates || {},
    sections: Array.isArray(workspaceSettings.sections)
      ? workspaceSettings.sections.map((s) => ({
          ...s,
          designation: s.designation || s.section,
          stock_lengths: s.stock_lengths || s.stocks || [],
          supplier_price: s.supplier_price ?? s.supplier_rate,
        }))
      : [],
    assemblies: Array.isArray(workspaceSettings.assemblies)
      ? workspaceSettings.assemblies.map((a) => ({
          ...a,
          hours: a.hours ?? a.labour_hours,
          labour_hours: a.hours ?? a.labour_hours,
          repeat_efficiency:
            a.repeat_efficiency ??
            (a.efficiency === undefined
              ? 100
              : Number(a.efficiency) <= 1
                ? Number(a.efficiency) * 100
                : Number(a.efficiency)),
        }))
      : [],
  };
}

function settingsRateLabel(key) {
  const labels = {
    structural_stock_per_tonne: "UB / UC / PFC stock ($/t)",
    hollow_stock_per_tonne: "SHS / RHS / pipe / angle stock ($/t)",
    flat_stock_per_tonne: "Flat bar stock ($/t)",
    supplier_cut_per_tonne: "Supplier cut stock ($/t)",
    supplier_cut_operation: "Supplier cut charge ($/operation)",
    saw_standard_per_cut: "Standard saw charge ($/cut)",
    saw_heavy_per_cut: "Heavy saw charge ($/cut)",
    saw_cost_per_hour: "Saw internal cost ($/h)",
    saw_sell_per_hour: "Saw selling rate ($/h)",
    tube_cost_per_hour: "Tube laser internal cost ($/h)",
    tube_sell_per_hour: "Tube laser selling rate ($/h)",
    plate_laser_cost_per_hour: "Plate laser internal cost ($/h)",
    plate_laser_sell_per_hour: "Plate laser selling rate ($/h)",
    fabrication_cost_per_hour: "Fabrication internal cost ($/h)",
    fabrication_sell_per_hour: "Fabrication selling rate ($/h)",
    fabrication_hours_per_tonne: "Default fabrication hours per tonne",
    drafting_cost_per_hour: "Drafting internal cost ($/h)",
    drafting_sell_per_hour: "Drafting selling rate ($/h)",
    drafting_standard_cost_per_tonne: "Standard drafting internal cost ($/t)",
    drafting_standard_sell_per_tonne: "Standard drafting selling rate ($/t)",
    prime_cost_per_hour: "Priming internal cost ($/h)",
    prime_sell_per_hour: "Priming selling rate ($/h)",
    prime_hours_per_tonne: "Priming hours per tonne",
    prime_min_hours: "Minimum priming hours",
    hdg_structural_cost_per_kg: "UB / UC / PFC HDG internal cost ($/kg)",
    hdg_structural_sell_per_kg: "UB / UC / PFC HDG selling rate ($/kg)",
    hdg_other_cost_per_kg: "Other HDG internal cost ($/kg)",
    hdg_other_sell_per_kg: "Other HDG selling rate ($/kg)",
    hdg_min_cost: "Minimum HDG batch internal cost ($)",
    bolts_sell_per_tonne: "Bolts selling allowance ($/t)",
    plate_allowance_percent: "Provisional plates (% of gross member stock)",
    plate_reference_price: "Reference plate price ($)",
    plate_reference_weight: "Reference plate mass (kg)",
    plate_laser_min_hours: "Minimum plate laser hours",
    plate_gap_mm: "Plate nesting separation (mm)",
    steel_density_kg_mm3: "Steel density (kg/mm³)",
    material_sfi_large_margin:
      "Supply / fabricate / install material margin above 3 t (%)",
    material_sfi_small_margin:
      "Supply / fabricate / install material margin up to 3 t (%)",
    material_sf_margin: "Supply / fabricate material margin (%)",
    material_supply_margin: "Supply-only material margin (%)",
    installation_margin: "Default installation gross margin (%)",
    subcontract_margin: "Default subcontract gross margin (%)",
    own_delivery_sell: "Default own-truck delivery price ($)",
    target_margin: "Overall target gross margin (%)",
  };
  return (
    labels[key] ||
    String(key)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function settingsRateFields(rates, prefix) {
  return Object.keys(rates)
    .sort()
    .map(
      (key, i) =>
        `<div class="field"><label for="${prefix}-${i}">${esc(settingsRateLabel(key))}</label><input id="${prefix}-${i}" name="${esc(key)}" type="number" min="${["plate_reference_weight", "saw_sell_per_hour", "steel_density_kg_mm3"].includes(key) ? "0.000000000001" : "0"}" ${key.endsWith("_margin") ? 'max="99.99"' : ""} step="any" required value="${esc(rates[key])}"></div>`,
    )
    .join("");
}

function renderSettings() {
  const data = settingsData();
  const projectOverride = state.rates && typeof state.rates === "object";
  const rates = section(
    "Rate database",
    "All prices are AUD, excluding GST. Changes to default rates affect projects that use current defaults. Snapshot rates below to preserve a project’s pricing.",
    `<form id="settings-rates-form" onsubmit="saveRates(event)"><div class="formgrid">${settingsRateFields(data.rates, "default-rate")}</div><p><button class="btn primary" type="submit">Save default rates</button></p></form><div class="rule"><h3>Project rate overrides</h3><label class="row"><input type="checkbox" ${projectOverride ? "checked" : ""} onchange="toggleProjectRateOverrides(this.checked)"> Use a saved rate snapshot for this project</label><p class="sub">Enabling this copies the current defaults into this estimate. Edit the project’s rates independently, then save the project to keep them with its revisions.</p>${projectOverride ? `<form id="settings-project-rates-form" onsubmit="saveProjectRates(event)"><div class="formgrid">${settingsRateFields({ ...data.rates, ...state.rates }, "project-rate")}</div><p><button class="btn" type="submit">Apply project rates</button></p></form>` : ""}</div>`,
  );
  return (
    rates +
    renderSectionSettings(data.sections) +
    renderAssemblySettings(data.assemblies)
  );
}

function settingsReadRates(form) {
  const rates = {};
  for (const [key, value] of new FormData(form).entries()) {
    const parsed = Number(value);
    if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0)
      throw new Error("Every rate must be a valid number of zero or more.");
    if (key.endsWith("_margin") && parsed >= 100)
      throw new Error("Gross margins must be below 100%.");
    if (
      [
        "plate_reference_weight",
        "saw_sell_per_hour",
        "steel_density_kg_mm3",
      ].includes(key) &&
      parsed <= 0
    )
      throw new Error(`${settingsRateLabel(key)} must be greater than zero.`);
    rates[key] = parsed;
  }
  return rates;
}

async function settingsUpdate(patch) {
  const result = await api("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const updated = result && result.settings ? result.settings : result;
  Object.assign(workspaceSettings, patch);
  if (updated && typeof updated === "object") {
    for (const key of ["rates", "sections", "assemblies"])
      if (updated[key] !== undefined) workspaceSettings[key] = updated[key];
  }
  return result;
}

async function saveRates(event) {
  if (event) event.preventDefault();
  try {
    await settingsUpdate({
      rates: settingsReadRates(document.getElementById("settings-rates-form")),
    });
    notify("Default rates saved.");
    await render();
  } catch (error) {
    notify(error.message || "Unable to save rates.", true);
  }
  return false;
}

async function toggleProjectRateOverrides(enabled) {
  if (enabled)
    state.rates = { ...settingsData().rates, ...(state.rates || {}) };
  else delete state.rates;
  save();
  await render();
  notify(
    enabled
      ? "Current rates copied into this project."
      : "This project now uses current default rates.",
  );
}

async function saveProjectRates(event) {
  if (event) event.preventDefault();
  try {
    state.rates = settingsReadRates(
      document.getElementById("settings-project-rates-form"),
    );
    save();
    await render();
    notify(
      "Project rate overrides applied. Save the project to keep a revision.",
    );
  } catch (error) {
    notify(error.message || "Unable to update project rates.", true);
  }
  return false;
}

function renderSectionSettings(sections) {
  const row = sections[settingsSectionEdit] || {};
  const rows = sections
    .map(
      (s, i) =>
        `<tr data-catalog-search="${esc([s.designation, s.family, s.material, s.source].join(" ").toLowerCase())}"><td><b>${esc(s.designation)}</b></td><td>${esc(s.family)}</td><td>${fmt(Number(s.kgm))}</td><td>${esc((s.stock_lengths || []).join(", "))}</td><td>${s.supplier_price === undefined || s.supplier_price === null || s.supplier_price === "" ? "Default rate" : money(Number(s.supplier_price)) + "/t"}</td><td>${esc(s.material || "")}</td><td>${esc(s.source || "")}</td><td><div class="row"><button class="btn small" onclick="editCatalogSection(${i})">Edit</button><button class="btn small danger" onclick="removeCatalogSection(${i})">Remove</button></div></td></tr>`,
    )
    .join("");
  return section(
    "Verified steel section library",
    "Store supplier or published section data with its source. No unknown section masses are supplied. Lengths are in metres; supplier prices are AUD per tonne.",
    `<label class="field">Search sections<input type="search" placeholder="Designation, family or source" oninput="filterSettingsCatalog(this.value)"></label><div class="tablewrap"><table><thead><tr><th>Designation</th><th>Family</th><th>kg/m</th><th>Stock (m)</th><th>Buy price</th><th>Material</th><th>Source / verification</th><th>Actions</th></tr></thead><tbody id="settings-catalog-rows">${rows || '<tr><td colspan="8" class="muted">Your verified section library is empty. Add a section below or import your supplier’s table.</td></tr>'}</tbody></table></div><div class="rule"><h3>${settingsSectionEdit >= 0 ? "Edit section" : "Add verified section"}</h3><form id="settings-section-form" onsubmit="saveCatalogSection(event)"><div class="formgrid"><div class="field"><label for="catalog-designation">Section designation</label><input id="catalog-designation" name="designation" value="${esc(row.designation || "")}" required maxlength="150" placeholder="Exact supplier designation"></div><div class="field"><label for="catalog-family">Family</label><select id="catalog-family" name="family">${CATALOG_FAMILIES.map((f) => `<option ${f === row.family ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></div><div class="field"><label for="catalog-kgm">Verified unit mass (kg/m)</label><input id="catalog-kgm" name="kgm" type="number" min="0.000001" step="any" value="${esc(row.kgm ?? "")}" required></div><div class="field"><label for="catalog-stocks">Available stock lengths (m)</label><input id="catalog-stocks" name="stock_lengths" value="${esc((row.stock_lengths || []).join(", "))}" placeholder="e.g. 9, 12"></div><div class="field"><label for="catalog-price">Supplier buying price ($/t, optional)</label><input id="catalog-price" name="supplier_price" type="number" min="0" step="any" value="${esc(row.supplier_price ?? "")}"></div><div class="field"><label for="catalog-material">Material / grade</label><input id="catalog-material" name="material" value="${esc(row.material || "")}" maxlength="150" placeholder="Supplier grade if known"></div><div class="field"><label for="catalog-source">Verified source / reference</label><input id="catalog-source" name="source" value="${esc(row.source || "")}" required maxlength="500" placeholder="Supplier table, edition and page, or URL"></div></div><p class="row"><button class="btn primary" type="submit">${settingsSectionEdit >= 0 ? "Save section" : "Add section"}</button>${settingsSectionEdit >= 0 ? '<button class="btn" type="button" onclick="cancelCatalogEdit()">Cancel edit</button>' : ""}</p></form></div><div class="rule"><h3>Import CSV or Excel</h3><p class="sub">Use a header row: <code>designation,family,kgm,stock_lengths,supplier_price,material,source</code>. Designation, family, positive kg/m and a verified source are required. Separate multiple stock lengths with semicolons inside a cell. Price is optional and expressed in $/t. Import only data you have checked against a supplier or published section table.</p><form id="settings-import-form" onsubmit="importCatalogSections(event)"><div class="row"><label class="field">Section table (.csv or .xlsx)<input id="catalog-import-file" name="file" type="file" accept=".csv,.xlsx" required></label><label class="field">Source / reference for this table<input name="source" placeholder="Required when not supplied in each row" maxlength="500"></label></div><p><label><input type="checkbox" name="verified" value="true" required> I have verified this table against the stated source.</label></p><p><button class="btn" type="submit">Import verified section table</button></p></form><p id="catalog-import-status" role="status" class="muted"></p></div>`,
  );
}

function filterSettingsCatalog(query) {
  const search = String(query).trim().toLowerCase();
  document
    .querySelectorAll("#settings-catalog-rows tr[data-catalog-search]")
    .forEach((row) => {
      row.hidden = !row.dataset.catalogSearch.includes(search);
    });
}

async function editCatalogSection(index) {
  settingsSectionEdit = index;
  await render();
  document.getElementById("catalog-designation")?.focus();
}
async function cancelCatalogEdit() {
  settingsSectionEdit = -1;
  await render();
}

async function saveCatalogSection(event) {
  event.preventDefault();
  try {
    const values = new FormData(
      document.getElementById("settings-section-form"),
    );
    const kgm = Number(values.get("kgm"));
    const lengths = String(values.get("stock_lengths") || "")
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (!Number.isFinite(kgm) || kgm <= 0)
      throw new Error("Enter a verified positive kg/m value.");
    if (lengths.some((length) => !Number.isFinite(length) || length <= 0))
      throw new Error(
        "Stock lengths must be positive metres separated by commas.",
      );
    const designation = String(values.get("designation") || "").trim();
    const source = String(values.get("source") || "").trim();
    if (!designation || !source)
      throw new Error("A designation and verified source are required.");
    const price = String(values.get("supplier_price") || "").trim();
    if (price && (!Number.isFinite(Number(price)) || Number(price) < 0))
      throw new Error(
        "Supplier buying price must be zero or more, or left blank.",
      );
    const item = {
      designation,
      family: String(values.get("family")),
      kgm,
      stock_lengths: [...new Set(lengths)].sort((a, b) => a - b),
      supplier_price: price === "" ? null : Number(price),
      material: String(values.get("material") || "").trim(),
      verified: true,
      source,
    };
    const sections = [...settingsData().sections];
    const duplicate = sections.findIndex(
      (s, i) =>
        i !== settingsSectionEdit &&
        s.designation.trim().toLowerCase() === designation.toLowerCase(),
    );
    if (duplicate >= 0)
      throw new Error(
        "That designation already exists. Edit its existing row to update the verified data.",
      );
    if (settingsSectionEdit >= 0) sections[settingsSectionEdit] = item;
    else sections.push(item);
    await settingsUpdate({ sections });
    settingsSectionEdit = -1;
    await render();
    notify(
      "Verified section saved. Existing takeoff rows keep their recorded values.",
    );
  } catch (error) {
    notify(error.message || "Unable to save section.", true);
  }
  return false;
}

async function removeCatalogSection(index) {
  const item = settingsData().sections[index];
  if (
    !item ||
    !confirm(
      `Remove ${item.designation} from the section library? Existing project members will keep their recorded values.`,
    )
  )
    return;
  try {
    await settingsUpdate({
      sections: settingsData().sections.filter((_, i) => i !== index),
    });
    settingsSectionEdit = -1;
    await render();
    notify("Section removed from the library.");
  } catch (error) {
    notify(error.message || "Unable to remove section.", true);
  }
}

async function importCatalogSections(event) {
  event.preventDefault();
  const form = document.getElementById("settings-import-form");
  const button = form.querySelector('button[type="submit"]');
  try {
    const file = document.getElementById("catalog-import-file").files[0];
    if (!file) throw new Error("Choose a CSV or XLSX table to import.");
    button.disabled = true;
    const data = new FormData(form);
    data.set("file", file);
    const result = await api("/api/sections/import", {
      method: "POST",
      body: data,
    });
    const settings = await api("/api/settings");
    Object.assign(workspaceSettings, settings.settings || settings);
    settingsSectionEdit = -1;
    await render();
    const count = result.imported ?? result.count ?? "";
    const message =
      count === ""
        ? "Verified section table imported."
        : `${count} verified sections imported.`;
    const status = document.getElementById("catalog-import-status");
    if (status) status.textContent = message;
    notify(message);
  } catch (error) {
    notify(error.message || "Unable to import the section table.", true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
  return false;
}

function renderSectionPicker() {
  const sections = settingsData().sections;
  return `<div class="rule"><h3>Add from verified section library</h3>${sections.length ? `<div class="formgrid"><div class="field"><label for="takeoff-section-search">Search designation / family</label><input id="takeoff-section-search" type="search" placeholder="Search your verified sections" oninput="filterSectionPicker(this.value)"></div><div class="field"><label for="takeoff-section-select">Verified section</label><select id="takeoff-section-select">${sectionPickerOptions("")}</select></div></div><p><button class="btn" onclick="addCatalogMemberByIndex()">Add selected section</button></p>` : '<p class="muted">Add or import a verified supplier section table in Settings to select sections here. Manual takeoff remains available; enter verified kg/m for every member.</p>'}</div>`;
}

function sectionPickerOptions(query) {
  const search = String(query).trim().toLowerCase();
  const options = settingsData()
    .sections.map((s, i) => ({ s, i }))
    .filter(({ s }) =>
      [s.designation, s.family].join(" ").toLowerCase().includes(search),
    );
  return options.length
    ? options
        .map(
          ({ s, i }) =>
            `<option value="${i}">${esc(s.designation)} · ${esc(s.family)} · ${esc(s.kgm)} kg/m</option>`,
        )
        .join("")
    : '<option value="">No matching verified sections</option>';
}

function filterSectionPicker(query) {
  const select = document.getElementById("takeoff-section-select");
  if (select) select.innerHTML = sectionPickerOptions(query);
}
function addCatalogMemberByIndex() {
  const selected = document.getElementById("takeoff-section-select")?.value;
  const item =
    selected !== "" && selected !== undefined
      ? settingsData().sections[Number(selected)]
      : null;
  if (!item) {
    notify("Select a verified section first.", true);
    return;
  }
  addCatalogMember(item.designation);
}

async function addCatalogMember(designation) {
  const item = settingsData().sections.find(
    (s) => s.designation === designation,
  );
  if (
    !item ||
    !Number.isFinite(Number(item.kgm)) ||
    Number(item.kgm) <= 0 ||
    !String(item.source || "").trim()
  ) {
    notify(
      "This section needs a verified kg/m value and source in Settings before it can be added.",
      true,
    );
    return;
  }
  const member = {
    ...newMember(),
    section: item.designation,
    family: item.family,
    kgm: Number(item.kgm),
    stocks: (item.stock_lengths || []).join(","),
    section_source: item.source,
    material: item.material || "",
  };
  if (
    item.supplier_price !== undefined &&
    item.supplier_price !== null &&
    item.supplier_price !== ""
  )
    member.supplierRate = Number(item.supplier_price);
  state.members.push(member);
  save();
  await render();
  notify(
    "Verified section added. Enter its mark, quantity and drawing length.",
  );
}

function renderAssemblySettings(assemblies) {
  const row = assemblies[settingsAssemblyEdit] || {};
  const hours = row.labour_hours ?? row.hours ?? "";
  const efficiency = row.repeat_efficiency ?? 100;
  return section(
    "Assembly labour library",
    "Use your workshop’s typical hours for repeated small assemblies. These entries set labour allowances; confirm the design, connections and scope for each job.",
    `<div class="tablewrap"><table><thead><tr><th>Assembly</th><th>Typical section</th><th>Hours / assembly</th><th>Repeat factor</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${assemblies.map((a, i) => `<tr><td>${esc(a.name)}</td><td>${esc(a.section || "")}</td><td>${fmt(Number(a.labour_hours ?? a.hours ?? 0))}</td><td>${fmt(Number(a.repeat_efficiency ?? 100))}%</td><td>${esc(a.description || "")}</td><td><div class="row"><button class="btn small" onclick="editAssembly(${i})">Edit</button><button class="btn small danger" onclick="removeAssembly(${i})">Remove</button></div></td></tr>`).join("") || '<tr><td colspan="6" class="muted">No saved assemblies. Add your own workshop allowance below.</td></tr>'}</tbody></table></div>${!assemblies.length ? '<p><button class="btn" onclick="addProvidedAssemblyExamples()">Add your two post examples</button></p>' : ""}<div class="rule"><h3>${settingsAssemblyEdit >= 0 ? "Edit assembly" : "Add assembly"}</h3><form id="settings-assembly-form" onsubmit="saveAssembly(event)"><div class="formgrid"><div class="field"><label for="assembly-name">Assembly name</label><input id="assembly-name" name="name" value="${esc(row.name || "")}" required maxlength="150"></div><div class="field"><label for="assembly-section">Typical section (optional)</label><input id="assembly-section" name="section" value="${esc(row.section || "")}" maxlength="150"></div><div class="field"><label for="assembly-hours">Base fabrication hours per assembly</label><input id="assembly-hours" name="labour_hours" type="number" min="0" step="any" value="${esc(hours)}" required></div><div class="field"><label for="assembly-efficiency">Repeat time factor (%)</label><input id="assembly-efficiency" name="efficiency" type="number" min="1" max="100" step="any" value="${esc(efficiency)}" required><small class="muted">100% = full base time; 90% = 10% time saving.</small></div><div class="field"><label for="assembly-description">Scope / assumptions</label><textarea id="assembly-description" name="description" maxlength="1000">${esc(row.description || "")}</textarea></div></div><p class="row"><button class="btn primary" type="submit">${settingsAssemblyEdit >= 0 ? "Save assembly" : "Add assembly"}</button>${settingsAssemblyEdit >= 0 ? '<button class="btn" type="button" onclick="cancelAssemblyEdit()">Cancel edit</button>' : ""}</p></form></div>`,
  );
}

async function editAssembly(index) {
  settingsAssemblyEdit = index;
  await render();
  document.getElementById("assembly-name")?.focus();
}
async function cancelAssemblyEdit() {
  settingsAssemblyEdit = -1;
  await render();
}
async function saveAssembly(event) {
  event.preventDefault();
  try {
    const data = new FormData(
      document.getElementById("settings-assembly-form"),
    );
    const hours = Number(data.get("labour_hours")),
      efficiency = Number(data.get("efficiency"));
    const name = String(data.get("name") || "").trim();
    if (
      !name ||
      !Number.isFinite(hours) ||
      hours < 0 ||
      !Number.isFinite(efficiency) ||
      efficiency <= 0 ||
      efficiency > 100
    )
      throw new Error(
        "Enter an assembly name, valid hours and a repeat factor above 0% and up to 100%.",
      );
    const item = {
      name,
      section: String(data.get("section") || "").trim(),
      hours,
      repeat_efficiency: efficiency,
      description: String(data.get("description") || "").trim(),
    };
    const assemblies = [...settingsData().assemblies];
    if (settingsAssemblyEdit >= 0) assemblies[settingsAssemblyEdit] = item;
    else assemblies.push(item);
    await settingsUpdate({ assemblies });
    settingsAssemblyEdit = -1;
    await render();
    notify("Assembly labour allowance saved.");
  } catch (error) {
    notify(error.message || "Unable to save assembly.", true);
  }
  return false;
}

async function removeAssembly(index) {
  const item = settingsData().assemblies[index];
  if (!item || !confirm(`Remove ${item.name} from the assembly library?`))
    return;
  try {
    await settingsUpdate({
      assemblies: settingsData().assemblies.filter((_, i) => i !== index),
    });
    settingsAssemblyEdit = -1;
    await render();
    notify("Assembly removed.");
  } catch (error) {
    notify(error.message || "Unable to remove assembly.", true);
  }
}

async function addProvidedAssemblyExamples() {
  if (settingsData().assemblies.length) return;
  const assemblies = [
    {
      name: "100x100x5 SHS post with top / bottom plates",
      section: "100x100x5 SHS",
      hours: 1,
      repeat_efficiency: 100,
      description:
        "User-provided small-job labour example; verify connections and scope.",
    },
    {
      name: "50x50x5 SHS post with top / bottom plates",
      section: "50x50x5 SHS",
      hours: 0.5,
      repeat_efficiency: 100,
      description:
        "User-provided small-job labour example; verify connections and scope.",
    },
  ];
  try {
    await settingsUpdate({ assemblies });
    await render();
    notify(
      "Your two labour examples were saved. No section masses have been assumed.",
    );
  } catch (error) {
    notify(error.message || "Unable to save examples.", true);
  }
}

function renderAssemblyPicker() {
  const assemblies = settingsData().assemblies;
  if (!assemblies.length)
    return '<div class="rule"><h3>Assembly labour</h3><p class="muted">Save typical workshop assembly hours in Settings to apply them to takeoff rows.</p></div>';
  if (!state.members.length) return "";
  return `<div class="rule"><h3>Apply an assembly labour allowance</h3><div class="formgrid"><div class="field"><label for="takeoff-assembly-select">Assembly allowance</label><select id="takeoff-assembly-select">${assemblies.map((a, i) => `<option value="${i}">${esc(a.name)} · ${esc(a.labour_hours ?? a.hours)} h · ${esc(a.repeat_efficiency ?? 100)}%</option>`).join("")}</select></div><div class="field"><label for="takeoff-assembly-member">Takeoff row</label><select id="takeoff-assembly-member">${state.members.map((m, i) => `<option value="${i}">${i + 1}. ${esc(m.mark || "Unmarked")} · ${esc(m.section)}</option>`).join("")}</select></div></div><p><button class="btn" onclick="applyAssemblyToMember()">Apply hours and repeat factor</button></p><p class="tiny muted">Member size, quantity and verified mass stay as entered. Check the assembly scope before applying its labour.</p></div>`;
}

async function applyAssemblyToMember() {
  const assemblyIndex = document.getElementById(
    "takeoff-assembly-select",
  )?.value;
  const memberIndex = document.getElementById("takeoff-assembly-member")?.value;
  const assembly =
    assemblyIndex !== undefined
      ? settingsData().assemblies[Number(assemblyIndex)]
      : null;
  const member =
    memberIndex !== undefined ? state.members[Number(memberIndex)] : null;
  if (!assembly || !member) {
    notify("Select an assembly and takeoff row.", true);
    return;
  }
  const hours = Number(assembly.labour_hours ?? assembly.hours),
    efficiency = Number(assembly.repeat_efficiency ?? 100);
  if (
    !Number.isFinite(hours) ||
    hours < 0 ||
    !Number.isFinite(efficiency) ||
    efficiency <= 0 ||
    efficiency > 100
  ) {
    notify(
      "Correct the assembly hours and repeat factor in Settings first.",
      true,
    );
    return;
  }
  member.fabEach = hours;
  member.efficiency = efficiency;
  member.assembly = assembly.name;
  save();
  await render();
  notify("Assembly hours and repeat factor applied.");
}

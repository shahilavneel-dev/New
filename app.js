"use strict";
const FAMILIES = ["UB", "UC", "PFC", "SHS", "RHS", "Pipe", "Angle", "Flat bar"];
const FINISHES = ["Raw", "Primed", "HDG", "Powder", "Cold galv"];
const STOCK = {
  UB: [9, 10.5, 12, 13.5],
  UC: [9, 10.5, 12, 13.5],
  PFC: [9, 10.5, 12, 13.5],
  SHS: [8, 12],
  RHS: [8, 12],
  Pipe: [6.5, 12],
  Angle: [7.5, 9],
  "Flat bar": [6],
};
const CUTS = [1.5, 3, 4.5, 6, 7.5];
const money = (n) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    Number(n) || 0,
  );
const fmt = (n, d = 2) =>
  new Intl.NumberFormat("en-AU", { maximumFractionDigits: d }).format(
    Number(n) || 0,
  );
const n = (x) => Math.max(0, Number(x) || 0);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const roundQuarter = (x) => Math.ceil((Math.max(0, x) - 1e-10) * 4) / 4;
const blank = () => ({
  project: {
    name: "",
    client: "",
    address: "",
    scope: "sfi",
    sawTol: 10,
    kerf: 3,
    finish: "Primed",
    target: 26,
    delivery: "none",
    deliverySell: 125,
    deliveryCost: "",
    transportCost: "",
    transportMargin: 20,
    boltEnabled: true,
    boltCost: "",
    notes: "",
  },
  members: [],
  plates: [],
  plateMode: "allowance",
  plateSheet: "1200x2400",
  plateLaserHours: 0.5,
  fabClass: "medium",
  fabHoursT: 18,
  draftMode: "standard",
  draftHours: 4,
  draftQuote: "",
  draftMargin: 20,
  tubeHours: "",
  powderQuote: "",
  powderMargin: 20,
  installerQuote: "",
  installerMargin: 7.5,
  materialMarginOverride: "",
  supplyOnlyMargin: 30,
  otherCost: 0,
  otherSell: 0,
  finalSupply: "",
  finalInstall: "",
  pdfFiles: [],
  pdfCandidates: [],
  pdfFlags: [],
  pdfScope: "",
  pdfActiveFile: "",
  pdfPage: 1,
});
let state = blank();
let tab = "Dashboard";
let emailEdit = null;
const $ = (id) => document.getElementById(id);
function save() {
  try {
    localStorage.setItem("steeltakeoff_v2", JSON.stringify(state));
  } catch (e) {}
}
try {
  let raw = localStorage.getItem("steeltakeoff_v2");
  if (raw) {
    let obj = JSON.parse(raw);
    state = {
      ...blank(),
      ...obj,
      project: { ...blank().project, ...obj.project },
    };
  }
} catch (e) {}
function newMember() {
  return {
    id: Date.now() + Math.random(),
    mark: "",
    family: "UB",
    section: "250UB31.4",
    kgm: 31.4,
    qty: 1,
    length: 4500,
    finish: state.project.finish,
    process: "saw",
    heavy: false,
    cuts: 1,
    fabEach: "",
    efficiency: 100,
    stocks: "",
  };
}
function newPlate() {
  return {
    id: Date.now() + Math.random(),
    label: "BP1",
    length: 300,
    width: 300,
    thick: 10,
    qty: 2,
  };
}
function setField(path, value) {
  let ref = state;
  const seg = path.split(".");
  for (let i = 0; i < seg.length - 1; i++) ref = ref[seg[i]];
  ref[seg.at(-1)] = value;
  save();
  render();
}
function editRow(list, index, field, value) {
  state[list][index][field] = value;
  save();
  render();
}
function deleteRow(list, index) {
  const removed = state[list].splice(index, 1)[0];
  if (removed?.sourceKey && Array.isArray(state.pdfCandidates)) {
    let c = state.pdfCandidates.find(
      (c) =>
        [
          c.file_id,
          c.origin,
          c.kind,
          c.page,
          c.section || c.label,
          c.mark || "",
          c.evidence || "",
        ]
          .join("|")
          .toLowerCase() === removed.sourceKey,
    );
    if (c) c.imported = false;
  }
  save();
  render();
}
function addRow(list) {
  state[list].push(list === "members" ? newMember() : newPlate());
  save();
  render();
}
function inputField(label, path, value, type = "text", help = "") {
  return `<div class="field"><label>${esc(label)}</label><input type="${type}" value="${esc(value)}" onchange="setField('${path}',this.value)">${help ? `<span class="hint">${esc(help)}</span>` : ""}</div>`;
}
function selectField(label, path, value, options) {
  return `<div class="field"><label>${esc(label)}</label><select onchange="setField('${path}',this.value)">${options.map(([v, s]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>`;
}
const fld = (val, li, i, k, type = "text", width = "") =>
  `<input class="cellInput ${width}" type="${type}" ${type === "number" ? 'min="0"' : ""} value="${esc(val)}" onchange="editRow('${li}',${i},'${k}',this.value)">`;
const sel = (val, li, i, k, options) =>
  `<select class="cellInput mid" onchange="editRow('${li}',${i},'${k}',this.value)">${options.map((a) => `<option value="${esc(a)}" ${a === val ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>`;
function calculate() {
  return calculationCache;
}
function metrics(x) {
  let provisional = x.warnings.some((w) =>
    /missing|unallocated|unpriced|quote required|quotation|no members|not entered/i.test(
      w,
    ),
  );
  return `<div class="cards"><div class="metric"><label>Net steel weight</label><strong>${fmt(x.net / 1000, 3)} t</strong><small>Members + estimated plates</small></div><div class="metric"><label>Estimated total cost</label><strong>${money(x.totalCost)}</strong><small>${provisional ? "Some costs still missing" : "Costs currently entered"}</small></div><div class="metric"><label>Final selling price</label><strong>${money(x.totalSell)}</strong><small>Before GST · supply + install</small></div><div class="metric ${x.margin >= 24 && x.margin <= 28 ? "positive" : "warning"}"><label>Overall gross margin</label><strong>${fmt(x.margin, 1)}%</strong><small>Target 24–28% ${provisional ? "· provisional" : ""}</small></div></div>`;
}
function section(title, subtitle, contents) {
  return `<section class="box"><h2>${title}</h2>${subtitle ? `<p class="sub">${subtitle}</p>` : ""}${contents}</section>`;
}
function renderProject(x) {
  return section(
    "Job setup",
    "Set the customer, scope and primary pricing defaults. All editable quantities are for estimating, not production instructions.",
    `<div class="formgrid">${inputField("Project / job name", "project.name", state.project.name)}${inputField("Customer", "project.client", state.project.client)}${inputField("Project address", "project.address", state.project.address)}${selectField(
      "Scope",
      "project.scope",
      state.project.scope,
      [
        ["sfi", "Supply + fabrication + installation"],
        ["sf", "Supply + fabrication"],
        ["supply", "Stock supply / cuts only"],
      ],
    )}${selectField(
      "Default finish for new members",
      "project.finish",
      state.project.finish,
      FINISHES.map((a) => [a, a]),
    )}${inputField("Overall gross margin target (%)", "project.target", state.project.target, "number")}</div><div class="rule"><h3>Material pricing controls</h3><div class="formgrid">${inputField("Manual material margin override (%)", "materialMarginOverride", state.materialMarginOverride, "number", "Leave empty to use scope / tonnage rules.")}${inputField("Supply-only margin (%)", "supplyOnlyMargin", state.supplyOnlyMargin, "number", "Default 30% placeholder until weight bands are defined.")}${inputField("Saw nesting tolerance (mm)", "project.sawTol", state.project.sawTol, "number", "Estimate-only tolerance, confirm real cuts before production.")}${inputField("Saw / laser kerf (mm)", "project.kerf", state.project.kerf, "number")}</div></div><div class="rule"><h3>Project information / notes</h3><div class="field"><label>Internal scope / assumptions</label><textarea onchange="setField('project.notes',this.value)">${esc(state.project.notes)}</textarea></div></div>`,
  );
}
function renderMembers(x) {
  const rows = state.members
    .map(
      (r, i) =>
        `<tr><td>${fld(r.mark, "members", i, "mark", "text", "short")}</td><td>${sel(r.family, "members", i, "family", FAMILIES)}</td><td>${fld(r.section, "members", i, "section", "text", "wide")}</td><td>${fld(r.kgm, "members", i, "kgm", "number", "short")}</td><td>${fld(r.qty, "members", i, "qty", "number", "short")}</td><td>${fld(r.length, "members", i, "length", "number", "short")}</td><td>${sel(r.finish, "members", i, "finish", FINISHES)}</td><td>${sel(r.process, "members", i, "process", ["saw", "tube"])}</td><td>${fld(r.cuts, "members", i, "cuts", "number", "short")}</td><td>${r.heavy ? "Heavy" : "Standard"}<br><input type="checkbox" ${r.heavy ? "checked" : ""} onchange="editRow('members',${i},'heavy',this.checked)"></td><td>${fld(r.fabEach, "members", i, "fabEach", "number", "short")}</td><td>${fld(r.efficiency, "members", i, "efficiency", "number", "short")}</td><td>${fld(r.stocks, "members", i, "stocks", "text", "mid")}</td><td><b>${fmt(((n(r.qty) * n(r.length)) / 1000) * n(r.kgm))} kg</b></td><td><button class="btn danger small" onclick="deleteRow('members',${i})">Remove</button></td></tr>`,
    )
    .join("");
  return section(
    "Material takeoff",
    "Enter steel members from your drawings, sketches or existing schedules. Section kg/m values should come from a verified steel section table. Stock lengths are automatically selected by family unless overridden.",
    `<div class="steps" style="margin-bottom:12px"><button class="btn primary" onclick="addRow('members')">+ Add member</button><span class="muted tiny">One line per mark / section / length / finish. Use mm for lengths.</span></div><div class="tablewrap"><table><thead><tr><th>Mark</th><th>Family</th><th>Section</th><th>kg/m</th><th>Qty</th><th>Length mm</th><th>Finish</th><th>Cut</th><th>Cuts/pc</th><th>Heavy rate</th><th>Fab hrs/pc</th><th>Repeat %</th><th>Stock lengths (m)</th><th>Net weight</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="15" class="muted">No steel members entered. Add a member or load the clearly labelled example.</td></tr>'}</tbody></table></div><div class="statstrip"><div>Net member weight: <b>${fmt(x.netMembers)} kg</b></div><div>Member lines: <b>${state.members.length}</b></div><div>Longest member: <b>${fmt(x.longest / 1000)} m</b></div></div><div class="notice"><b>Accuracy:</b> PDF/AI results may be incomplete or incorrect. Review imported dimensions, section kg/m values, cut counts and scope manually. The heavy-cut checkbox forces the configured heavy rate; larger tubes/angles and UB/UC/PFC use the heavy rate automatically.</div>`,
  );
}
function renderPlates(x) {
  let table =
    state.plateMode === "detailed"
      ? `<div class="steps" style="margin-bottom:12px"><button class="btn primary" onclick="addRow('plates')">+ Add plate</button></div><div class="tablewrap"><table><thead><tr><th>Mark</th><th>Length mm</th><th>Width mm</th><th>Thickness mm</th><th>Qty</th><th>Net weight</th><th></th></tr></thead><tbody>${state.plates.map((r, i) => `<tr><td>${fld(r.label, "plates", i, "label")}</td><td>${fld(r.length, "plates", i, "length", "number")}</td><td>${fld(r.width, "plates", i, "width", "number")}</td><td>${fld(r.thick, "plates", i, "thick", "number")}</td><td>${fld(r.qty, "plates", i, "qty", "number")}</td><td>${fmt(n(r.length) * n(r.width) * n(r.thick) * n(r.qty) * 0.00000785)} kg</td><td><button class="btn small danger" onclick="deleteRow('plates',${i})">Remove</button></td></tr>`).join("")}</tbody></table></div>`
      : "";
  return section(
    "Plate allowance and laser",
    "Select the 12% gross-stock allowance, enter dimensional plates, or choose no plates. Detailed plate sheet quantities are approximated by area in V1; confirm the actual geometric nest before ordering.",
    `${selectField("Plate calculation method", "plateMode", state.plateMode, [
      ["allowance", "12% of gross purchased section weight"],
      ["detailed", "Detailed plate list (area-based sheet allowance)"],
      ["none", "No plates"],
    ])}<div style="margin-top:16px" class="formgrid">${
      state.plateMode === "detailed"
        ? selectField(
            "Plate sheet dimensions",
            "plateSheet",
            state.plateSheet,
            [
              ["1200x2400", "1200 × 2400"],
              ["1500x3000", "1500 × 3000"],
            ],
          )
        : ""
    }${inputField("Plate laser hours", "plateLaserHours", state.plateLaserHours, "number", "Minimum typically 0.5 h when plates are required.")}</div>${table}<div class="statstrip"><div>Net plate weight: <b>${fmt(x.plateWeight)} kg</b></div><div>Allocated purchased plate: <b>${fmt(x.plateGross)} kg</b></div><div>Material buy cost: <b>${money(x.plateBuy)}</b></div></div>${x.plateSheets.length ? `<div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>Allocation</th><th>Equivalent sheets</th><th>Purchased kg</th></tr></thead><tbody>${x.plateSheets.map((p) => `<tr><td>${esc(p.desc)}</td><td>${fmt(p.fraction)}</td><td>${fmt(p.weight)}</td></tr>`).join("")}</tbody></table></div>` : ""}<p class="tiny muted" style="margin-top:13px">Reference plate: 1200×2400×10 mm = 226.08 kg / $390. Plate buying rate = $390 ÷ 226.08 kg. Material fractions round up by 0.25. Plate laser rate: $181.31 cost/hr, $248 sell/hr.</p>`,
  );
}
function renderStock(x) {
  let byGroups = x.purchase.allocations;
  let cards = byGroups
    .map((a, i) => {
      let total = a.selected.reduce((s, p) => s + p.length, 0);
      let grip =
        a.row.process === "tube" ? Math.max(0, a.L * 1000 - a.nominal) : 0;
      let scale = a.L * 1000;
      let partDisplay = a.selected
        .map(
          (p) =>
            `<div class="piece" style="width:${(p.length / scale) * 100}%" title="${esc(p.mark)} ${p.length} mm"></div>`,
        )
        .join("");
      let rest = Math.max(0, scale - total - grip);
      return `<div class="box"><div class="row space"><div><b>${esc(a.row.section)}</b> · ${a.kind === "stock" ? "Full stock" : "Supplier cut"} · ${fmt(a.L)} m <span class="pill">${esc(a.row.process.toUpperCase())}</span></div><strong>${money(a.cost)}</strong></div><div class="bar" style="margin:14px 0">${partDisplay}<div class="waste" style="width:${(rest / scale) * 100}%"></div>${grip ? `<div class="grip" style="width:${(grip / scale) * 100}%"></div>` : ""}</div><div class="row space tiny"><span>Parts: ${a.selected.map((p) => fmt(p.length / 1000) + " m").join(" + ")}</span><span>Gross: ${fmt(a.L * n(a.row.kgm))} kg · Remainder ${fmt(a.remainingNominal)} mm</span></div>${a.provisional ? '<div class="notice">Near-limit saw cut: accepted provisionally within your estimating tolerance. Verify final lengths, actual stock overlength and kerf before manufacturing.</div>' : ""}${a.kind === "supplier cut" ? '<div class="tiny muted">Supplier cut size: $2,050/t + $50 supplier cut charge included.</div>' : ""}</div>`;
    })
    .join("");
  return section(
    "Stock selection and nesting",
    "A purchasing-cost heuristic compares available full lengths with permitted supplier cut sizes (UB/UC/PFC, saw only). It is not guaranteed to find the absolute cheapest combination. Tube laser uses reduced usable lengths.",
    `<div class="statstrip" style="margin:0 0 16px"><div>Gross stock weight: <b>${fmt(x.purchase.gross)} kg</b></div><div>Stock material cost: <b>${money(x.purchase.cost)}</b></div><div>Stock lengths: <b>${x.purchase.allocations.length}</b></div></div>${cards || '<p class="muted">Add members to generate purchasing arrangements.</p>'}<div class="notice">Tube laser usable lengths follow Settings; confirm the machine limits before production. Saw nesting allows a small provisional tolerance; it is not a cut list ready for the workshop. Check availability for each section with your supplier.</div>`,
  );
}
function renderCosts(x) {
  let rateBands = {
    extra: [8, 12],
    heavy: [12, 16],
    medium: [16, 20],
    light: [20, 22],
  };
  let band = rateBands[state.fabClass];
  let options = [
    ["extra", "Extra heavy — 8–12 hrs/t"],
    ["heavy", "Heavy — 12–16 hrs/t"],
    ["medium", "Medium — 16–20 hrs/t"],
    ["light", "Light — 20–22 hrs/t"],
  ];
  let processing = `<div class="formgrid">${selectField("Fabrication class (>2 tonnes)", "fabClass", state.fabClass, options)}${inputField("Fab hours / tonne", "fabHoursT", state.fabHoursT, "number", `Recommended ${band[0]}–${band[1]} for current class`)}${inputField("Tube laser manager hours", "tubeHours", state.tubeHours, "number", "Enter once confirmed with manager.")}${selectField(
    "Drafting calculation",
    "draftMode",
    state.draftMode,
    [
      ["standard", "Standard (only below 1.5 t)"],
      ["hours", "Manual in-house hours"],
      ["outsource", "External draftsman quote"],
      ["none", "Not required"],
    ],
  )}${state.draftMode === "hours" ? inputField("Drafting hours", "draftHours", state.draftHours, "number") : ""}${state.draftMode === "outsource" ? inputField("Draftsman quote cost ($)", "draftQuote", state.draftQuote, "number") : ""}${state.draftMode === "outsource" ? inputField("Drafting subcontract gross margin (%)", "draftMargin", state.draftMargin, "number") : ""}</div>`;
  let subs = `<div class="formgrid">${selectField(
    "Delivery method",
    "project.delivery",
    state.project.delivery,
    [
      ["none", "No delivery included"],
      ["own", "Own truck ($100–$150 charge)"],
      ["external", "External transport quote"],
    ],
  )}${state.project.delivery === "own" ? inputField("Own truck selling price ($)", "project.deliverySell", state.project.deliverySell, "number") : ""}${state.project.delivery === "own" ? inputField("Own truck internal cost ($)", "project.deliveryCost", state.project.deliveryCost, "number", "Leave blank = margin provisional") : ""}${state.project.delivery === "external" ? inputField("Transport supplier quote ($)", "project.transportCost", state.project.transportCost, "number") : ""}${state.project.delivery === "external" ? inputField("External transport margin (%)", "project.transportMargin", state.project.transportMargin, "number") : ""}${inputField("Bolt internal cost ($)", "project.boltCost", state.project.boltCost, "number", "Required for accurate overall profit if bolts are included.")}${selectField(
    "Bolts / fasteners allowance",
    "project.boltEnabled",
    String(state.project.boltEnabled),
    [
      ["true", "Include $150 per net tonne"],
      ["false", "Exclude"],
    ],
  )}${x.finishWeights.Powder > 0 ? inputField("Powder coater quote ($)", "powderQuote", state.powderQuote, "number") : ""}${x.finishWeights.Powder > 0 ? inputField("Powder coat margin (%)", "powderMargin", state.powderMargin, "number") : ""}${state.project.scope === "sfi" ? inputField("Installer subcontract quote ($)", "installerQuote", state.installerQuote, "number") : ""}${state.project.scope === "sfi" ? inputField("Installation margin (%)", "installerMargin", state.installerMargin, "number", "Typically 5–10%.") : ""}${inputField("Other internal cost ($)", "otherCost", state.otherCost, "number")}${inputField("Other selling charge ($)", "otherSell", state.otherSell, "number")}</div>`;
  return (
    section(
      "Fabrication and drafting",
      "Over 2t, fabrication is net tonnes × hours/tonne; for smaller jobs use each member's assembly hours × quantity × repeat factor from the Takeoff tab.",
      processing,
    ) +
    section(
      "Subcontractors, freight and allowances",
      "Missing supplier quotes and unknown costs are flagged. All prices are ex GST.",
      subs,
    ) +
    section(
      "Calculated cost and selling breakdown",
      "Cost is estimated internal expense; selling amounts follow your different work-centre and markup rules.",
      costTable(x),
    )
  );
}
function costTable(x) {
  return `<div class="tablewrap"><table style="min-width:600px"><thead><tr><th>Operation</th><th class="right">Hours</th><th class="right">Cost</th><th class="right">Sell</th><th class="right">Gross profit</th></tr></thead><tbody>${x.items.map((v) => `<tr><td>${esc(v.name)}</td><td class="right">${v.hours === undefined ? "—" : fmt(v.hours)}</td><td class="right">${money(v.cost)}</td><td class="right">${money(v.sell)}</td><td class="right">${money(v.sell - v.cost)}</td></tr>`).join("")}<tr><th>SUPPLY + FABRICATION</th><th></th><th class="right">${money(x.supplyCost)}</th><th class="right">${money(x.supplySell)}</th><th class="right">${money(x.supplySell - x.supplyCost)}</th></tr>${state.project.scope === "sfi" ? `<tr><td><b>Installation</b></td><td class="right">—</td><td class="right">${money(x.installCost)}</td><td class="right">${money(x.instSell)}</td><td class="right">${money(x.instSell - x.installCost)}</td></tr>` : ""}<tr><th>GRAND TOTAL</th><th></th><th class="right">${money(x.totalCost)}</th><th class="right">${money(x.totalSell)}</th><th class="right">${money(x.profit)}</th></tr></tbody></table></div>`;
}
function warningBox(x) {
  if (!x.warnings.length)
    return `<div class="notice oknote"><b>Checks:</b> No outstanding automatic warnings. Always verify quantities and feasibility independently.</div>`;
  return `<div class="notice"><b>Requires review (${x.warnings.length}):</b><ul style="margin:8px 0 2px;padding-left:21px">${[...new Set(x.warnings)].map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
}
function benchmark(x) {
  let finish = Object.entries(x.finishWeights)
    .filter(([k, w]) => w > 0)
    .map((a) => a[0]);
  if (
    x.net <= 1500 ||
    finish.length !== 1 ||
    !["Raw", "Primed", "HDG"].includes(finish[0])
  )
    return "Price/tonne benchmark not applicable (≤1.5 t or mixed/other finishes).";
  let bands = { Raw: [4000, 5000], Primed: [5000, 6500], HDG: [6000, 7500] },
    [min, max] = bands[finish[0]],
    per = x.supplySell / (x.net / 1000);
  return `${money(per)}/t compared with ${finish[0]} benchmark ${money(min)}–${money(max)}/t. ${per < min ? "Below typical range; review, not an automatic price increase." : per > max ? "Above typical range; check complexity." : "Within typical range."}`;
}
function renderReport(x) {
  let target = n(state.project.target) || 26;
  let targetQuote = x.totalCost / (1 - target / 100);
  let a = x.totalCost / 0.76,
    b = x.totalCost / 0.72;
  return section(
    "Final price review",
    "Review your own cost-and-selling build-up. Your overall 24–28% target is a check, not an automatic pricing rule.",
    `<div class="formgrid">${inputField("Final SUPPLY selling override ($)", "finalSupply", state.finalSupply, "number", "Blank = calculated supply selling amount")}${state.project.scope === "sfi" ? inputField("Final INSTALL selling override ($)", "finalInstall", state.finalInstall, "number", "Blank = installer cost plus margin") : ""}${inputField("Target overall gross margin (%)", "project.target", state.project.target, "number")}</div><div class="statstrip"><div>Calculated supply sell: <b>${money(x.supplyCalculated)}</b></div><div>Final supply sell: <b>${money(x.supplySell)}</b></div>${state.project.scope === "sfi" ? `<div>Install sell: <b>${money(x.instSell)}</b></div>` : ""}</div><div class="two" style="margin-top:17px"><div><h3>Overall profitability</h3><p>Cost: <b>${money(x.totalCost)}</b><br>Sell: <b>${money(x.totalSell)}</b><br>Gross profit: <b>${money(x.profit)}</b><br>Margin: <b>${fmt(x.margin)}%</b></p></div><div><h3>Target comparison</h3><p>24–28% margin equivalent: <b>${money(a)} – ${money(b)}</b><br>At your ${fmt(target)}% target: <b>${money(targetQuote)}</b><br><span class="${x.margin >= 24 && x.margin <= 28 ? "badge-good" : "badge-warn"}">${x.margin >= 24 && x.margin <= 28 ? "Within" : "Outside"} 24–28% target</span></p></div></div><div class="notice">These comparisons are unreliable if any required internal cost or supplier quote is missing. Do not raise prices automatically just to reach a benchmark.</div>${warningBox(x)}<div class="rule"><h3>Supply price benchmark</h3><p class="sub">${esc(benchmark(x))}</p></div><div class="rule"><h3>Internal breakdown</h3>${costTable(x)}</div><div class="row" style="margin-top:18px"><button class="btn primary" onclick="exportReport()">Download internal report (.html)</button><button class="btn" onclick="exportCSV()">Download breakdown (.csv)</button><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>`,
  );
}
function buildEmail(x) {
  const project = state.project;
  let address =
    [project.name, project.address].filter(Boolean).join(" — ") ||
    "[Project / Address]";
  let msg = `Hi [Customer],\n\nPlease find our quotation for ${address}.\n\nSupply & Fabrication: ${money(x.supplySell)} + GST\n`;
  if (project.scope === "sfi")
    msg += `Installation: ${money(x.instSell)} + GST\n`;
  msg += `\nScope: [Insert confirmed scope]\nFinish: [Confirm finish]\nLead time: [Enter lead time]\nInclusions / exclusions: [Enter details]\n\nPlease let us know if you would like to proceed.\n\nKind regards,\nSHAHIL KUMAR\nSALES ESTIMATOR\nMascot Steel`;
  return msg;
}
function renderQuote(x) {
  if (emailEdit === null) emailEdit = buildEmail(x);
  return section(
    "Customer quotation email",
    "The customer-facing email contains only the final selling prices, not internal costs, margins or hours. Edit scope, lead time and exclusions yourself before sending.",
    `<div class="notice">This program does not send emails. Copy the draft into your email application, check all details, and send manually.</div><div class="field"><label>Email draft (editable)</label><textarea class="quoteText" id="emailText" oninput="emailEdit=this.value;state.emailDraft=this.value;save()">${esc(emailEdit)}</textarea></div><div class="row" style="margin-top:15px"><button class="btn primary" onclick="copyEmail()">Copy email</button><button class="btn" onclick="emailEdit=buildEmail(calculate());render()">Refresh using latest prices</button></div>`,
  );
}
const tabNames = [
  "Dashboard",
  "Project",
  "PDF / AI",
  "Takeoff",
  "Stock plan",
  "Plates",
  "Costing",
  "Finishing",
  "Review",
  "Email",
  "Settings",
];
function showTab(t) {
  tab = t;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function render() {
  let x = calculate();
  $("tabs").innerHTML = tabNames
    .map(
      (t) =>
        `<button class="tab ${tab === t ? "active" : ""}" onclick="showTab('${t}')">${esc(t)}</button>`,
    )
    .join("");
  $("metrics").innerHTML = metrics(x);
  $("view").innerHTML =
    tab === "Project"
      ? renderProject(x)
      : tab === "PDF / AI"
        ? renderPdfReader()
        : tab === "Takeoff"
          ? renderMembers(x)
          : tab === "Plates"
            ? renderPlates(x)
            : tab === "Stock plan"
              ? renderStock(x)
              : tab === "Costing"
                ? renderCosts(x)
                : tab === "Review"
                  ? renderReport(x)
                  : renderQuote(x);
}
function download(name, body, mime) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  let a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(ext) {
  return (
    (state.project.name || "SteelTakeoff_Job")
      .replace(/[^\w-]+/g, "_")
      .substring(0, 65) + ext
  );
}
function exportJSON() {
  download(
    filename(".json"),
    JSON.stringify({ version: "2.0", ...state }, null, 2),
    "application/json",
  );
}
function importJSON(e) {
  let f = e.target.files?.[0];
  if (!f) return;
  let r = new FileReader();
  r.onload = () => {
    try {
      let data = JSON.parse(r.result);
      if (
        !Array.isArray(data.members) ||
        !Array.isArray(data.plates) ||
        !data.project
      )
        throw Error("Invalid project file");
      state = {
        ...blank(),
        ...data,
        project: { ...blank().project, ...data.project },
      };
      state.project.boltEnabled = String(state.project.boltEnabled) !== "false";
      save();
      emailEdit = null;
      showTab("Project");
    } catch (err) {
      alert("Could not open this project JSON: " + err.message);
    }
  };
  r.readAsText(f);
  e.target.value = "";
}
function csvEscape(v) {
  return '"' + String(v ?? "").replaceAll('"', '""') + '"';
}
function exportCSV() {
  let x = calculate(),
    rows = [
      ["SteelTakeoff AI", "Internal cost & selling breakdown"],
      ["Job", state.project.name],
      ["Net weight kg", x.net],
      [],
      ["Operation", "Hours", "Internal cost", "Selling price"],
    ];
  x.items.forEach((i) =>
    rows.push([i.name, i.hours ?? "", i.cost.toFixed(2), i.sell.toFixed(2)]),
  );
  rows.push(
    ["TOTAL SUPPLY", "", x.supplyCost.toFixed(2), x.supplySell.toFixed(2)],
    ["INSTALL", "", x.installCost.toFixed(2), x.instSell.toFixed(2)],
    ["TOTAL", "", x.totalCost.toFixed(2), x.totalSell.toFixed(2)],
    ["MARGIN %", "", x.margin.toFixed(2)],
  );
  rows.push(
    [],
    [
      "Member mark",
      "Family",
      "Section",
      "Qty",
      "Length mm",
      "kg/m",
      "Finish",
      "Net kg",
      "Drawing file",
      "Page",
      "Evidence",
    ],
  );
  state.members.forEach((r) =>
    rows.push([
      r.mark,
      r.family,
      r.section,
      r.qty,
      r.length,
      r.kgm,
      r.finish,
      (n(r.length) / 1000) * n(r.kgm) * n(r.qty),
      r.sourceFile || "",
      r.sourcePage || "",
      r.sourceEvidence || "",
    ]),
  );
  rows.push(
    [],
    [
      "Stock section",
      "Bought length m",
      "Type",
      "Pieces mm",
      "Gross kg",
      "Cost",
    ],
  );
  x.purchase.allocations.forEach((a) =>
    rows.push([
      a.row.section,
      a.L,
      a.kind,
      a.selected.map((p) => p.length).join("+"),
      a.L * n(a.row.kgm),
      a.cost,
    ]),
  );
  download(
    filename("_estimate.csv"),
    "\ufeff" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function exportReport() {
  let x = calculate(),
    html = `<!doctype html><html><head><meta charset="utf-8"><title>Internal estimate - ${esc(state.project.name)}</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#17263b}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border:1px solid #ced6e2;padding:8px}th{background:#e8edf5}.warn{color:#955d0b}h2{margin-top:28px}</style><link rel="stylesheet" href="/workspace.css">
</head><body><h1>SteelTakeoff AI — Internal Estimate</h1><p>PRIVATE — NOT FOR CUSTOMER ISSUE</p><p>Project: ${esc(state.project.name)}<br>Customer: ${esc(state.project.client)}<br>Address: ${esc(state.project.address)}</p><h2>Final summary</h2><p>Net steel: ${fmt(x.net)} kg. Gross stock: ${fmt(x.purchase.gross)} kg.<br>Internal total cost: ${money(x.totalCost)}<br>Final total sell: ${money(x.totalSell)}<br>Overall gross margin: ${fmt(x.margin)}%</p><h2>Members</h2><table><tr><th>Mark</th><th>Section</th><th>Qty</th><th>Length mm</th><th>Net kg</th><th>Finish</th><th>Drawing page</th></tr>${state.members.map((r) => `<tr><td>${esc(r.mark)}</td><td>${esc(r.section)}</td><td>${esc(r.qty)}</td><td>${esc(r.length)}</td><td>${fmt((n(r.length) / 1000) * n(r.kgm) * n(r.qty))}</td><td>${esc(r.finish)}</td><td>${esc(r.sourceFile || "")} ${esc(r.sourcePage || "")}</td></tr>`).join("")}</table><h2>Stock lengths and nesting</h2><table><tr><th>Section</th><th>Purchase length</th><th>Pieces</th><th>Gross kg</th><th>Buy cost</th><th>Notes</th></tr>${x.purchase.allocations.map((a) => `<tr><td>${esc(a.row.section)}</td><td>${fmt(a.L)}m ${esc(a.kind)}</td><td>${a.selected.map((p) => fmt(p.length)).join(" + ")} mm</td><td>${fmt(a.L * n(a.row.kgm))}</td><td>${money(a.cost)}</td><td>${a.provisional ? "Saw tolerance - confirm" : ""}</td></tr>`).join("")}</table><h2>Hours, costs and selling</h2><table><tr><th>Operation</th><th>Hours</th><th>Cost</th><th>Sell</th></tr>${x.items.map((v) => `<tr><td>${esc(v.name)}</td><td>${v.hours === undefined ? "" : fmt(v.hours)}</td><td>${money(v.cost)}</td><td>${money(v.sell)}</td></tr>`).join("")}</table><h2>Review warnings</h2><ul class="warn">${x.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><p><b>Notes:</b> ${esc(state.project.notes)}</p><p>Prototype report. Verify quantities, actual material prices, subcontractor quotes and production tolerances before committing.</p></body></html>`;
  download(
    filename("_INTERNAL_ESTIMATE.html"),
    html,
    "text/html;charset=utf-8",
  );
}
function copyEmail() {
  let v = $("emailText").value;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(v)
      .then(() => alert("Email copied. Review before sending."))
      .catch(() => {
        let t = $("emailText");
        t.focus();
        t.select();
        alert("Select text and press Ctrl+C to copy.");
      });
  } else {
    let t = $("emailText");
    t.focus();
    t.select();
    alert("Select text and press Ctrl+C to copy.");
  }
}
function loadSample() {
  if (
    state.members.length &&
    !confirm(
      "Replace current project with SAMPLE DATA? Save your project first if needed.",
    )
  )
    return;
  state = blank();
  Object.assign(state.project, {
    name: "DEMO – Small primed posts",
    client: "SAMPLE ONLY",
    scope: "sf",
    finish: "Primed",
    boltCost: 40,
    delivery: "own",
    deliveryCost: 65,
    deliverySell: 125,
  });
  state.members = [
    {
      ...newMember(),
      id: 1,
      mark: "C1",
      family: "SHS",
      section: "100x100x5 SHS",
      kgm: 14.9,
      qty: 4,
      length: 3000,
      finish: "Primed",
      process: "saw",
      heavy: false,
      cuts: 1,
      fabEach: 1,
      efficiency: 90,
      stocks: "",
    },
    {
      ...newMember(),
      id: 2,
      mark: "B1",
      family: "UB",
      section: "250UB31.4",
      kgm: 31.4,
      qty: 2,
      length: 4500,
      finish: "Primed",
      process: "saw",
      cuts: 1,
      fabEach: 1,
      efficiency: 100,
      stocks: "",
    },
  ];
  state.draftMode = "hours";
  state.draftHours = 4;
  state.plateMode = "allowance";
  save();
  emailEdit = null;
  showTab("Project");
}
// Normalise a boolean stored by standard select control.
const originalSetField = setField;
setField = function (path, value) {
  if (path === "project.boltEnabled") value = value === "true";
  originalSetField(path, value);
};

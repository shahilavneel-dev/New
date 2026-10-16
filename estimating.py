"""Deterministic estimating arithmetic, independent of PDF extraction and the UI.

Dimensions are millimetres, member unit weights kg/m, money AUD excluding GST.
Nesting is a documented purchasing heuristic, never an optimality guarantee.
Invalid lines remain visible through validation_errors; no section weights are inferred.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from copy import deepcopy


DEFAULT_RATES = {
    "structural_stock_per_tonne": 1950.0,
    "supplier_cut_per_tonne": 2050.0,
    "supplier_cut_operation": 50.0,
    "hollow_stock_per_tonne": 2050.0,
    "flat_stock_per_tonne": 1900.0,
    "plate_allowance_percent": 12.0,
    "plate_reference_weight": 226.08,
    "plate_reference_price": 390.0,
    "steel_density_kg_mm3": 0.00000785,
    "plate_gap_mm": 3.0,
    "saw_heavy_per_cut": 40.0,
    "saw_standard_per_cut": 25.0,
    "saw_cost_per_hour": 60.68,
    "saw_sell_per_hour": 100.0,
    "tube_cost_per_hour": 180.84,
    "tube_sell_per_hour": 265.0,
    "tube_8m_usable_mm": 7750.0,
    "tube_9m_usable_mm": 8750.0,
    "tube_12m_usable_mm": 11500.0,
    "plate_laser_cost_per_hour": 181.31,
    "plate_laser_sell_per_hour": 248.0,
    "plate_laser_min_hours": 0.5,
    "fabrication_cost_per_hour": 70.01,
    "fabrication_sell_per_hour": 115.0,
    "fabrication_hours_per_tonne": 18.0,
    "drafting_standard_cost_per_tonne": 650.0,
    "drafting_standard_sell_per_tonne": 950.0,
    "drafting_cost_per_hour": 72.56,
    "drafting_sell_per_hour": 110.0,
    "prime_hours_per_tonne": 6.0,
    "prime_min_hours": 0.5,
    "prime_cost_per_hour": 88.58,
    "prime_sell_per_hour": 140.0,
    "hdg_structural_cost_per_kg": 1.82,
    "hdg_structural_sell_per_kg": 2.25,
    "hdg_other_cost_per_kg": 2.0,
    "hdg_other_sell_per_kg": 2.4,
    "hdg_min_cost": 300.0,
    "bolts_sell_per_tonne": 150.0,
    "material_sfi_large_margin": 15.0,
    "material_sfi_small_margin": 20.0,
    "material_sf_margin": 20.0,
    "material_supply_margin": 30.0,
    "installation_margin": 7.5,
    "subcontract_margin": 20.0,
    "own_delivery_sell": 125.0,
    "target_margin": 26.0,
}

STOCK_LENGTHS = {
    "UB": [9, 10.5, 12, 13.5], "UC": [9, 10.5, 12, 13.5],
    "PFC": [9, 10.5, 12, 13.5], "SHS": [8, 12], "RHS": [8, 12],
    "CHS": [6.5, 12], "Pipe": [6.5, 12], "Angle": [7.5, 9], "Flat bar": [6],
}
SUPPLIER_CUT_LENGTHS = [1.5, 3, 4.5, 6, 7.5]
STRUCTURAL = {"UB", "UC", "PFC"}


def _blank(value):
    return value is None or value == ""


def _boolean(value):
    return value is True or value == 1 or str(value).lower() == "true"


def _confirmed(row):
    return _boolean(row.get("lengthConfirmed")) or _boolean(row.get("confirmed"))


def _json_safe(value):
    """Preserve invalid input evidence in errors while keeping reports strict JSON."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


class _Checks:
    def __init__(self):
        self.warnings = []
        self.errors = []
        self.missing = []

    def warn(self, text):
        if text not in self.warnings:
            self.warnings.append(text)

    def missing_cost(self, text):
        if text not in self.missing:
            self.missing.append(text)
        self.warn(text)

    def error(self, text):
        if text not in self.errors:
            self.errors.append(text)
        self.missing_cost(text)

    def number(self, value, label, default=0.0, positive=False, integer=False,
               optional=False, maximum=None):
        if _blank(value):
            if optional:
                return default
            self.error(f"{label}: value is missing.")
            return None
        try:
            number = float(value)
        except (ValueError, TypeError, OverflowError):
            number = float("nan")
        if (not math.isfinite(number) or number < 0 or (positive and number <= 0)
                or (integer and number != math.floor(number))
                or (maximum is not None and number > maximum)):
            self.error(f"{label}: invalid value; enter a finite {'positive' if positive else 'non-negative'}"
                       f"{' whole number' if integer else ' number'}"
                       f"{f' no greater than {maximum}' if maximum is not None else ''}.")
            return None
        return int(number) if integer else number

    def amount(self, value, label, default=0, required=False):
        if _blank(value):
            if required:
                self.missing_cost(f"{label} missing; estimate costs are incomplete.")
            return default
        number = self.number(value, label)
        return number if number is not None else default

    def margin(self, value, label, default):
        if _blank(value):
            return default
        number = self.number(value, label, maximum=99.99)
        return number if number is not None else default


def _rate_table(state, rates, checks):
    result = dict(DEFAULT_RATES)
    overrides = dict(state.get("rates") or {})
    overrides.update(rates or {})
    for key, value in overrides.items():
        if key not in result:
            continue
        number = checks.number(value, f"Rate {key}", positive=key in {
            "plate_reference_weight", "saw_sell_per_hour", "steel_density_kg_mm3"})
        if number is not None:
            if key.endswith("_margin") and number >= 100:
                checks.error(f"Rate {key}: gross margin must be below 100%.")
            else:
                result[key] = number
    return result


def _stock_options(row, state, checks):
    settings = (state.get("sectionSettings") or {}).get(row.get("section", ""), {})
    raw = row.get("stocks") or settings.get("stocks") or STOCK_LENGTHS.get(row["family"], [])
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, (list, tuple)):
        checks.error(f"{row.get('section')}: stock lengths must be a list or comma-separated metres.")
        return [], settings
    lengths = []
    for value in raw:
        length = checks.number(value, f"{row.get('section')} stock length", positive=True)
        if length is not None:
            lengths.append(length)
    if not lengths:
        checks.missing_cost(f"{row.get('section')}: no valid stock availability configured.")
    return sorted(set(lengths)), settings


def _tube_capacity(length_m, rates):
    # Usable limits are specified only for these lengths; do not invent machine limits.
    return {8.0: rates["tube_8m_usable_mm"], 9.0: rates["tube_9m_usable_mm"],
            12.0: rates["tube_12m_usable_mm"]}.get(length_m)


def _eligible_tube(row):
    if row["family"] != "PFC":
        return True
    size = re.search(r"\d+(?:\.\d+)?", row.get("section", ""))
    return size is not None and float(size.group()) <= 200


def _nest_members(members, state, rates, checks):
    project = state.get("project") or {}
    kerf = checks.amount(project.get("kerf", 3), "Cutting kerf", 3)
    tolerance = checks.amount(project.get("sawTol", 10), "Saw estimating tolerance", 10)
    production = _boolean(project.get("productionMode")) or project.get("nestingMode") == "production"
    if production:
        tolerance = 0
    groups = defaultdict(list)
    unallocated, allocations = [], []
    for row in members:
        lengths, settings = _stock_options(row, state, checks)
        if row["process"] == "tube" and not _eligible_tube(row):
            checks.missing_cost(f"{row['section']}: tube laser cannot process PFC above 200 or unknown PFC size.")
            unallocated.append({"row": row, "parts": [{"length": row["length"], "mark": row.get("mark", ""), "qty": row["qty"]}]})
            continue
        confirmed = _confirmed(row)
        if not confirmed:
            checks.warn(f"{row.get('mark') or row['section']}: length unconfirmed; nesting is for estimating only.")
            if production:
                checks.missing_cost(f"{row.get('mark') or row['section']}: production plan requires confirmed member lengths.")
                unallocated.append({"row": row, "parts": [{"length": row["length"], "mark": row.get("mark", ""), "qty": row["qty"]}]})
                continue
        default_rate = rates["structural_stock_per_tonne"] if row["family"] in STRUCTURAL else rates["flat_stock_per_tonne"] if row["family"] == "Flat bar" else rates["hollow_stock_per_tonne"]
        buy_rate = checks.amount(row.get("supplier_price", row.get("supplier_rate", row.get("supplierRate", settings.get("supplier_rate", settings.get("rate", default_rate))))),
                                 f"{row['section']} supplier rate", default_rate)
        cut_rate = checks.amount(settings.get("supplier_cut_rate", settings.get("supplierCutRate", rates["supplier_cut_per_tonne"])),
                                 f"{row['section']} supplier cut rate", rates["supplier_cut_per_tonne"])
        # Supplier cut availability can be explicitly disabled or section-specific.
        allow_cuts = settings.get("supplierCuts", True)
        cuts = settings.get("supplierCutLengths", SUPPLIER_CUT_LENGTHS)
        if isinstance(cuts, str):
            cuts = cuts.split(",")
        cut_lengths = []
        if allow_cuts and row["family"] in STRUCTURAL and row["process"] == "saw":
            for value in cuts:
                length = checks.number(value, f"{row['section']} supplier cut length", positive=True)
                if length is not None:
                    cut_lengths.append(length)
        actual_lengths = settings.get("actualStockLengths", {})
        if not isinstance(actual_lengths, dict):
            checks.error(f"{row['section']}: actualStockLengths must be a nominal-metres to actual-mm mapping.")
            actual_lengths = {}
        key = (row["family"], row["section"], row["kgm"], row["process"], tuple(lengths), buy_rate, cut_rate,
               tuple(cut_lengths), tuple(sorted((str(k), str(v)) for k, v in actual_lengths.items())))
        groups[key].append((row, actual_lengths))
    for key, group in groups.items():
        family, section, kgm, process, lengths, buy_rate, cut_rate, cut_lengths, _ = key
        representative = group[0][0]
        parts = []
        for row, _actual in group:
            parts.extend({"length": row["length"], "mark": row.get("mark") or section,
                          "memberId": row.get("id"), "lengthConfirmed": _confirmed(row)}
                         for _ in range(row["qty"]))
        parts.sort(key=lambda part: (-part["length"], part["mark"]))
        options = [(length, "stock", buy_rate) for length in lengths]
        options += [(length, "supplier cut", cut_rate) for length in cut_lengths]
        while parts:
            candidates = []
            for length, kind, rate in options:
                nominal = _tube_capacity(length, rates) if process == "tube" else length * 1000
                if nominal is None:
                    checks.warn(f"{section}: no confirmed tube usable capacity for {length:g} m; excluded from tube nesting.")
                    continue
                if nominal > length * 1000:
                    checks.error(f"{section}: usable tube capacity exceeds purchased stock length.")
                    continue
                actual_map = group[0][1]
                actual = actual_map.get(str(length), actual_map.get(f"{length:g}"))
                if process == "saw" and actual is not None:
                    actual = checks.number(actual, f"{section} actual stock length", positive=True)
                    if actual is not None:
                        nominal = actual
                capacity = nominal + (tolerance if process == "saw" else 0)
                if parts[-1]["length"] > capacity + 1e-7:
                    continue
                picked, used = [], 0.0
                for index, part in enumerate(parts):
                    required = part["length"] + (kerf if picked else 0)
                    if used + required <= capacity + 1e-7:
                        picked.append(index)
                        used += required
                        if capacity - used + 1e-7 < parts[-1]["length"] + kerf:
                            break
                if not picked:
                    continue
                part_length = sum(parts[i]["length"] for i in picked)
                cost = length * kgm * rate / 1000 + (rates["supplier_cut_operation"] if kind == "supplier cut" else 0)
                candidates.append((cost / part_length, cost, kind != "stock", length, kind, picked, used, nominal))
            if not candidates:
                unallocated.append({"row": representative, "parts": parts})
                checks.missing_cost(f"{section}: {len(parts)} members cannot fit configured purchasing lengths; material cost incomplete.")
                break
            _, cost, _, length, kind, picked, used, nominal = min(candidates, key=lambda c: c[:4])
            chosen = set(picked)
            selected = [parts[i] for i in picked]
            provisional = used > nominal + 1e-7
            if provisional:
                checks.warn(f"{section}: near-limit saw allocation uses estimating tolerance; verify actual stock and kerf before production.")
            allocations.append({"row": representative, "L": length, "kind": kind, "cost": cost,
                                "selected": selected, "used": used, "nominal": nominal,
                                "remainingNominal": nominal - used, "provisional": provisional,
                                "kerf": kerf, "gross": length * kgm,
                                "productionReady": not provisional and all(p["lengthConfirmed"] for p in selected)
                                and _boolean(project.get("stockLengthsConfirmed"))})
            parts = [part for index, part in enumerate(parts) if index not in chosen]
    gross = sum(a["gross"] for a in allocations)
    member_weight = sum(p["length"] / 1000 * a["row"]["kgm"] for a in allocations for p in a["selected"])
    return {"allocations": allocations, "unallocated": unallocated, "warnings": [],
            "gross": gross, "cost": sum(a["cost"] for a in allocations),
            "net": member_weight, "waste": max(0, gross - member_weight),
            "nominalShortfallWeight": max(0, member_weight - gross),
            "method": "cost-aware best-fit decreasing heuristic; not guaranteed globally optimal"}


def provisional_plates(weight, rates=None):
    """Return quarter-sheet allowance for a known estimated fabricated plate weight."""
    r = {**DEFAULT_RATES, **(rates or {})}
    if not math.isfinite(float(weight)) or weight < 0:
        raise ValueError("Plate weight must be a finite non-negative number")
    fraction = math.ceil(max(0, weight / r["plate_reference_weight"] * 4 - 1e-10)) / 4
    return {"fraction": fraction, "weight": fraction * r["plate_reference_weight"],
            "cost": fraction * r["plate_reference_price"]}


def _pack_rectangles(parts, width, height, gap):
    """Conservative, rotation-aware guillotine packing; all free rectangles disjoint.

    Inflate parts and sheet by one gap so adjacent parts retain the gap while
    outside sheet edges do not need a fictitious gap. Whole sheets are purchased.
    """
    sheets, rejected = [], []
    for part in sorted(parts, key=lambda p: (-max(p["length"], p["width"]), -p["length"] * p["width"], p["label"])):
        choices = []
        for si, sheet in enumerate(sheets):
            for fi, (x, y, free_w, free_h) in enumerate(sheet["free"]):
                for pw, ph, rotated in [(part["width"], part["length"], False), (part["length"], part["width"], True)]:
                    if pw + gap <= free_w + 1e-7 and ph + gap <= free_h + 1e-7:
                        choices.append((min(free_w - pw - gap, free_h - ph - gap),
                                        free_w * free_h - (pw + gap) * (ph + gap), si, fi, pw, ph, rotated))
        if not choices:
            orientations = [(part["width"], part["length"], False), (part["length"], part["width"], True)]
            fit = [(pw, ph, rot) for pw, ph, rot in orientations if pw <= width and ph <= height]
            if not fit:
                rejected.append(part)
                continue
            si = len(sheets)
            sheets.append({"width": width, "height": height, "parts": [], "free": [(0, 0, width + gap, height + gap)]})
            pw, ph, rotated = min(fit, key=lambda p: min(width - p[0], height - p[1]))
            choices = [(0, 0, si, 0, pw, ph, rotated)]
        _, _, si, fi, pw, ph, rotated = min(choices)
        sheet = sheets[si]
        x, y, free_w, free_h = sheet["free"].pop(fi)
        dw, dh = pw + gap, ph + gap
        # Split into two nonoverlapping rectangles (choose the larger strip).
        if free_w - dw > free_h - dh:
            new_free = [(x + dw, y, free_w - dw, free_h), (x, y + dh, dw, free_h - dh)]
        else:
            new_free = [(x + dw, y, free_w - dw, dh), (x, y + dh, free_w, free_h - dh)]
        sheet["free"].extend(rect for rect in new_free if rect[2] > 1e-7 and rect[3] > 1e-7)
        sheet["parts"].append({**part, "x": x, "y": y, "packedWidth": pw, "packedHeight": ph, "rotated": rotated})
    for sheet in sheets:
        sheet.pop("free")
    return sheets, rejected


def _plate_calculation(state, purchase, rates, checks):
    mode = state.get("plateMode", "allowance")
    if mode == "none":
        return 0, 0, 0, []
    if mode == "allowance":
        net = purchase["gross"] * rates["plate_allowance_percent"] / 100
        allowance = provisional_plates(net, rates)
        sheets = ([{"thick": 10, "fraction": allowance["fraction"], "weight": allowance["weight"],
                    "desc": "Provisional 1200×2400×10 mm equivalent (quarter-sheet costing allowance)",
                    "provisional": True, "layouts": []}] if net else [])
        if net:
            checks.warn("Plate allowance is provisional; fabricated plate weight differs from charged reference-sheet material.")
        return net, allowance["weight"], allowance["cost"], sheets
    if mode != "detailed":
        checks.error("Unknown plate calculation mode.")
        return 0, 0, 0, []
    raw_size = state.get("plateSheet", "1200x2400")
    if raw_size == "auto":
        sizes = [(1200, 2400), (1500, 3000)]
    else:
        match = re.fullmatch(r"(1200)x(2400)|(1500)x(3000)", str(raw_size))
        if not match:
            checks.error("Plate sheet must be 1200x2400, 1500x3000, or auto.")
            return 0, 0, 0, []
        sizes = [tuple(map(int, str(raw_size).split("x")))]
    gap = checks.amount(state.get("plateGap", (state.get("project") or {}).get("plateGap", rates["plate_gap_mm"])), "Plate cutting gap", rates["plate_gap_mm"])
    groups, net = defaultdict(list), 0.0
    expanded_qty = 0
    for index, source in enumerate(state.get("plates") or []):
        label = source.get("label") or f"plate {index + 1}"
        values = {key: checks.number(source.get(key), f"{label} {key}", positive=True, integer=key == "qty",
                                    maximum=10000 if key == "qty" else None)
                  for key in ("length", "width", "thick", "qty")}
        if any(value is None for value in values.values()):
            continue
        expanded_qty += values["qty"]
        if expanded_qty > 50000:
            checks.error("Detailed plates exceed 50,000 total pieces; divide the estimate into batches. No excess quantities were silently truncated.")
            continue
        net += values["length"] * values["width"] * values["thick"] * values["qty"] * rates["steel_density_kg_mm3"]
        for _ in range(values["qty"]):
            groups[values["thick"]].append({"label": label, "length": values["length"], "width": values["width"]})
    sheets, gross, cost = [], 0.0, 0.0
    for thick, parts in sorted(groups.items()):
        candidates = []
        for sw, sh in sizes:
            layouts, rejected = _pack_rectangles(parts, sw, sh, gap)
            weight = len(layouts) * sw * sh * thick * rates["steel_density_kg_mm3"]
            candidates.append((len(rejected), weight, sw, sh, layouts, rejected))
        _, weight, sw, sh, layouts, rejected = min(candidates, key=lambda c: c[:2])
        for part in rejected:
            checks.missing_cost(f"Plate {part['label']}: {part['length']:g}×{part['width']:g} mm cannot fit configured sheet; material cost incomplete.")
        count = len(layouts)
        gross += weight
        cost += weight * rates["plate_reference_price"] / rates["plate_reference_weight"]
        sheets.append({"thick": thick, "fraction": count, "count": count, "weight": weight,
                       "desc": f"{sw}×{sh}×{thick:g} mm whole sheets — conservative geometric guillotine packing",
                       "sheetWidth": sw, "sheetHeight": sh, "gap": gap, "layouts": layouts,
                       "rejected": rejected, "provisional": False})
    if sheets:
        checks.warn("Plate layouts use a conservative rectangular packing heuristic with rotation and cutting gaps; verify production toolpaths.")
    return net, gross, cost, sheets


def _heavy_saw(row):
    if _boolean(row.get("heavy")) or row["family"] in STRUCTURAL:
        return True
    if row["family"] not in {"SHS", "RHS", "Angle"}:
        return False
    dimensions = re.findall(r"\d+(?:\.\d+)?", row.get("section", ""))
    if len(dimensions) >= 3:
        a, b, t = map(float, dimensions[:3])
        return a > 100 or b > 100 or (a >= 100 and b >= 100 and t > 5)
    return False


def calculate(state, rates=None):
    """Calculate a V2-compatible result and explicit completeness/review information.

    Missing internal costs suppress verified margin/profit. The subtotal remains
    available for review, with provisional_margin/provisional_profit labelled.
    """
    state = deepcopy(state or {})
    project = state.get("project") or {}
    checks = _Checks()
    r = _rate_table(state, rates, checks)
    members = []
    marks = defaultdict(int)
    expanded_qty = 0
    for index, source in enumerate(state.get("members") or []):
        if not isinstance(source, dict):
            checks.error(f"Member {index + 1}: expected an editable member object.")
            continue
        row = dict(source)
        label = row.get("mark") or row.get("section") or f"Member {index + 1}"
        values = {key: checks.number(row.get(key), f"{label} {key}", positive=True, integer=key == "qty",
                                    maximum=10000 if key == "qty" else None)
                  for key in ("qty", "length", "kgm")}
        if any(value is None for value in values.values()):
            continue
        expanded_qty += values["qty"]
        if expanded_qty > 50000:
            checks.error("Members exceed 50,000 total pieces; divide the estimate into batches. No excess quantities were silently truncated.")
            continue
        row.update(values)
        row.setdefault("family", "")
        row.setdefault("section", "")
        row.setdefault("process", "saw")
        row.setdefault("finish", project.get("finish", "Raw"))
        if row["process"] not in {"saw", "tube"}:
            checks.error(f"{label}: unknown cutting process.")
            continue
        if not row["section"].strip():
            checks.error(f"{label}: section designation is missing.")
            continue
        if row.get("mark"):
            marks[row["mark"]] += 1
        members.append(row)
    for mark, count in marks.items():
        if count > 1:
            checks.warn(f"Duplicate member mark {mark} appears on {count} lines; confirm these are distinct members or revisions.")
    purchase = _nest_members(members, state, r, checks)
    net_members = sum(m["length"] / 1000 * m["kgm"] * m["qty"] for m in members)
    plate_weight, plate_gross, plate_buy, plate_sheets = _plate_calculation(state, purchase, r, checks)
    net = net_members + plate_weight
    scope = project.get("scope", "sfi")
    if scope not in {"sfi", "sf", "supply"}:
        checks.error("Project scope must be sfi, sf, or supply.")
    automatic_margin = (r["material_sfi_large_margin"] if net > 3000 else r["material_sfi_small_margin"]) if scope == "sfi" else r["material_sf_margin"] if scope == "sf" else checks.margin(state.get("supplyOnlyMargin"), "Supply-only margin", r["material_supply_margin"])
    material_margin = checks.margin(state.get("materialMarginOverride"), "Material margin", automatic_margin)
    material_cost = purchase["cost"] + plate_buy
    material_sell = material_cost / (1 - material_margin / 100)
    saw_sell = 0.0
    saw_cuts = 0.0
    for row in members:
        if row["process"] != "saw":
            continue
        cuts = checks.amount(row.get("cuts"), f"{row.get('mark') or row['section']} saw cuts per piece", required=True)
        saw_cuts += row["qty"] * cuts
        saw_sell += row["qty"] * cuts * r["saw_heavy_per_cut" if _heavy_saw(row) else "saw_standard_per_cut"]
    saw_hours = saw_sell / r["saw_sell_per_hour"]
    tube_exists = any(m["process"] == "tube" for m in members)
    tube_hours = checks.amount(state.get("tubeHours"), "Tube laser manager hours", required=True) if tube_exists else 0
    fabrication_hours = 0.0
    fab_suggestions = []
    if scope != "supply" and net > 2000:
        hpt = checks.amount(state.get("fabHoursT", r["fabrication_hours_per_tonne"]), "Fabrication hours per tonne", r["fabrication_hours_per_tonne"])
        fabrication_hours = net / 1000 * hpt
        bands = {"extra": (8, 12), "heavy": (12, 16), "medium": (16, 20), "light": (20, 22)}
        low, high = bands.get(state.get("fabClass", "medium"), (16, 20))
        if not low <= hpt <= high:
            checks.warn(f"Fabrication {hpt:g} hrs/t is outside selected classification {low}–{high}; review complexity.")
    elif scope != "supply":
        for row in members:
            label = row.get("mark") or row["section"]
            hours = checks.amount(row.get("fabEach"), f"{label} assembly fabrication hours", required=True)
            efficiency = checks.number(row.get("efficiency", 100), f"{label} repeat percentage", maximum=100)
            efficiency = 100 if efficiency is None else efficiency
            fabrication_hours += row["qty"] * hours * efficiency / 100
            section = re.sub(r"\s", "", row["section"]).upper()
            suggested = 1.0 if section in {"100X100X5SHS", "SHS100X100X5"} else 0.5 if section in {"50X50X5SHS", "SHS50X50X5"} else None
            if suggested is not None:
                fab_suggestions.append({"mark": label, "hoursEach": suggested, "basis": "Post with top and bottom plates; confirm assembly details before applying"})
    finish_weights = {"Raw": 0.0, "Primed": 0.0, "HDG": 0.0, "Powder": 0.0, "Cold galv": 0.0}
    hdg_struct, hdg_other = 0.0, 0.0
    for row in members:
        weight = row["length"] / 1000 * row["kgm"] * row["qty"]
        finish = row["finish"]
        if finish not in finish_weights:
            checks.missing_cost(f"{row.get('mark') or row['section']}: unknown finish {finish!r}; finishing cost incomplete.")
            finish_weights.setdefault(finish, 0.0)
        finish_weights[finish] += weight
        if finish == "HDG":
            if row["family"] in STRUCTURAL:
                hdg_struct += weight
            else:
                hdg_other += weight
    if net_members:
        factor = (net_members + plate_weight) / net_members
        finish_weights = {key: value * factor for key, value in finish_weights.items()}
        hdg_struct *= factor
        hdg_other *= factor
    elif plate_weight:
        finish = project.get("finish", "Raw")
        finish_weights[finish] = plate_weight
        if finish == "HDG":
            hdg_other = plate_weight
    prime_hours = max(r["prime_min_hours"], finish_weights.get("Primed", 0) / 1000 * r["prime_hours_per_tonne"]) if finish_weights.get("Primed", 0) else 0
    hdg_base_cost = hdg_struct * r["hdg_structural_cost_per_kg"] + hdg_other * r["hdg_other_cost_per_kg"]
    hdg_base_sell = hdg_struct * r["hdg_structural_sell_per_kg"] + hdg_other * r["hdg_other_sell_per_kg"]
    hdg_cost = max(r["hdg_min_cost"], hdg_base_cost) if hdg_struct + hdg_other else 0
    hdg_sell = hdg_cost * hdg_base_sell / hdg_base_cost if hdg_base_cost else 0
    plate_hours = max(r["plate_laser_min_hours"], checks.amount(state.get("plateLaserHours", r["plate_laser_min_hours"]), "Plate laser hours", r["plate_laser_min_hours"])) if plate_weight else 0
    draft_hours = draft_cost = draft_sell = 0.0
    draft_mode = state.get("draftMode", "standard")
    if scope != "supply":
        if draft_mode == "standard":
            if 0 < net < 1500:
                draft_cost = net / 1000 * r["drafting_standard_cost_per_tonne"]
                draft_sell = net / 1000 * r["drafting_standard_sell_per_tonne"]
            elif net >= 1500:
                checks.missing_cost("Draftsman quote required at or above 1.5 t; drafting is unpriced.")
        elif draft_mode == "hours":
            draft_hours = checks.amount(state.get("draftHours"), "Drafting hours", required=True)
            draft_cost = draft_hours * r["drafting_cost_per_hour"]
            draft_sell = draft_hours * r["drafting_sell_per_hour"]
        elif draft_mode == "outsource":
            draft_cost = checks.amount(state.get("draftQuote"), "Draftsman subcontract quotation", required=net > 0)
            draft_sell = draft_cost / (1 - checks.margin(state.get("draftMargin"), "Drafting margin", r["subcontract_margin"]) / 100)
        elif draft_mode != "none":
            checks.error("Unknown drafting calculation method.")
    powder_cost = powder_sell = cold_cost = cold_sell = 0.0
    if finish_weights.get("Powder", 0):
        powder_cost = checks.amount(state.get("powderQuote"), "Powder coating supplier quotation", required=True)
        powder_sell = powder_cost / (1 - checks.margin(state.get("powderMargin"), "Powder coating margin", r["subcontract_margin"]) / 100)
    if finish_weights.get("Cold galv", 0):
        cold_cost = checks.amount(state.get("coldGalvCost"), "Cold galvanising manual cost", required=True)
        cold_sell = checks.amount(state.get("coldGalvSell"), "Cold galvanising manual selling allowance", required=True)
    bolt_enabled = _boolean(project.get("boltEnabled", True))
    bolt_sell = net / 1000 * r["bolts_sell_per_tonne"] if bolt_enabled else 0
    bolt_cost = checks.amount(project.get("boltCost"), "Internal bolt / fastener cost", required=bolt_enabled and net > 0) if bolt_enabled else 0
    longest = max((row["length"] for row in members), default=0)
    delivery_cost = delivery_sell = 0.0
    delivery = project.get("delivery", "none")
    suggestion = "Own truck: suggested selling allowance $100–$150; enter internal cost." if net < 3000 and longest < 10000 else "External transport quotation required (3 t or 10 m threshold reached)."
    if delivery == "own":
        delivery_sell = checks.amount(project.get("deliverySell", r["own_delivery_sell"]), "Own truck selling charge", r["own_delivery_sell"])
        delivery_cost = checks.amount(project.get("deliveryCost"), "Own truck internal delivery cost", required=True)
        if net >= 3000 or longest >= 10000:
            checks.missing_cost("Own-truck threshold reached; external transport quote required.")
    elif delivery == "external":
        delivery_cost = checks.amount(project.get("transportCost"), "External transport quotation", required=True)
        delivery_sell = delivery_cost / (1 - checks.margin(project.get("transportMargin"), "Transport margin", r["subcontract_margin"]) / 100)
    elif delivery != "none":
        checks.error("Unknown delivery method.")
    install_cost = install_sell = 0.0
    if scope == "sfi":
        install_cost = checks.amount(state.get("installerQuote"), "Installation subcontractor quotation", required=net > 0)
        install_sell = install_cost / (1 - checks.margin(state.get("installerMargin"), "Installation margin", r["installation_margin"]) / 100)
    def item(name, cost, sell, hours=None):
        entry = {"name": name, "cost": cost, "sell": sell}
        if hours is not None:
            entry["hours"] = hours
        return entry
    items = [item("Structural steel stock + plates (material)", material_cost, material_sell),
             item("Saw cutting", saw_hours * r["saw_cost_per_hour"], saw_sell, saw_hours),
             item("Tube laser", tube_hours * r["tube_cost_per_hour"], tube_hours * r["tube_sell_per_hour"], tube_hours),
             item("Plate laser", plate_hours * r["plate_laser_cost_per_hour"], plate_hours * r["plate_laser_sell_per_hour"], plate_hours),
             item("Fabrication", fabrication_hours * r["fabrication_cost_per_hour"], fabrication_hours * r["fabrication_sell_per_hour"], fabrication_hours),
             item("Priming", prime_hours * r["prime_cost_per_hour"], prime_hours * r["prime_sell_per_hour"], prime_hours),
             item("HDG", hdg_cost, hdg_sell), item("Drafting", draft_cost, draft_sell, draft_hours),
             item("Powder coating", powder_cost, powder_sell), item("Cold galvanising", cold_cost, cold_sell),
             item("Bolts / fasteners", bolt_cost, bolt_sell), item("Delivery / transport", delivery_cost, delivery_sell),
             item("Other / contingency", checks.amount(state.get("otherCost", 0), "Other internal cost"), checks.amount(state.get("otherSell", 0), "Other selling charge"))]
    supply_cost = sum(entry["cost"] for entry in items)
    supply_calculated = sum(entry["sell"] for entry in items)
    supply_sell = checks.amount(state.get("finalSupply"), "Final supply selling override", supply_calculated)
    inst_sell = checks.amount(state.get("finalInstall"), "Final installation selling override", install_sell) if scope == "sfi" else 0
    total_cost, total_sell = supply_cost + install_cost, supply_sell + inst_sell
    provisional_profit = total_sell - total_cost
    provisional_margin = provisional_profit / total_sell * 100 if total_sell else 0
    if not members and not plate_weight:
        checks.missing_cost("No valid members or plates entered; estimate is incomplete.")
    cost_complete = not checks.missing
    if not cost_complete:
        checks.warn("Incomplete estimate: internal costs or validated quantities are missing; overall profit and margin are unverified.")
    production_ready = bool(purchase["allocations"]) and not purchase["unallocated"] and not checks.errors and all(a["productionReady"] for a in purchase["allocations"]) and not plate_weight
    benchmark = None
    active_finishes = [finish for finish, weight in finish_weights.items() if weight > 0]
    bands = {"Raw": (4000, 5000), "Primed": (5000, 6500), "HDG": (6000, 7500)}
    if net > 1500 and len(active_finishes) == 1 and active_finishes[0] in bands:
        low, high = bands[active_finishes[0]]
        benchmark = {"finish": active_finishes[0], "low": low, "high": high, "actual": supply_sell / (net / 1000), "advisory": True}
    plate_benchmarks = []
    for sheet in plate_sheets:
        thick = sheet["thick"]
        rate = 3.25 if 10 <= thick <= 12 else 3.35 if 16 <= thick <= 20 else None
        if rate:
            plate_benchmarks.append({"thick": thick, "sellPerKg": rate, "advisory": True})
    plate_layouts = []
    for group in plate_sheets:
        for layout in group["layouts"]:
            plate_layouts.append({"width": layout["width"], "height": layout["height"], "thick": group["thick"],
                                  "parts": [{**part, "width": part["packedWidth"], "height": part["packedHeight"]}
                                            for part in layout["parts"]]})
    return _json_safe({"purchase": purchase, "netMembers": net_members, "net": net, "plateWeight": plate_weight,
            "plateBuy": plate_buy, "plateGross": plate_gross, "plateSheets": plate_sheets,
            "materialCost": material_cost, "materialMargin": material_margin, "matSell": material_sell,
            "automaticMargin": automatic_margin, "sawCuts": saw_cuts, "sawH": saw_hours,
            "tubeH": tube_hours, "plateH": plate_hours, "fabH": fabrication_hours, "primeH": prime_hours,
            "finishWeights": finish_weights, "items": items, "installCost": install_cost,
            "installSell": install_sell, "supplyCost": supply_cost, "supplyCalculated": supply_calculated,
            "supplySell": supply_sell, "instSell": inst_sell, "totalCost": total_cost,
            "totalSell": total_sell, "profit": provisional_profit if cost_complete else None,
            "margin": provisional_margin if cost_complete else None, "provisional_profit": provisional_profit,
            "provisional_margin": provisional_margin, "boltSell": bolt_sell, "warnings": checks.warnings,
            "longest": longest, "cost_complete": cost_complete, "missing_costs": checks.missing,
            "validation_errors": checks.errors, "production_ready": production_ready,
            "deliverySuggestion": suggestion, "benchmark": benchmark, "plateBenchmarks": plate_benchmarks,
            "fabricationSuggestions": fab_suggestions, "rates": r, "plateLayouts": plate_layouts,
            "pricePerTonne": supply_sell / (net / 1000) if net else None})


def build_email(state, result):
    """Customer text uses an explicit allowlist; internal notes and costs never copied."""
    project = state.get("project") or {}
    quotation = state.get("quotation") or {}
    address = " — ".join(str(project.get(key) or "") for key in ("name", "address") if project.get(key)) or "[Project / Address]"
    customer = str(project.get("contact") or project.get("client") or "[Customer]")
    text = f"Hi {customer},\n\nPlease find our quotation for {address}.\n\nSupply & Fabrication: ${result['supplySell']:,.2f} + GST\n"
    if project.get("scope", "sfi") == "sfi":
        text += f"Installation: ${result['instSell']:,.2f} + GST\n"
    text += (f"\nScope: {quotation.get('scope') or project.get('quoteScope') or '[Insert confirmed scope]'}\n"
             f"Finish: {quotation.get('finish') or '[Confirm finish]'}\n"
             f"Lead time: {quotation.get('leadTime') or project.get('leadTime') or '[Enter lead time]'}\n"
             f"Inclusions / exclusions: {quotation.get('exclusions') or project.get('exclusions') or '[Enter details]'}\n\n"
             "Please let us know if you would like to proceed.\n\nKind regards,\n[Your name]")
    return text

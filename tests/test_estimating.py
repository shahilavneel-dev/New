"""Calculation examples from the estimating brief and physical/financial regressions."""
import copy
import json
import math
import unittest

from estimating import DEFAULT_RATES, build_email, calculate, provisional_plates


def member(**overrides):
    return {"mark": "B1", "family": "UB", "section": "250UB31.4", "kgm": 31.4,
            "qty": 1, "length": 4000, "finish": "Raw", "process": "saw", "cuts": 1,
            "fabEach": 1, "efficiency": 100, "stocks": "", **overrides}


def state(*members, **overrides):
    return {"project": {"scope": "sf", "kerf": 3, "sawTol": 10, "finish": "Raw",
                         "boltEnabled": False, "delivery": "none"},
            "members": list(members), "plates": [], "plateMode": "none",
            "draftMode": "none", "fabHoursT": 18, "fabClass": "medium",
            "finalSupply": "", "finalInstall": "", **overrides}


def item(result, name):
    return next(entry for entry in result["items"] if entry["name"] == name)


class CalculationExamples(unittest.TestCase):
    def test_two_4m_beams_one_9m_stock(self):
        result = calculate(state(member(qty=2)))
        allocations = result["purchase"]["allocations"]
        self.assertEqual(len(allocations), 1)
        self.assertEqual(allocations[0]["L"], 9)
        self.assertEqual(len(allocations[0]["selected"]), 2)
        self.assertAlmostEqual(result["purchase"]["cost"], 9 * 31.4 * 1.95)

    def test_tube_9m_usable_is_8750(self):
        project = state(member(family="RHS", section="RHS verified", length=8750,
                               stocks="9", process="tube"), tubeHours=1)
        result = calculate(project)
        self.assertEqual(result["purchase"]["allocations"][0]["nominal"], 8750)
        project["members"][0]["length"] = 8751
        self.assertTrue(calculate(project)["purchase"]["unallocated"])

    def test_tube_other_usable_limits_and_unknown_machine_capacity(self):
        for length, capacity in [(8, 7750), (12, 11500)]:
            result = calculate(state(member(family="SHS", section="SHS verified", stocks=str(length),
                                            length=capacity, process="tube"), tubeHours=1))
            self.assertEqual(result["purchase"]["allocations"][0]["nominal"], capacity)
        unknown = calculate(state(member(family="CHS", section="CHS verified", stocks="6.5", process="tube"), tubeHours=1))
        self.assertTrue(unknown["purchase"]["unallocated"])

    def test_provisional_160kg_rounds_to_three_quarter_sheet(self):
        allocation = provisional_plates(160)
        self.assertEqual(allocation["fraction"], .75)
        self.assertEqual(allocation["cost"], 292.5)
        self.assertAlmostEqual(allocation["weight"], 169.56)

    def test_galvanising_100kg_ub_minimum(self):
        result = calculate(state(member(kgm=25, finish="HDG")))
        hdg = item(result, "HDG")
        self.assertEqual(hdg["cost"], 300)
        self.assertAlmostEqual(hdg["sell"], 370.8791208791)

    def test_mixed_galvanising_weighted_ratio_and_plate_only(self):
        result = calculate(state(member(kgm=12.5, finish="HDG"),
                                 member(mark="C1", family="SHS", section="Verified SHS", kgm=12.5, finish="HDG")))
        hdg = item(result, "HDG")
        self.assertEqual(hdg["cost"], 300)
        self.assertAlmostEqual(hdg["sell"], 300 * (50 * 2.25 + 50 * 2.4) / (50 * 1.82 + 50 * 2))
        plates = state(plateMode="detailed", plates=[{"label": "BP", "length": 200, "width": 200, "thick": 10, "qty": 1}])
        plates["project"]["finish"] = "HDG"
        self.assertEqual(item(calculate(plates), "HDG")["cost"], 300)

    def test_3_tonne_fabrication_54_hours(self):
        result = calculate(state(member(kgm=100, qty=5, length=6000)))
        self.assertEqual(result["net"], 3000)
        self.assertEqual(result["fabH"], 54)

    def test_one_tonne_priming_6_hours(self):
        result = calculate(state(member(kgm=100, qty=2, length=5000, finish="Primed")))
        self.assertEqual(result["primeH"], 6)
        self.assertAlmostEqual(item(result, "Priming")["cost"], 6 * 88.58)

    def test_drafting_1_2_tonne_standard(self):
        result = calculate(state(member(kgm=100, qty=2, length=6000), draftMode="standard"))
        self.assertEqual(item(result, "Drafting")["cost"], 780)
        self.assertEqual(item(result, "Drafting")["sell"], 1140)

    def test_installation_gross_margin(self):
        project = state(member(), installerQuote=10000, installerMargin=7.5)
        project["project"]["scope"] = "sfi"
        self.assertAlmostEqual(calculate(project)["instSell"], 10810.81081081081)

    def test_material_sfi_threshold_uses_net_including_plates(self):
        project = state(member(kgm=100, qty=5, length=6000), installerQuote=0)
        project["project"]["scope"] = "sfi"
        self.assertEqual(calculate(project)["materialMargin"], 20)
        project["plates"] = [{"label": "BP", "length": 100, "width": 100, "thick": 10, "qty": 1}]
        project["plateMode"] = "detailed"
        self.assertEqual(calculate(project)["materialMargin"], 15)

    def test_missing_costs_suppress_verified_profit_and_margin(self):
        project = state(member(fabEach=""))
        project["project"]["boltEnabled"] = True
        result = calculate(project)
        self.assertFalse(result["cost_complete"])
        self.assertIsNone(result["margin"])
        self.assertIsNone(result["profit"])
        self.assertGreater(len(result["missing_costs"]), 1)
        self.assertTrue(any("Incomplete estimate" in warning for warning in result["warnings"]))

    def test_email_contains_selling_only(self):
        project = state(member(), installerQuote=12345.67)
        project["project"].update(scope="sfi", notes="SECRET BUY COST $1991", client="Client")
        result = calculate(project)
        text = build_email(project, result)
        self.assertIn(f"${result['supplySell']:,.2f} + GST", text)
        self.assertIn(f"${result['instSell']:,.2f} + GST", text)
        self.assertNotIn("SECRET", text)
        self.assertNotIn("12,345.67", text)
        for confidential in ("internal", "margin", "profit", "70.01", "60.68", "1950"):
            self.assertNotIn(confidential, text.lower())

    def test_email_uses_actual_frontend_quotation_fields(self):
        project = state(member())
        project["project"].update(contact="Alex", quoteScope="Selected beams B1 and B2 only",
                                  leadTime="Three weeks", exclusions="No site painting")
        text = build_email(project, calculate(project))
        for expected in ("Hi Alex", "Selected beams B1 and B2 only", "Three weeks", "No site painting"):
            self.assertIn(expected, text)


class PhysicalAndInputRegressions(unittest.TestCase):
    def test_no_silent_250_quantity_cap(self):
        result = calculate(state(member(qty=300, length=1000)))
        allocated = sum(len(a["selected"]) for a in result["purchase"]["allocations"])
        self.assertEqual(allocated, 300)
        self.assertEqual(result["netMembers"], 9420)

    def test_excess_quantity_is_explicitly_rejected_without_expansion(self):
        result = calculate(state(member(qty=1000000000)))
        self.assertFalse(result["cost_complete"])
        self.assertTrue(any("10000" in e for e in result["validation_errors"]))
        self.assertFalse(result["purchase"]["allocations"])
        plates = calculate(state(plateMode="detailed", plates=[
            {"label": "Overload", "length": 100, "width": 100, "thick": 10, "qty": 1000000000}]))
        self.assertTrue(plates["validation_errors"])

    def test_kerf_and_estimating_tolerance(self):
        project = state(member(qty=2, length=4500, stocks="9"))
        project["sectionSettings"] = {"250UB31.4": {"supplierCuts": False}}
        result = calculate(project)
        self.assertEqual(len(result["purchase"]["allocations"]), 1)
        self.assertTrue(result["purchase"]["allocations"][0]["provisional"])
        project["project"]["sawTol"] = 0
        self.assertEqual(len(calculate(project)["purchase"]["allocations"]), 2)

    def test_production_requires_confirmed_dimensions_and_zero_tolerance(self):
        project = state(member(qty=2, length=4500, stocks="9"))
        project["project"].update(productionMode=True, stockLengthsConfirmed=True)
        project["sectionSettings"] = {"250UB31.4": {"supplierCuts": False}}
        self.assertTrue(calculate(project)["purchase"]["unallocated"])
        project["members"][0]["lengthConfirmed"] = True
        result = calculate(project)
        self.assertEqual(len(result["purchase"]["allocations"]), 2)
        self.assertTrue(result["production_ready"])

    def test_pfc_250_tube_is_blocked_not_merely_warned(self):
        result = calculate(state(member(family="PFC", section="250PFC", process="tube"), tubeHours=2))
        self.assertFalse(result["purchase"]["allocations"])
        self.assertTrue(result["purchase"]["unallocated"])
        self.assertFalse(result["cost_complete"])

    def test_invalid_weights_lengths_and_quantities_are_explicit(self):
        for field in ("qty", "length", "kgm"):
            for invalid in (-1, 0, float("nan"), float("inf"), "unknown", None):
                with self.subTest(field=field, value=invalid):
                    result = calculate(state(member(**{field: invalid})))
                    self.assertTrue(result["validation_errors"])
                    self.assertFalse(result["cost_complete"])
                    self.assertIsNone(result["margin"])
                    json.dumps(result, allow_nan=False)
        result = calculate(state(member(qty=1.5)))
        self.assertTrue(result["validation_errors"])

    def test_unknown_weight_never_inferred_from_designation(self):
        result = calculate(state(member(kgm="")))
        self.assertEqual(result["netMembers"], 0)
        self.assertTrue(any("kgm" in e for e in result["validation_errors"]))

    def test_duplicate_marks_flagged_without_automatically_deduplicating(self):
        result = calculate(state(member(), member()))
        self.assertTrue(any("Duplicate member mark" in warning for warning in result["warnings"]))
        self.assertAlmostEqual(result["netMembers"], 251.2)

    def test_sections_group_by_purchase_not_finish(self):
        result = calculate(state(member(mark="B1", finish="Raw"), member(mark="B2", finish="Primed")))
        self.assertEqual(len(result["purchase"]["allocations"]), 1)
        self.assertAlmostEqual(result["finishWeights"]["Raw"], 125.6)
        self.assertAlmostEqual(result["finishWeights"]["Primed"], 125.6)

    def test_supplier_price_and_section_specific_stock_availability(self):
        project = state(member(length=4500, supplier_price=3000))
        project["sectionSettings"] = {"250UB31.4": {"stocks": [10.5], "supplierCuts": False}}
        result = calculate(project)
        self.assertEqual(result["purchase"]["allocations"][0]["L"], 10.5)
        self.assertAlmostEqual(result["purchase"]["cost"], 10.5 * 31.4 * 3)

    def test_saw_automatic_heavy_classification(self):
        small = calculate(state(member(family="SHS", section="100x100x5SHS")))
        large = calculate(state(member(family="SHS", section="150x150x5SHS")))
        self.assertEqual(small["sawH"], .25)
        self.assertEqual(large["sawH"], .4)

    def test_rates_editable_and_input_unchanged(self):
        project = state(member(), rates={"saw_heavy_per_cut": 70})
        before = copy.deepcopy(project)
        result = calculate(project, rates={"fabrication_sell_per_hour": 250})
        self.assertEqual(result["sawH"], .7)
        self.assertEqual(item(result, "Fabrication")["sell"], 250)
        self.assertEqual(before, project)

    def test_negative_money_or_margin_not_silently_coerced(self):
        for field, bad in [("installerQuote", -100), ("materialMarginOverride", 100), ("finalSupply", float("nan"))]:
            project = state(member(), **{field: bad})
            project["project"]["scope"] = "sfi"
            result = calculate(project)
            self.assertTrue(result["validation_errors"])
            self.assertFalse(result["cost_complete"])

    def test_invalid_ancillary_input_cannot_leak_nan_to_json(self):
        result = calculate(state(member(cuts=float("nan"), fabEach=float("inf"))))
        self.assertFalse(result["cost_complete"])
        json.dumps(result, allow_nan=False)

    def test_ui_confirmed_alias_and_project_plate_gap(self):
        project = state(member(confirmed=True))
        project["project"].update(nestingMode="production", stockLengthsConfirmed=True)
        self.assertTrue(calculate(project)["production_ready"])
        project = state(plateMode="detailed", plates=[
            {"label": "Half", "length": 2400, "width": 600, "thick": 10, "qty": 2}])
        project["project"]["plateGap"] = 0
        result = calculate(project)
        self.assertEqual(result["plateSheets"][0]["count"], 1)
        self.assertEqual(result["plateLayouts"][0]["parts"][0]["width"], 600)

    def test_cold_galvanising_manual_allowance(self):
        project = state(member(finish="Cold galv"), coldGalvCost=120, coldGalvSell=180)
        cold = item(calculate(project), "Cold galvanising")
        self.assertEqual(cold["cost"], 120)
        self.assertEqual(cold["sell"], 180)
        project.pop("coldGalvCost")
        self.assertFalse(calculate(project)["cost_complete"])

    def test_scope_supply_excludes_fabrication_and_installation(self):
        project = state(member(fabEach=""), finalInstall=100000)
        project["project"]["scope"] = "supply"
        result = calculate(project)
        self.assertEqual(result["fabH"], 0)
        self.assertEqual(result["instSell"], 0)
        self.assertTrue(result["cost_complete"])

    def test_stale_tube_hours_not_charged_to_saw_only_job(self):
        result = calculate(state(member(process="saw"), tubeHours=12))
        self.assertEqual(result["tubeH"], 0)
        self.assertEqual(item(result, "Tube laser")["cost"], 0)


class GeometricPlateTests(unittest.TestCase):
    def test_area_cannot_fake_two_parts_that_do_not_geometrically_fit(self):
        project = state(plateMode="detailed", plateSheet="1200x2400",
                        plates=[{"label": "BP", "length": 1300, "width": 1100, "thick": 10, "qty": 2}])
        result = calculate(project)
        self.assertEqual(result["plateSheets"][0]["fraction"], 2)
        self.assertAlmostEqual(result["plateGross"], 452.16)
        self.assertEqual(len(result["plateSheets"][0]["layouts"]), 2)

    def test_rotation_and_thickness_separation(self):
        project = state(plateMode="detailed", plateSheet="1200x2400", plates=[
            {"label": "Rotated", "length": 1100, "width": 2200, "thick": 10, "qty": 1},
            {"label": "Separate", "length": 1100, "width": 2200, "thick": 12, "qty": 1}])
        result = calculate(project)
        self.assertEqual(len(result["plateSheets"]), 2)
        self.assertTrue(result["plateSheets"][0]["layouts"][0]["parts"][0]["rotated"])

    def test_gap_enforced_and_whole_sheets(self):
        project = state(plateMode="detailed", plateGap=3, plateSheet="1200x2400",
                        plates=[{"label": "Half", "length": 2400, "width": 600, "thick": 10, "qty": 2}])
        self.assertEqual(calculate(project)["plateSheets"][0]["count"], 2)
        project["plateGap"] = 0
        self.assertEqual(calculate(project)["plateSheets"][0]["count"], 1)

    def test_oversize_plate_flags_unpriced_material(self):
        result = calculate(state(plateMode="detailed", plates=[
            {"label": "Oversize", "length": 4000, "width": 2000, "thick": 10, "qty": 1}]))
        self.assertFalse(result["cost_complete"])
        self.assertEqual(result["plateGross"], 0)
        self.assertGreater(result["plateWeight"], 0)

    def test_plate_laser_minimum_enforced(self):
        result = calculate(state(plateMode="detailed", plateLaserHours=0,
                                 plates=[{"label": "BP", "length": 100, "width": 100, "thick": 10, "qty": 1}]))
        self.assertEqual(result["plateH"], .5)
        self.assertAlmostEqual(item(result, "Plate laser")["cost"], .5 * 181.31)

    def test_layout_rectangles_never_overlap_or_leave_sheet(self):
        result = calculate(state(plateMode="detailed", plateSheet="auto", plates=[
            {"label": f"P{i}", "length": length, "width": width, "thick": 10, "qty": 3}
            for i, (length, width) in enumerate([(250, 600), (450, 650), (900, 800), (100, 150)])]))
        for group in result["plateSheets"]:
            total = 0
            for sheet in group["layouts"]:
                for i, a in enumerate(sheet["parts"]):
                    total += 1
                    self.assertLessEqual(a["x"] + a["packedWidth"], sheet["width"] + 1e-7)
                    self.assertLessEqual(a["y"] + a["packedHeight"], sheet["height"] + 1e-7)
                    for b in sheet["parts"][i + 1:]:
                        gap = group["gap"]
                        separate = (a["x"] + a["packedWidth"] + gap <= b["x"] + 1e-7 or
                                    b["x"] + b["packedWidth"] + gap <= a["x"] + 1e-7 or
                                    a["y"] + a["packedHeight"] + gap <= b["y"] + 1e-7 or
                                    b["y"] + b["packedHeight"] + gap <= a["y"] + 1e-7)
                        self.assertTrue(separate)
            self.assertEqual(total, 12)


if __name__ == "__main__":
    unittest.main()

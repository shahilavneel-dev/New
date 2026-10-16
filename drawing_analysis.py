"""Conservative, local drawing extraction. Every result is a review candidate.

Masses are read only from UB/UC mass designations or an explicit kg/m field.
Numbers without a labelled length column never become confirmed dimensions.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any

NUMBER = r'\d+(?:\.\d+)?'
STEEL_PATTERN = re.compile(
    r'(?<!\w)(?:\d{2,4}\s*(?:UB|UC)\s*\d{1,3}(?:\.\d+)?'
    r'|\d{2,4}\s*PFC'
    r'|\d{2,4}\s*[x×]\s*\d{2,4}\s*[x×]\s*\d+(?:\.\d+)?\s*(?:RHS|SHS|EA|UA|ANGLE)'
    r'|\d{2,4}\s*[x×]\s*\d+(?:\.\d+)?\s*(?:EA|UA|ANGLE|FLAT(?:\s*BAR)?|FB)'
    r'|(?:FB|FLAT\s*BAR)\s*\d{2,4}\s*[x×]\s*\d+(?:\.\d+)?'
    r'|\d{2,4}(?:\.\d+)?\s*(?:CHS|PIPE)\s*[x×]?\s*\d+(?:\.\d+)?)\b', re.I)
MARK_PATTERN = re.compile(r'\b(?:SB|SC|BR|LB|B|C|P)\d+[A-Z]?\b', re.I)
EXPLICIT_LENGTH = re.compile(r'\b(?:LENGTH|LEN|L)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)\s*(mm|metres?|meters?|m)?\b', re.I)
QTY_PATTERN = re.compile(r'\b(?:QTY|QUANTITY|NO\.?|PCS|OFF)\s*[:=]?\s*(\d{1,5})\b', re.I)
MASS_PATTERN = re.compile(r'(?<![\d.])(\d+(?:\.\d+)?)\s*kg\s*/\s*m\b', re.I)
FINISH_PATTERN = re.compile(r'\b(PRIMED|HDG|HOT[- ]DIP GALVANI[ZS]ED|RAW|POWDER(?:\s*COATED)?)\b', re.I)


def norm_section(section: str) -> str:
    sec = re.sub(r'\s*[×Xx]\s*', 'x', str(section).strip())
    sec = re.sub(r'(?<=\d)\s+(?=UB|UC|PFC)', '', sec, flags=re.I)
    sec = re.sub(r'(UB|UC|PFC)\s+(?=\d)', r'\1', sec, flags=re.I)
    sec = re.sub(r'(ub|uc|pfc|shs|rhs|chs|pipe|ea|ua|fb)', lambda m: m.group().upper(), sec, flags=re.I)
    return re.sub(r'\s+', ' ', sec)


def norm_family(section: str) -> str:
    section = section.upper()
    for token in ['PFC', 'SHS', 'RHS', 'UB', 'UC']:
        if token in section:
            return token
    if 'CHS' in section or 'PIPE' in section: return 'Pipe'
    if 'ANGLE' in section or re.search(r'(EA|UA)\b', section): return 'Angle'
    if re.search(r'FB(?=\d|\s)|FLAT', section): return 'Flat bar'
    return ''


def known_kgm(section: str) -> float | None:
    m = re.fullmatch(r'\d{2,4}(?:UB|UC)(\d+(?:\.\d+)?)', norm_section(section), re.I)
    value = float(m.group(1)) if m else None
    return value if value is not None and 0 < value <= 1000 else None


def positive_number(value: Any, maximum: float) -> float | None:
    try:
        number = float(str(value).replace(',', '').strip())
        return number if math.isfinite(number) and 0 < number <= maximum else None
    except (ValueError, TypeError):
        return None


def mm_number(value: Any) -> int | None:
    number = positive_number(value, 100000)
    return round(number) if number is not None and number >= 50 else None


def qty_number(value: Any) -> int | None:
    number = positive_number(value, 10000)
    return int(number) if number is not None and number.is_integer() else None


def pdf_text_lines(page) -> list[dict]:
    """Join text sharing a baseline, including separate schedule-table cells."""
    words = page.get_text('words', sort=True)[:60000]
    groups = []
    for w in words:
        if not str(w[4]).strip(): continue
        center = (float(w[1]) + float(w[3])) / 2
        # Baseline clustering also joins cells that belong to different PDF blocks.
        found = next((g for g in reversed(groups[-12:]) if abs(g['center'] - center) <= min(3, (w[3]-w[1])*.3)), None)
        if found is None:
            found = {'center': center, 'words': []}
            groups.append(found)
        found['words'].append(w)
    rows = []
    for g in groups:
        row = sorted(g['words'], key=lambda w: w[0])
        logical_box = [min(w[0] for w in row), min(w[1] for w in row), max(w[2] for w in row), max(w[3] for w in row)]
        # Text/search coordinates are unrotated, while pixmaps and page.rect are rotated.
        display_box = fitz_rect(logical_box, page.rotation_matrix)
        rows.append({'text': ' '.join(str(w[4]) for w in row)[:12000],
                     'bbox': display_box, 'logical_bbox': logical_box,
                     'words': [{'text': str(w[4]), 'bbox': [float(v) for v in w[:4]]} for w in row]})
    return sorted(rows, key=lambda line: (line['logical_bbox'][1], line['logical_bbox'][0]))


def fitz_rect(box, matrix):
    import fitz
    return [round(float(value), 2) for value in fitz.Rect(box) * matrix]


def _length(raw: str, section_match, default_unit=None) -> tuple[int | None, int | None, str]:
    # Remove the section first so its dimensions cannot be mistaken for member length.
    clean = raw[:section_match.start()] + ' ' + raw[section_match.end():]
    match = EXPLICIT_LENGTH.search(clean)
    if match:
        value = positive_number(match.group(1), 100000)
        if value is not None:
            unit = (match.group(2) or default_unit or '').lower()
            if not unit:
                return None, mm_number(value), 'labelled length; units unconfirmed'
            if unit in ['m', 'metre', 'metres', 'meter', 'meters']:
                value *= 1000
            return mm_number(value), None, 'explicit labelled length'
    # An isolated dimension needs relevance checked; never accept it automatically.
    match = re.search(r'(?<![\d.])(\d[\d,]*(?:\.\d+)?)\s*mm\b', clean, re.I)
    if not match:
        match = re.search(r'(?<![\d.])(\d[\d,]{3,5})(?![\d.])', clean[section_match.start():])
    return None, mm_number(match.group(1)) if match else None, 'unconfirmed dimension' if match else 'missing'


def _revision(lines: list[dict]) -> dict:
    text = '\n'.join(line['text'] for line in lines)
    number = re.search(r'\b(?:DRAWING\s*(?:NO\.?|NUMBER|#)|DWG\s*(?:NO\.?)?)\s*[:=]?\s*([A-Z0-9][A-Z0-9_.-]{1,39})', text, re.I)
    revision = re.search(r'\b(?:REVISION|REV\.?)[\s:=]+([A-Z0-9.-]{1,12})\b', text, re.I)
    revision_value = revision.group(1) if revision else ''
    if revision_value.upper() in {'DATE', 'DESCRIPTION', 'BY', 'CHECKED', 'DRAWN'}:
        revision_value = ''
    return {'drawing_number': number.group(1) if number else '', 'revision': revision_value}


def duplicate_marks(candidates: list[dict]) -> list[str]:
    groups = defaultdict(list)
    for row in candidates:
        if row.get('mark'):
            groups[row['mark'].upper()].append(row)
    flags = []
    for mark, rows in groups.items():
        if len(rows) < 2: continue
        warning = f'Duplicate mark {mark}: {len(rows)} references. Check drawing revisions; references are not additional quantities.'
        flags.append(warning)
        for row in rows:
            row['duplicate_mark'] = True
            row['review'] = '; '.join(filter(None, [row.get('review'), warning]))
    return flags


def rl_suggestions(lines_by_page: list[list[dict]]) -> list[dict]:
    """Only pair explicitly named top/bottom RLs for the same column mark.

    A difference remains provisional: connection offsets, foundation, plate and
    bearing conditions are not implied by two architectural levels.
    """
    levels = defaultdict(dict)
    for page_no, lines in enumerate(lines_by_page, 1):
        for line in lines:
            text = line['text']
            marks = list(MARK_PATTERN.finditer(text))
            # Ambiguous multi-member lines cannot establish a column reference.
            if len(marks) != 1 or not re.fullmatch(r'(?:C|SC)\d+[A-Z]?', marks[0].group(), re.I): continue
            mark = marks[0].group().upper()
            for condition, label in [('top', r'TOP(?:\s+OF\s+(?:STEEL|COLUMN))?'), ('bottom', r'(?:BOTTOM|BASE)(?:\s+OF\s+(?:STEEL|COLUMN))?')]:
                match = re.search(r'\b'+label+r'\s*(?:LEVEL\s*)?RL\s*[:=]?\s*(-?\d{1,4}\.\d{1,4})\s*(mm|m)?\b', text, re.I)
                if match:
                    value = float(match.group(1))
                    unit = (match.group(2) or 'm').lower()
                    levels[mark].setdefault(condition, []).append({'level_mm': value if unit == 'mm' else value*1000, 'evidence': text[:350], 'page': page_no, 'bbox': line.get('bbox')})
    results = []
    for mark, evidence in levels.items():
        top, bottom = evidence.get('top', []), evidence.get('bottom', [])
        if len({v['level_mm'] for v in top}) != 1 or len({v['level_mm'] for v in bottom}) != 1: continue
        difference = top[0]['level_mm'] - bottom[0]['level_mm']
        if not 50 <= difference <= 100000: continue
        results.append({'mark': mark, 'suggested_length_mm': round(difference), 'top_rl_mm': top[0]['level_mm'],
                        'bottom_rl_mm': bottom[0]['level_mm'], 'references': top+bottom,
                        'review': 'Provisional RL difference only. Confirm top/bottom conditions, base/top plates, bearings and connection offsets before entering a member length.'})
    return results


def cross_reference_pages(pages: list[dict]) -> dict:
    """Cross-file references are evidence links, never additive member quantities."""
    marks = defaultdict(list)
    line_sets = []
    for page in pages:
        lines = page['lines']
        line_sets.append(lines)
        metadata = _revision(lines)
        for candidate in extract_lines(lines, page['page']):
            if candidate.get('mark'):
                marks[candidate['mark'].upper()].append({
                    'file_id': page['file_id'], 'page': page['page'], 'section': candidate['section'],
                    'bbox': candidate['bbox'], 'evidence': candidate['evidence'], **metadata})
    flags = []
    mark_rows = []
    for mark, references in marks.items():
        sections = sorted({norm_section(row['section']).upper() for row in references})
        revisions = sorted({row['revision'] for row in references if row['revision']})
        conflict = len(sections) > 1
        if conflict:
            flags.append(f'{mark}: conflicting section callouts ({", ".join(sections)}). Establish the controlling drawing and revision before approval.')
        elif len(references) > 1:
            flags.append(f'{mark}: {len(references)} drawing references; do not add quantities from repeated schedules/plans.')
        if len(revisions) > 1:
            flags.append(f'{mark}: multiple drawing revisions ({", ".join(revisions)}); review which revision applies.')
        mark_rows.append({'mark': mark, 'references': references, 'section_conflict': conflict, 'revisions': revisions})
    suggestions = rl_suggestions(line_sets)
    for suggestion in suggestions:
        for reference in suggestion['references']:
            source = pages[reference['page']-1]
            reference['file_id'] = source['file_id']
            reference['page'] = source['page']
        if any(row['mark'] == suggestion['mark'] and row['section_conflict'] for row in mark_rows):
            suggestion['review'] += ' Conflicting section callouts exist; establish the controlling revision.'
    return {'marks': mark_rows, 'rl_suggestions': suggestions, 'flags': flags,
            'review': 'Cross-references link evidence only. Drawing marks do not establish quantities, and RL differences do not establish fabrication lengths.'}


def extract_lines(lines: list[dict], page_no: int, origin='PDF text') -> list[dict]:
    candidates = []
    headers = {}
    header_y = -100000
    default_unit = 'mm' if any(re.search(r'ALL\s+DIMENSIONS\s+(?:ARE\s+)?(?:IN\s+)?(?:MM|MILLIMET(?:RE|ER)S)\b', row['text'], re.I) for row in lines) else None
    for line in lines:
        raw = line['text']
        # Explicit schedule headings establish column meaning; a bare number does not.
        if re.search(r'\b(?:SECTION|SIZE)\b', raw, re.I) and re.search(r'\b(?:QTY|LENGTH|LEN)\b', raw, re.I):
            headers = {}
            header_y = line.get('logical_bbox', line['bbox'])[1]
            for word in line.get('words', []):
                label = word['text'].upper().strip('():')
                meaning = 'qty' if label in ['QTY', 'QUANTITY', 'NO', 'NO.'] else 'length' if label in ['LENGTH', 'LEN', 'L'] or label.startswith('LENGTH(') else 'mass' if label == 'KG/M' else None
                if meaning:
                    box = word['bbox']
                    length_unit = 'mm' if re.search(r'\b(?:LENGTH|LEN)\s*\(?mm\b', raw, re.I) else 'm' if re.search(r'\b(?:LENGTH|LEN)\s*\(?m\b', raw, re.I) else default_unit
                    headers[meaning] = {'x': (box[0]+box[2])/2, 'unit': length_unit}
            continue
        table_values = {}
        if headers and 0 < line.get('logical_bbox', line['bbox'])[1]-header_y < 800:
            for word in line.get('words', []):
                if not re.fullmatch(r'\d[\d,]*(?:\.\d+)?', word['text']): continue
                box = word['bbox']
                x = (box[0]+box[2])/2
                distances = sorted((abs(x-header['x']), key) for key, header in headers.items())
                if distances and distances[0][0] <= 35 and (len(distances) == 1 or distances[0][0]+10 < distances[1][0]):
                    table_values[distances[0][1]] = word['text']
        matches = list(STEEL_PATTERN.finditer(raw))
        for match in matches:
            section = norm_section(match.group())
            # Multiple callouts on a line have ambiguous mark/qty/dimension relationships.
            marks = list(MARK_PATTERN.finditer(raw))
            mark = marks[0].group().upper() if len(marks) == 1 else ''
            qty_match = QTY_PATTERN.search(raw)
            qty = qty_number(qty_match.group(1)) if qty_match and len(matches) == 1 else None
            length, suggested, length_status = _length(raw, match, default_unit) if len(matches) == 1 else (None, None, 'ambiguous row')
            if len(matches) == 1:
                if qty is None and 'qty' in table_values:
                    qty = qty_number(table_values['qty'])
                if length is None and 'length' in table_values:
                    value = positive_number(table_values['length'], 100000)
                    if value is not None:
                        if headers['length']['unit']:
                            length = mm_number(value * (1000 if headers['length']['unit'] == 'm' else 1))
                            length_status = 'explicit schedule LENGTH column — confirm units'
                            suggested = None
                        else:
                            suggested = mm_number(value)
                            length_status = 'schedule LENGTH column; units unconfirmed'
            mass_match = MASS_PATTERN.search(raw)
            mass = known_kgm(section)
            mass_source = 'UB/UC designation' if mass else None
            if mass_match and len(matches) == 1:
                mass = positive_number(mass_match.group(1), 1000)
                mass_source = 'explicit kg/m on drawing' if mass else None
            elif 'mass' in table_values and len(matches) == 1:
                mass = positive_number(table_values['mass'], 1000)
                mass_source = 'explicit schedule kg/m column — verify units' if mass else None
            notes = []
            if length is None: notes.append('Member length not confirmed')
            if suggested: notes.append(f'{suggested} mm is an unconfirmed dimension; enter length only after checking relevance and units')
            if qty is None: notes.append('Quantity not confirmed')
            if mass is None: notes.append('Enter verified kg/m from section database or supplier')
            if origin == 'Local OCR': notes.append('OCR reading: verify every value against image')
            if len(matches) > 1: notes.append('Multiple sections on line: establish mark/quantity/length association manually')
            finish = FINISH_PATTERN.search(raw)
            value = finish.group().upper() if finish else ''
            finish_name = ('HDG' if 'GALV' in value or value == 'HDG' else 'Primed' if value == 'PRIMED' else 'Powder' if 'POWDER' in value else 'Raw' if value == 'RAW' else None)
            candidates.append({'kind': 'member', 'mark': mark, 'family': norm_family(section), 'section': section,
                               'length_mm': length, 'suggested_length_mm': suggested, 'length_status': length_status,
                               'qty': qty, 'kgm': mass, 'kgm_source': mass_source, 'finish': finish_name,
                               'page': page_no, 'bbox': line['bbox'], 'evidence': raw[:500], 'origin': origin,
                               'status': 'pending', 'review': '; '.join(notes) or 'Verify scope, conditions and drawing reference'})
        # Only conventional fully dimensioned plate callouts; no allowance geometry is invented.
        plate = re.search(r'\b(?:PLATE|PL)\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b', raw, re.I)
        if plate:
            length, width, thick = [positive_number(value, 100000) for value in plate.groups()]
            if all(value is not None for value in [length, width, thick]) and thick <= 150 and thick < min(length, width):
                qty_match = QTY_PATTERN.search(raw)
                label = re.search(r'\b(?:BP|CP|PL)\d+[A-Z]?\b', raw, re.I)
                candidates.append({'kind': 'plate', 'label': label.group().upper() if label else 'Plate', 'length_mm': length,
                                   'width_mm': width, 'thick_mm': thick, 'qty': qty_number(qty_match.group(1)) if qty_match else None,
                                   'page': page_no, 'bbox': line['bbox'], 'evidence': raw[:500], 'origin': origin, 'status': 'pending',
                                   'review': 'Verify plate L × W × thickness convention and quantity against detail; not an inferred connection allowance'})
    return candidates


def rule_extract(doc, max_pages=150) -> tuple[list, list, list]:
    candidates, pages, flags, page_lines = [], [], [], []
    for page_no in range(min(len(doc), max_pages)):
        page = doc[page_no]
        lines = pdf_text_lines(page)
        page_lines.append(lines)
        pages.append({'page': page_no+1, 'width': round(page.rect.width, 2), 'height': round(page.rect.height, 2),
                      'text_lines': len(lines), 'preview': '\n'.join(x['text'] for x in lines)[:2500], **_revision(lines)})
        candidates.extend(extract_lines(lines, page_no+1))
        if len(candidates) >= 5000:
            candidates = candidates[:5000]
            flags.append('Candidate limit reached (5000). Split drawing sets for further analysis.')
            break
    flags.extend(duplicate_marks(candidates))
    suggestions = {r['mark']: r for r in rl_suggestions(page_lines)}
    for row in candidates:
        if row.get('mark') in suggestions:
            row['rl_suggestion'] = suggestions[row['mark']]
            row['review'] += '; Provisional RL difference available; verify column end conditions'
    if not any(p['text_lines'] for p in pages):
        flags.append('No selectable text found. Try optional local OCR (Tesseract) or manual takeoff; no external analysis is required.')
    if not candidates:
        flags.append('No recognisable structural steel callouts found. Use manual takeoff or review selected pages with OCR/optional AI.')
    if len(doc) > max_pages:
        flags.append(f'Only first {max_pages} pages scanned.')
    return candidates, pages, flags

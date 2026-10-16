"""Drawing integrity and API tests. Never contacts an external AI service."""
import io
import importlib
from pathlib import Path
from unittest.mock import patch

import fitz
import pytest
from fastapi.testclient import TestClient

from drawing_analysis import (extract_lines, known_kgm, mm_number, norm_family, qty_number,
                              rl_suggestions, rule_extract)

ROOT = Path(__file__).resolve().parents[1]


def pdf_bytes(lines):
    with fitz.open() as doc:
        for text in lines:
            page = doc.new_page()
            page.insert_text((40, 40), text, fontsize=10)
        return doc.tobytes()


def test_sample_exact_schedule_and_unknown_hollow_mass():
    with fitz.open(ROOT / 'SAMPLE_TEST_DRAWING.pdf') as doc:
        candidates, pages, flags = rule_extract(doc)
    assert len(candidates) == 3
    by_mark = {c['mark']: c for c in candidates}
    assert set(by_mark) == {'B1', 'C1', 'B2'}
    assert by_mark['B1']['qty'] == 2
    assert by_mark['B1']['length_mm'] == 4500
    assert by_mark['B1']['kgm'] == 31.4
    assert by_mark['C1']['kgm'] is None
    assert by_mark['C1']['length_mm'] == 3000
    assert all(c['status'] == 'pending' and len(c['bbox']) == 4 for c in candidates)
    assert pages[0]['width'] == 842


@pytest.mark.parametrize('designation,family', [
    ('200PFC', 'PFC'), ('150 PFC', 'PFC'), ('100x100x5 SHS', 'SHS'),
    ('150x75x5 RHS', 'RHS'), ('75x75x6 EA', 'Angle'), ('75x6 UA', 'Angle'),
    ('100x10 FLAT BAR', 'Flat bar'), ('100x10FLAT BAR', 'Flat bar'), ('75x75x6EA', 'Angle'), ('75x6UA', 'Angle'), ('FB100x10', 'Flat bar'), ('FB 100x10', 'Flat bar'), ('114.3CHS4.5', 'Pipe'),
])
def test_supported_sections_without_invented_mass(designation, family):
    lines = [{'text': f'B1 {designation} QTY 2 LENGTH 4000 mm', 'bbox': [0, 0, 500, 20]}]
    result = extract_lines(lines, 1)
    assert len(result) == 1
    assert result[0]['family'] == family
    assert result[0]['kgm'] is None
    assert result[0]['qty'] == 2
    assert result[0]['length_mm'] == 4000


def test_only_labelled_dimensions_fill_length():
    values = ['B1 250UB31.4 5500', 'B1 250UB31.4 5500 mm', 'C1 100x100x5 SHS TOP RL 12.500 BOTTOM RL 9.500']
    candidates = extract_lines([{'text': text, 'bbox': [0, n*20, 500, n*20+10]} for n, text in enumerate(values)], 1)
    assert all(c['length_mm'] is None for c in candidates)
    assert candidates[0]['suggested_length_mm'] == 5500
    assert candidates[1]['suggested_length_mm'] == 5500
    assert candidates[2]['suggested_length_mm'] is None
    assert all(c['qty'] is None for c in candidates)


def test_length_units_and_explicit_mass():
    candidates = extract_lines([{'text': 'B1 200PFC LENGTH 4.5 m QTY 2 22.9 kg/m', 'bbox': [0, 0, 500, 10]}], 1)
    assert candidates[0]['length_mm'] == 4500
    assert candidates[0]['kgm'] == 22.9
    assert candidates[0]['kgm_source'] == 'explicit kg/m on drawing'


def test_separate_schedule_cells_follow_explicit_headers():
    with fitz.open() as doc:
        p = doc.new_page()
        for x, text in [(30, 'MARK'), (100, 'SECTION'), (270, 'QTY'), (350, 'LENGTH (mm)'), (470, 'kg/m')]:
            p.insert_text((x, 40), text, fontsize=10)
        for x, text in [(30, 'B1'), (100, '200PFC'), (270, '2'), (350, '4500'), (470, '22.9')]:
            p.insert_text((x, 65), text, fontsize=10)
        rows, _, _ = rule_extract(doc)
    assert len(rows) == 1
    assert rows[0]['section'] == '200PFC'
    assert rows[0]['length_mm'] == 4500
    assert rows[0]['qty'] == 2
    assert rows[0]['kgm'] == 22.9


def test_duplicate_marks_and_multiple_revisions_remain_references():
    with fitz.open(stream=pdf_bytes(['DRAWING NO S101 REV A\nB1 200PFC QTY 2 LENGTH 4500 mm', 'DRAWING NO S101 REV B\nB1 200PFC QTY 2 LENGTH 4700 mm']), filetype='pdf') as doc:
        rows, pages, flags = rule_extract(doc)
    assert len(rows) == 2
    assert all(row['duplicate_mark'] for row in rows)
    assert [page['revision'] for page in pages] == ['A', 'B']
    assert [page['drawing_number'] for page in pages] == ['S101', 'S101']
    assert any('references are not additional quantities' in flag for flag in flags)


def test_rl_requires_same_explicit_column_and_stays_provisional():
    lines = [[{'text': 'C1 TOP RL 12.500', 'bbox': [0, 0, 100, 10]}, {'text': 'C1 BASE RL 9.500', 'bbox': [0, 20, 100, 30]}, {'text': 'C2 ROOF RL 15.500 FLOOR RL 11.000', 'bbox': [0, 40, 100, 50]}]]
    result = rl_suggestions(lines)
    assert len(result) == 1
    assert result[0]['mark'] == 'C1'
    assert result[0]['suggested_length_mm'] == 3000
    assert 'Provisional' in result[0]['review'] and 'offsets' in result[0]['review']
    lines[0].append({'text': 'C1 TOP RL 13.000', 'bbox': [0, 60, 100, 70]})
    assert rl_suggestions(lines) == []  # conflicting revisions must not pick a convenient level


def test_plate_dimensions_only_when_fully_explicit():
    result = extract_lines([{'text': 'BP1 PL 300x200x10 QTY 4', 'bbox': [0, 0, 500, 10]},
                            {'text': 'PLATES 12 percent allowance', 'bbox': [0, 20, 500, 30]}], 1)
    assert len(result) == 1
    assert result[0]['kind'] == 'plate'
    assert [result[0][key] for key in ['length_mm', 'width_mm', 'thick_mm', 'qty']] == [300, 200, 10, 4]


@pytest.mark.parametrize('value', ['nan', 'inf', -1, 0, 1e9, None])
def test_invalid_lengths_and_quantities(value):
    assert mm_number(value) is None
    assert qty_number(value) is None


def test_fractional_quantity_rejected_and_only_designation_mass():
    assert qty_number(2.7) is None
    assert known_kgm('250UB31.4') == 31.4
    assert known_kgm('200PFC') is None
    assert known_kgm('100x100x5 SHS') is None


@pytest.fixture
def server_client(tmp_path, monkeypatch):
    import server
    monkeypatch.setattr(server, 'UPLOAD_DIR', tmp_path / 'uploads')
    server.UPLOAD_DIR.mkdir()
    monkeypatch.setattr(server, 'API_KEY', '')
    return TestClient(server.app)


def test_upload_render_and_vector_api(server_client):
    response = server_client.post('/api/upload', files={'file': ('sample.pdf', (ROOT/'SAMPLE_TEST_DRAWING.pdf').read_bytes(), 'application/pdf')})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result['candidates']) == 3
    assert result['method'].startswith('embedded text')
    file_id = result['file_id']
    page = server_client.get(f'/api/page/{file_id}/1')
    assert page.status_code == 200 and page.content.startswith(b'\x89PNG')
    assert server_client.get(f'/api/page/{file_id}/99').status_code == 404
    vector = server_client.get(f'/api/vectors/{file_id}/1')
    assert vector.status_code == 200 and vector.json()['coordinate_units'] == 'PDF points'
    assert server_client.get('/api/page/invalid/1').status_code == 404


def test_malformed_files_passwords_and_limits(server_client):
    assert server_client.post('/api/upload', files={'file': ('bad.pdf', b'hello', 'application/pdf')}).status_code == 422
    assert server_client.post('/api/upload', files={'file': ('bad.jpg', b'hello', 'image/jpeg')}).status_code == 422
    assert server_client.post('/api/upload', files={'file': ('bad.exe', b'hello', 'application/pdf')}).status_code == 415
    assert server_client.post('/api/upload', files={'file': ('empty.pdf', b'', 'application/pdf')}).status_code == 422
    with fitz.open() as doc:
        doc.new_page()
        locked = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='protected')
    result = server_client.post('/api/upload', files={'file': ('locked.pdf', locked, 'application/pdf')})
    assert result.status_code == 422
    assert 'Password' in result.json()['detail']
    assert server_client.post('/api/upload', content=b'x', headers={'Content-Length': str(40*1024*1024)}).status_code == 413


def test_origin_host_and_cross_site_mutation_protection(server_client):
    assert server_client.post('/api/key', json={'api_key': 'sk-test'}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert server_client.post('/api/key', json={'api_key': 'sk-test'}, headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert server_client.get('/api/health', headers={'Host': 'attacker.example'}).status_code == 400
    assert server_client.post('/api/key', json={'api_key': 'sk-test'}, headers={'Origin': 'http://localhost:80'}).status_code == 200
    assert server_client.delete('/api/key').status_code == 200


def test_ai_no_key_no_consent_and_disclosure_never_calls_network(server_client, monkeypatch):
    import server
    data = server_client.post('/api/upload', files={'file': ('sample.pdf', (ROOT/'SAMPLE_TEST_DRAWING.pdf').read_bytes(), 'application/pdf')}).json()
    request = {'file_id': data['file_id'], 'pages': [1], 'scope': 'Only B1'}
    with patch('httpx.AsyncClient.post', side_effect=AssertionError('No external network allowed in validation')):
        missing = server_client.post('/api/ai', json=request)
        assert missing.status_code == 400 and 'not configured' in missing.json()['detail']
        monkeypatch.setattr(server, 'API_KEY', 'sk-test-memory-only')
        assert server_client.post('/api/ai', json=request).status_code == 400
        preview = server_client.post('/api/ai/preview', json=request)
        assert preview.status_code == 200
        assert preview.json()['scope'] == 'Only B1'
        assert '250UB31.4' in preview.json()['text'][0]['text']
        assert preview.json()['destination'].startswith('https://api.openai.com/')
    assert server_client.post('/api/ai/preview', json={**request, 'pages': [True]}).status_code == 422


def test_ai_mass_sanitiser_rejects_unsupported_mass_and_fractional_qty():
    import server
    with fitz.open(ROOT/'SAMPLE_TEST_DRAWING.pdf') as doc:
        result = server.sanitise_ai({'members': [
            {'section': '100x100x5 SHS', 'qty': 2.5, 'kgm': 14.9, 'length_mm': 3000, 'page': 1},
            {'section': '200PFC', 'qty': 2, 'kgm': 999, 'evidence': '200PFC 22.9 kg/m', 'page': 1},
            {'section': '250UB31.4', 'qty': 2, 'kgm': 999, 'page': 1},
        ]}, doc, [1])
    assert len(result['members']) == 3
    assert result['members'][0]['kgm'] is None and result['members'][0]['qty'] is None
    assert result['members'][1]['kgm'] == 22.9
    assert result['members'][2]['kgm'] == 31.4
    assert all(row['status'] == 'pending' for row in result['members'])


def test_ocr_missing_dependency_clear_local_fallback(server_client, monkeypatch):
    import server
    monkeypatch.setattr(server.shutil, 'which', lambda _: None)
    assert server_client.get('/api/health').json()['ocr_available'] is False
    response = server_client.post('/api/ocr', json={'file_id': '0'*32, 'pages': [1]})
    assert response.status_code == 409 and 'Tesseract' in response.json()['detail']


def test_actual_local_ocr_scan_when_tesseract_available(server_client):
    import shutil
    if not shutil.which('tesseract'):
        pytest.skip('Tesseract is an optional local dependency')
    with fitz.open(ROOT/'SAMPLE_TEST_DRAWING.pdf') as doc:
        png = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2)).tobytes('png')
    data = server_client.post('/api/upload', files={'file': ('scan.png', png, 'image/png')}).json()
    assert data['candidates'] == []
    result = server_client.post('/api/ocr', json={'file_id': data['file_id'], 'pages': [1]})
    assert result.status_code == 200
    rows = {row['mark']: row for row in result.json()['candidates']}
    assert set(rows) == {'B1', 'C1', 'B2'}
    assert rows['B1']['qty'] == 2 and rows['B1']['length_mm'] == 4500
    assert rows['C1']['kgm'] is None
    assert all(row['status'] == 'pending' for row in rows.values())


def test_frontend_review_gate_source_retention_and_edit_reset():
    import shutil
    import subprocess
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is optional for frontend integrity checks')
    code = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ctx={document:{createElement:()=>({}),head:{appendChild:()=>{}}},setTimeout:()=>{},confirm:()=>true,alert:()=>{},save:()=>{},render:()=>{},showTab:()=>{},esc:String,tab:'PDF / AI',newMember:()=>({}),newPlate:()=>({}),emailEdit:null};
vm.createContext(ctx);
vm.runInContext("let state={project:{finish:'Raw'},members:[],plates:[],pdfFiles:[{file_id:'a',filename:'Drawing.pdf',drawing_number:'S101',revision:'B',pages:1}],pdfActiveFile:'a',pdfScope:'Quote only B1 and C1; B2 excluded',pdfCandidates:[]};",ctx);
vm.runInContext(fs.readFileSync('pdf_extension.js','utf8'),ctx);
vm.runInContext(`
const assert=(v,msg)=>{if(!v)throw new Error(msg)};
assert(pdfScopeMarks().join(',')==='B1,C1','Exclusive scope excludes later references');
pdfState();state.pdfCandidates=[{kind:'member',file_id:'a',filename:'Drawing.pdf',mark:'B1',family:'UB',section:'250UB31.4',qty:2,length_mm:4500,kgm:31.4,page:1,origin:'PDF text',status:'pending',selected:true,evidence:'B1 source',bbox:[1,2,3,4]}];
pdfImportSelected();assert(state.members.length===0,'Pending candidate must never import');
pdfApprove(0);assert(state.pdfCandidates[0].status==='approved','Complete candidate can be approved');
pdfEdit(0,'length_mm',4600);assert(state.pdfCandidates[0].status==='pending'&&!state.pdfCandidates[0].selected,'Edits reset approval and selection');
pdfApprove(0);pdfUpdateScope('Only C1');assert(state.pdfCandidates[0].status==='pending'&&!state.pdfCandidates[0].selected,'Scope changes revoke approval');
pdfUpdateScope('Only B1');pdfApprove(0);pdfEditDoc('revision','C');assert(state.pdfCandidates[0].status==='pending','Drawing revision changes revoke approval');
pdfApprove(0);pdfImportSelected();assert(state.members.length===1,'Approved candidate imported once');
assert(state.members[0].sourceRevision==='C'&&state.members[0].sourceDrawing==='S101'&&state.members[0].sourcePage===1&&state.members[0].sourceApproval,'Source revision and approval retained');
pdfImportSelected();assert(state.members.length===1,'Import is idempotent');
state.pdfCandidates.push({kind:'member',mark:'C1',family:'SHS',section:'100x100x5 SHS',qty:4,length_mm:3000,kgm:null,status:'pending'});
pdfApprove(1);assert(state.pdfCandidates[1].status==='pending','Missing mass cannot be approved');
`,ctx);
'''
    result = subprocess.run([node, '-e', code], cwd=ROOT, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr


def test_plate_upload_and_extraction_do_not_require_member_mark(server_client):
    data = pdf_bytes(['BP1 PL 300x200x10 QTY 4'])
    result = server_client.post('/api/upload', files={'file': ('plates.pdf', data, 'application/pdf')})
    assert result.status_code == 200, result.text
    plate = result.json()['candidates'][0]
    assert plate['kind'] == 'plate' and plate['label'] == 'BP1'


def test_rotated_pages_source_highlights_and_vectors_use_display_coordinates(server_client):
    import server
    with fitz.open() as doc:
        page = doc.new_page(width=300, height=400)
        page.insert_text((30, 40), 'B1 200PFC QTY 2 LENGTH 4000 mm', fontsize=8)
        page.draw_line((30, 40), (200, 40))
        page.set_rotation(90)
        logical_text_box = page.search_for('B1 200PFC QTY 2 LENGTH 4000 mm')[0]
        expected = list(logical_text_box * page.rotation_matrix)
        candidates, pages, _ = rule_extract(doc)
        assert candidates[0]['bbox'] == pytest.approx(expected, abs=.02)
        assert server.locate_bbox(page, 'B1 200PFC QTY 2 LENGTH 4000 mm', '') == pytest.approx(expected, abs=.02)
        assert pages[0]['width'] == 400 and pages[0]['height'] == 300
        data = doc.tobytes()
    uploaded = server_client.post('/api/upload', files={'file': ('rotated.pdf', data, 'application/pdf')}).json()
    vectors = server_client.get('/api/vectors/'+uploaded['file_id']+'/1').json()
    points = vectors['paths'][0]['items'][0]['points']
    assert points == [[360, 30], [360, 200]]


def test_cross_file_explicit_rl_preserves_sources_without_creating_member_dimensions(server_client):
    uploads = []
    for name, text in [('structural.pdf', 'DRAWING NO S101 REV B\nC1 100x100x5 SHS QTY 2\nC1 TOP RL 12.500'), ('architectural.pdf', 'DRAWING NO A101 REV C\nC1 BASE RL 9.500')]:
        result = server_client.post('/api/upload', files={'file': (name, pdf_bytes([text]), 'application/pdf')})
        assert result.status_code == 200
        uploads.append(result.json())
    assert uploads[0]['candidates'][0]['length_mm'] is None
    result = server_client.post('/api/cross-reference', json={'file_ids': [r['file_id'] for r in uploads]})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['pages_reviewed'] == 2
    suggestion = data['rl_suggestions'][0]
    assert suggestion['mark'] == 'C1' and suggestion['suggested_length_mm'] == 3000
    assert {ref['file_id'] for ref in suggestion['references']} == {r['file_id'] for r in uploads}
    assert all(ref['page'] == 1 and ref['bbox'] for ref in suggestion['references'])
    assert 'Provisional' in suggestion['review']
    assert 'members' not in data and 'length_mm' not in suggestion


def test_cross_file_conflicts_and_revision_evidence_are_flagged(server_client):
    ids = []
    for text in ['DRAWING NO S101 REV A\nB1 200PFC QTY 2 LENGTH 4000 mm', 'DRAWING NO S101 REV B\nB1 250UB31.4 QTY 2 LENGTH 4500 mm']:
        ids.append(server_client.post('/api/upload', files={'file': ('drawing.pdf', pdf_bytes([text]), 'application/pdf')}).json()['file_id'])
    data = server_client.post('/api/cross-reference', json={'file_ids': ids}).json()
    assert data['marks'][0]['section_conflict']
    assert data['marks'][0]['revisions'] == ['A', 'B']
    assert any('conflicting section' in flag for flag in data['flags'])
    assert any('multiple drawing revisions' in flag for flag in data['flags'])
    assert server_client.post('/api/cross-reference', json={'file_ids': ids*5}).status_code == 422


def test_huge_image_header_rejected_before_pixel_decode(server_client):
    import struct
    header = b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + struct.pack('>II', 20000, 20000)
    response = server_client.post('/api/upload', files={'file': ('oversized.png', header, 'image/png')})
    assert response.status_code == 422
    assert 'megapixels' in response.json()['detail']


def test_unlabelled_mass_column_and_unitless_length_are_never_verified():
    with fitz.open() as doc:
        page = doc.new_page()
        for x, text in [(30, 'MARK'), (100, 'SECTION'), (270, 'QTY'), (350, 'LENGTH'), (470, 'MASS (kg)')]:
            page.insert_text((x, 40), text, fontsize=10)
        for x, text in [(30, 'B1'), (100, '200PFC'), (270, '2'), (350, '4500'), (470, '22.9')]:
            page.insert_text((x, 65), text, fontsize=10)
        rows, _, _ = rule_extract(doc)
    assert rows[0]['length_mm'] is None
    assert rows[0]['suggested_length_mm'] == 4500
    assert rows[0]['kgm'] is None

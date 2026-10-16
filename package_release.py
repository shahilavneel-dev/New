"""Create a portable source ZIP without environments, local data or credentials."""
from pathlib import Path
import argparse
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = [
    '.gitignore', 'README.md', 'README_FIRST.txt', 'VALIDATION.md',
    'SAMPLE_TEST_DRAWING.pdf', 'START_STEELTAKEOFF.bat', 'start_linux_mac.sh',
    'requirements.txt', 'requirements-lock.txt', 'requirements-dev.txt', 'requirements-dev-lock.txt',
    'index.html', 'app.js', 'workspace.js', 'settings.js', 'pdf_extension.js', 'workspace.css',
    'server.py', 'estimating.py', 'drawing_analysis.py', 'project_api.py', 'storage.py',
    'package_release.py',
]


def build(output: Path):
    paths = [ROOT / name for name in FILES] + sorted((ROOT / 'tests').glob('test_*.py'))
    for path in paths:
        if not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f'Missing or unsafe release file: {path.name}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, 'SteelTakeoff_AI/' + path.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert all('/app_data/' not in n and '/.venv/' not in n for n in archive.namelist())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f'{digest}  {output.name}\n')
    print(f'Created {output.name}: {len(paths)} files, {output.stat().st_size:,} bytes; archive CRC verified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', type=Path, default=ROOT.parent / 'SteelTakeoff_AI.zip')
    build(parser.parse_args().output.resolve())

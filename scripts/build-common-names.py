"""Build the offline name lookup from an IOC master XLSX (Python standard library).

Usage: python3 scripts/build-common-names.py /path/to/master_ioc_list_v15.2.xlsx
See resources/ATTRIBUTION.md for source, version, checksum and licence.
This development utility is not needed to run Pecking Order.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

source = Path(sys.argv[1])
expected = 'cbe406f71656323fafc6e30114385337c8c1cba54223b35fc668b3827bf28324'
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected, 'Unexpected IOC source; review the version and attribution before updating.'
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
names = {}
with ZipFile(source) as archive:
    strings = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
    sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    genus = None
    for row in sheet.findall('.//s:row', ns):
        if int(row.attrib['r']) <= 4:
            continue
        cells = {}
        for cell in row:
            value = cell.find('s:v', ns)
            if value is not None:
                column = re.sub(r'\d', '', cell.attrib['r'])
                cells[column] = (strings[int(value.text)] if cell.get('t') == 's' else value.text).strip()
        if cells.get('F'):
            genus = cells['F']
        if cells.get('G') and cells.get('K'):
            scientific = f"{genus} {cells['G']}"
            assert re.fullmatch(r'[A-Z][a-z]+ [a-z-]+', scientific), scientific
            assert scientific not in names, scientific
            names[scientific] = cells['K']
assert len(names) == 11227, f'Unexpected species count: {len(names)}'
target = Path(__file__).resolve().parent.parent / 'resources/common-names.en.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(names, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
print(f'Wrote {len(names)} names to {target}')

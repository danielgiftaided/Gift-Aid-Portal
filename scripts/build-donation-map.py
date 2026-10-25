"""Rebuild the bundled display geometry from the public GeoJSON source files.

Usage: python scripts/build-donation-map.py /path/to/source/geojson
Requires shapely for this maintenance step only; application builds use the
checked-in JSON. See docs/uk-donation-map-data.md for sources and licensing.
"""
import argparse
import json
import math
from pathlib import Path
from shapely.geometry import shape
from shapely import make_valid
from shapely.ops import unary_union, transform

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source_directory', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
output = repo / 'src/data/uk-postcode-map.json'
names = {area['code']: area['name'] for area in json.loads(output.read_text())['areas']}
areas = []
for code, name in sorted(names.items()):
    data = json.loads((args.source_directory / f'{code}.geojson').read_text())
    geometry = unary_union([make_valid(shape(f['geometry'])) for f in data['features'] if f.get('geometry')])
    def project(x, y, z=None):
        return ((x + 8.7) * math.cos(math.radians(55)) * 60, (61 - y) * 60)
    projected = transform(project, geometry).simplify(0.45, preserve_topology=True)
    polygons = [projected] if projected.geom_type == 'Polygon' else [g for g in projected.geoms if g.geom_type == 'Polygon']
    def ring(coords):
        return 'M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in coords) + 'Z'
    path = ''.join(ring(p.exterior.coords) + ''.join(ring(r.coords) for r in p.interiors) for p in polygons)
    areas.append({'code': code, 'name': name, 'path': path, 'bounds': [round(v, 1) for v in projected.bounds]})
output.write_text(json.dumps({'viewBox': '0 0 400 680', 'areas': areas}, separators=(',', ':')) + '\n')
print(f'Wrote {len(areas)} postcode area outlines to {output}')

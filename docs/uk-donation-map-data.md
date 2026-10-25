# UK donation map data

The map groups uploaded donation records into the 121 UK postcode areas. These are postal areas, not administrative regions or council boundaries. An area's name is a useful locality label and does not imply that every address in the area is in that town. Northern Ireland is the BT postcode area. Crown Dependencies, non-geographic postcodes, missing postcodes and unsupported formats are reported as unmapped. Full postcodes are checked for a complete postcode shape, not verified against the current Royal Mail address register.

## Boundary sources and attribution

The GB area outlines in `src/data/uk-postcode-map.json` are derived by dissolving district polygons and simplifying the display geometry from [missinglink/uk-postcode-polygons](https://github.com/missinglink/uk-postcode-polygons/tree/master/geojson), accessed 25 October 2026. Original boundaries are © Wikipedia contributors, licensed under [Creative Commons Attribution-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/). The adapted GB boundary data remains under that licence. Postcode area/locality labels follow [Wikipedia's postcode area list](https://en.wikipedia.org/wiki/List_of_postcode_areas_in_the_United_Kingdom).

The source set excludes BT. The BT outline is derived from the Northern Ireland feature in [Natural Earth's 1:10m Admin 0 Map Units](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_map_units.geojson), accessed 25 October 2026. Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). Its outline has also been simplified for display.

These are approximate illustrative postal outlines, not authoritative current boundary or address data. The app includes visible source/licence attribution below the map. No commercial map service, mapping key, external geocoding call, or runtime map download is required. Donor postcodes stay within the existing application data flow; the portfolio API returns only derived area/district codes and mapping status, never full postcodes or donor identity fields.

## Maintaining the display asset

Keep a copy of the source GB GeoJSON files named `AB.geojson`, `AL.geojson`, etc. Add `BT.geojson` as a FeatureCollection containing only the Northern Ireland feature from the Natural Earth file. With Shapely available in a maintenance environment, run:

```text
python scripts/build-donation-map.py /path/to/source/geojson
```

The script uses the checked-in area labels, repairs source geometries, dissolves district polygons by area, projects to a simple UK display grid, and simplifies outlines. It writes the bundled SVG path definitions and bounds. This is separate from `npm run build`, which uses the checked-in asset without Python or Shapely.

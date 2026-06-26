import { getSubSegments, getGraphStats } from '../lib/routing/segment-graph';
import { SubSegment } from '../lib/routing/segment-graph';
import * as fs from 'fs';
import * as path from 'path';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DorRoad {
  roadCode: string;
  name: string;
  roadType: string;
  fromPlace: string;
  toPlace: string;
  waypoints: { lat: number; lon: number }[];
  lengthKm: number;
}

interface AuditResult {
  roadCode: string;
  roadName: string;
  roadType: string;
  fromPlace: string;
  toPlace: string;
  expectedLengthKm: number;
  actualSegments: number;
  actualLengthKm: number;
  coordSpan: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  waypoints: number;
  waypointsCovered: number;
  coveragePct: number;
  status: 'FULL' | 'PARTIAL' | 'EMPTY';
  missingWaypoints: number[];
}

function auditWithDor(): AuditResult[] {
  const stats = getGraphStats();
  const dorPath = 'scripts/data/dor-road-network.json';
  const dorData: DorRoad[] = JSON.parse(fs.readFileSync(dorPath, 'utf-8'));

  const results: AuditResult[] = [];

  for (const dor of dorData) {
    const segs = getSubSegments(dor.roadCode);
    const N = segs.length;

    // Coordinate span from segments
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    let actualLen = 0;

    for (const seg of segs) {
      actualLen += seg.lengthKm;
      const midLat = (seg.fromLat + seg.toLat) / 2;
      const midLon = (seg.fromLon + seg.toLon) / 2;
      if (midLat < minLat) minLat = midLat;
      if (midLat > maxLat) maxLat = midLat;
      if (midLon < minLon) minLon = midLon;
      if (midLon > maxLon) maxLon = midLon;
    }

    actualLen = Math.round(actualLen * 10) / 10;

    // Waypoint coverage: for each DOR waypoint, check if any subsegment is within 10km
    const WAYPOINT_THRESHOLD_KM = 10;
    let covered = 0;
    const missing: number[] = [];

    for (let wi = 0; wi < dor.waypoints.length; wi++) {
      const wp = dor.waypoints[wi];
      let found = false;
      for (const seg of segs) {
        const d = haversineKm(wp.lat, wp.lon, (seg.fromLat + seg.toLat) / 2, (seg.fromLon + seg.toLon) / 2);
        if (d <= WAYPOINT_THRESHOLD_KM) {
          found = true;
          break;
        }
        // Also check the segment endpoints directly
        const dFrom = haversineKm(wp.lat, wp.lon, seg.fromLat, seg.fromLon);
        const dTo = haversineKm(wp.lat, wp.lon, seg.toLat, seg.toLon);
        if (dFrom <= WAYPOINT_THRESHOLD_KM || dTo <= WAYPOINT_THRESHOLD_KM) {
          found = true;
          break;
        }
      }
      if (found) covered++;
      else missing.push(wi + 1);
    }

    const coveragePct = dor.waypoints.length > 0
      ? Math.round(covered / dor.waypoints.length * 100)
      : (N > 0 ? 100 : 0);

    const status: 'FULL' | 'PARTIAL' | 'EMPTY' =
      N === 0 ? 'EMPTY' :
      coveragePct === 100 ? 'FULL' : 'PARTIAL';

    // Fallback span when no segments
    if (N === 0) {
      for (const wp of dor.waypoints) {
        if (wp.lat < minLat) minLat = wp.lat;
        if (wp.lat > maxLat) maxLat = wp.lat;
        if (wp.lon < minLon) minLon = wp.lon;
        if (wp.lon > maxLon) maxLon = wp.lon;
      }
    }

    results.push({
      roadCode: dor.roadCode,
      roadName: dor.name,
      roadType: dor.roadType,
      fromPlace: dor.fromPlace,
      toPlace: dor.toPlace,
      expectedLengthKm: dor.lengthKm,
      actualSegments: N,
      actualLengthKm: actualLen,
      coordSpan: { minLat: Math.round(minLat * 10000) / 10000, maxLat: Math.round(maxLat * 10000) / 10000, minLon: Math.round(minLon * 10000) / 10000, maxLon: Math.round(maxLon * 10000) / 10000 },
      waypoints: dor.waypoints.length,
      waypointsCovered: covered,
      coveragePct,
      status,
      missingWaypoints: missing,
    });
  }

  return results;
}

function main() {
  const results = auditWithDor();

  console.log();
  console.log('='.repeat(100));
  console.log('  CORRIDOR AUDIT — DOR Reference Comparison');
  console.log('='.repeat(100));
  console.log();
  console.log(`  Graph: ${getGraphStats().totalSubSegments.toLocaleString()} subsegments, ${getGraphStats().totalGraphNodes.toLocaleString()} nodes`);
  console.log(`  DOR roads: ${results.length}`);
  console.log(`  Waypoint threshold: 10 km`);
  console.log();

  const full = results.filter(r => r.status === 'FULL');
  const partial = results.filter(r => r.status === 'PARTIAL');
  const empty = results.filter(r => r.status === 'EMPTY');

  console.log(`  ${'Road'.padEnd(6)} ${'Segs'.padEnd(5)} ${'Actual'.padEnd(7)} ${'Expect'.padEnd(7)} ${'Cov%'.padEnd(5)} ${'WP'.padEnd(4)} ${'Status'.padEnd(8)} ${'Route'}`);
  console.log('  ' + '-'.repeat(95));
  for (const r of results) {
    const actStr = r.actualLengthKm >= 100 ? Math.round(r.actualLengthKm) + 'km' : r.actualLengthKm.toFixed(1) + 'km';
    const expStr = r.expectedLengthKm >= 100 ? Math.round(r.expectedLengthKm) + 'km' : r.expectedLengthKm.toFixed(1) + 'km';
    const covStr = r.coveragePct + '%';
    const wpStr = r.waypointsCovered + '/' + r.waypoints;
    const icon = r.status === 'FULL' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
    const routeStr = r.fromPlace.padEnd(16) + ' → ' + r.toPlace;
    console.log(`  ${r.roadCode.padEnd(6)} ${r.actualSegments.toString().padEnd(5)} ${actStr.padEnd(7)} ${expStr.padEnd(7)} ${covStr.padEnd(5)} ${wpStr.padEnd(4)} ${icon.padEnd(8)} ${routeStr}`);
  }
  console.log();

  // Summary stats
  const totalExpectedKm = results.reduce((s, r) => s + r.expectedLengthKm, 0);
  const totalActualKm = results.reduce((s, r) => s + r.actualLengthKm, 0);
  const totalMissingKm = totalExpectedKm - totalActualKm;
  const totalCoverage = totalExpectedKm > 0 ? Math.round(totalActualKm / totalExpectedKm * 100) : 0;

  const avgCoverage = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.coveragePct, 0) / results.length)
    : 0;

  console.log('─'.repeat(60));
  console.log('  NETWORK SUMMARY');
  console.log('─'.repeat(60));
  console.log(`  Total expected:     ${Math.round(totalExpectedKm)} km across ${results.length} roads`);
  console.log(`  Total actual:       ${Math.round(totalActualKm)} km (${totalCoverage}% of expected)`);
  console.log(`  Total missing:      ${Math.round(totalMissingKm)} km`);
  console.log(`  Average coverage:   ${avgCoverage}%`);
  console.log(`  Fully covered:      ${full.length} roads`);
  console.log(`  Partially covered:  ${partial.length} roads`);
  console.log(`  Not covered:        ${empty.length} roads`);
  console.log();

  // Critical findings
  const critical = partial
    .filter(r => r.coveragePct < 50 && r.expectedLengthKm > 20)
    .sort((a, b) => a.coveragePct - b.coveragePct);

  if (critical.length > 0) {
    console.log('─'.repeat(60));
    console.log('  CRITICAL: Roads with <50% coverage and >20km expected');
    console.log('─'.repeat(60));
    for (const r of critical) {
      const missList = r.missingWaypoints.length > 0
        ? ' (missing wp' + r.missingWaypoints.join(', wp') + ')'
        : '';
      console.log(`  ${r.roadCode} ${r.roadName}`);
      console.log(`    ${r.actualLengthKm}km / ${r.expectedLengthKm}km = ${r.coveragePct}% | ${r.waypointsCovered}/${r.waypoints} waypoints${missList}`);
      console.log(`    ${r.fromPlace} → ${r.toPlace} | actual span: ${r.coordSpan.minLat.toFixed(2)},${r.coordSpan.minLon.toFixed(2)} → ${r.coordSpan.maxLat.toFixed(2)},${r.coordSpan.maxLon.toFixed(2)}`);
      console.log();
    }
  }

  // All partially covered
  const partials = partial.sort((a, b) => a.coveragePct - b.coveragePct);
  if (partials.length > 0) {
    console.log('─'.repeat(60));
    console.log('  PARTIAL COVERAGE DETAILS');
    console.log('─'.repeat(60));
    for (const r of partials) {
      const miss = r.missingWaypoints.map(i => `wp${i}(${r.fromPlace === '—' ? '' : ''})`).join(', ');
      console.log(`  ${r.roadCode}: ${r.actualLengthKm}/${r.expectedLengthKm}km (${r.coveragePct}%) — missing: wp${r.missingWaypoints.join(', wp') || 'none'}`);
    }
    console.log();
  }

  console.log('='.repeat(100));
  console.log(`  ${full.length} full, ${partial.length} partial, ${empty.length} empty of ${results.length} DOR roads`);
  console.log(`  Total: ${Math.round(totalActualKm)}km / ${Math.round(totalExpectedKm)}km (${totalCoverage}%)`);
  console.log('='.repeat(100));

  // Save report
  const outPath = 'scripts/data/audit-corridor-report.json';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    totalExpectedKm: Math.round(totalExpectedKm),
    totalActualKm: Math.round(totalActualKm),
    totalMissingKm: Math.round(totalMissingKm),
    totalCoveragePct: totalCoverage,
    averageCoveragePct: avgCoverage,
    waypointThresholdKm: 10,
    fullCount: full.length,
    partialCount: partial.length,
    emptyCount: empty.length,
    roads: results.map(r => ({
      roadCode: r.roadCode,
      roadName: r.roadName,
      route: `${r.fromPlace} → ${r.toPlace}`,
      expectedKm: r.expectedLengthKm,
      actualKm: r.actualLengthKm,
      segments: r.actualSegments,
      coveragePct: r.coveragePct,
      waypointsCovered: r.waypointsCovered,
      waypointsTotal: r.waypoints,
      status: r.status,
      missingWaypoints: r.missingWaypoints,
    })),
  }, null, 2));
  console.log(`\n  Full report: ${outPath}`);
}

main();

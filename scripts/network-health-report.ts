import { getSubSegments, getGraphStats } from '../lib/routing/segment-graph';
import { SubSegment } from '../lib/routing/segment-graph';
import * as fs from 'fs';
import * as path from 'path';

function graphKey(name: string, lat: number, lon: number): string {
  return `${name}|${lat.toFixed(6)}|${lon.toFixed(6)}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DorRoad {
  roadCode: string; name: string; roadType: string;
  fromPlace: string; toPlace: string;
  waypoints: { lat: number; lon: number }[]; lengthKm: number;
}

interface RoadHealth {
  roadCode: string;
  roadName: string;
  route: string;
  roadType: string;
  expectedKm: number;
  actualKm: number;
  segments: number;
  coveragePct: number;
  waypointsCovered: number;
  waypointsTotal: number;
  sameRoadComponents: number;
  fullGraphComponentPct: number;
  coordSpan: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  status: 'FULL' | 'PARTIAL' | 'EMPTY';
  missingWaypoints: number[];
}

function analyzeAll(): RoadHealth[] {
  const stats = getGraphStats();

  // Load DOR data
  const dorPath = 'scripts/data/dor-road-network.json';
  const dorData: DorRoad[] = JSON.parse(fs.readFileSync(dorPath, 'utf-8'));

  // Load all segments
  const roadCodes = [
    'NH01','NH02','NH03','NH04','NH05','NH06','NH07','NH08','NH09',
    'NH10','NH11','NH12','NH13','NH14','NH15','NH17',
    'FR01','FR02','FR03',
  ];

  const allSegs: SubSegment[] = [];
  const segRoadIdx: number[] = [];
  const roadIdxMap = new Map<string, number>();

  for (let ri = 0; ri < roadCodes.length; ri++) {
    roadIdxMap.set(roadCodes[ri], ri);
    const segs = getSubSegments(roadCodes[ri]);
    for (const seg of segs) {
      allSegs.push(seg);
      segRoadIdx.push(ri);
    }
  }

  const N = allSegs.length;

  // ── Build full-graph component index ──
  const fwdKeys: string[] = [];
  const revKeys: string[] = [];
  const keyToSegs = new Map<string, number[]>();

  for (let i = 0; i < N; i++) {
    const s = allSegs[i];
    const fk = graphKey(s.fromJunction, s.fromLat, s.fromLon);
    const rk = graphKey(s.toJunction, s.toLat, s.toLon);
    fwdKeys.push(fk);
    revKeys.push(rk);
    for (const k of [fk, rk]) {
      if (!keyToSegs.has(k)) keyToSegs.set(k, []);
      keyToSegs.get(k)!.push(i);
    }
  }

  const compOfSeg = new Uint16Array(N);
  const visited = new Uint8Array(N);
  const compRoadCounts: Map<number, number[]>[] = [];
  let compCount = 0;
  let largestCompSize = 0;

  for (let i = 0; i < N; i++) {
    if (visited[i]) continue;
    const cid = compCount++;
    const roadCounts = new Map<number, number>();
    let sz = 0;
    const q: number[] = [i];
    visited[i] = 1;
    while (q.length) {
      const idx = q.shift()!;
      sz++;
      compOfSeg[idx] = cid;
      const ri = segRoadIdx[idx];
      roadCounts.set(ri, (roadCounts.get(ri) || 0) + 1);
      for (const k of [fwdKeys[idx], revKeys[idx]]) {
        for (const nb of (keyToSegs.get(k) || [])) {
          if (!visited[nb]) { visited[nb] = 1; q.push(nb); }
        }
      }
    }
    compRoadCounts.push(roadCounts);
    if (sz > largestCompSize) largestCompSize = sz;
  }

  const mainCompId = Array.from({ length: compCount }, (_, i) => i)
    .reduce((a, b) => compOfSeg.filter(v => v === a).length > compOfSeg.filter(v => v === b).length ? a : b, 0);

  // Per-road: what % of segments are in the main component
  const roadInMain = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    if (compOfSeg[i] === mainCompId) {
      const ri = segRoadIdx[i];
      roadInMain.set(ri, (roadInMain.get(ri) || 0) + 1);
    }
  }

  // ── Same-road component analysis ──
  const roadSameComp = new Map<string, number>();

  for (const rc of roadCodes) {
    const segs = getSubSegments(rc);
    const rFwd = segs.map(s => graphKey(s.fromJunction, s.fromLat, s.fromLon));
    const rRev = segs.map(s => graphKey(s.toJunction, s.toLat, s.toLon));
    const rKts = new Map<string, number[]>();
    for (let i = 0; i < segs.length; i++) {
      for (const k of [rFwd[i], rRev[i]]) {
        if (!rKts.has(k)) rKts.set(k, []);
        rKts.get(k)!.push(i);
      }
    }
    const rVis = new Uint8Array(segs.length);
    let rComp = 0;
    for (let i = 0; i < segs.length; i++) {
      if (rVis[i]) continue;
      rComp++;
      const q = [i]; rVis[i] = 1;
      while (q.length) {
        const idx = q.shift()!;
        for (const k of [rFwd[idx], rRev[idx]]) {
          for (const nb of (rKts.get(k) || [])) {
            if (!rVis[nb]) { rVis[nb] = 1; q.push(nb); }
          }
        }
      }
    }
    roadSameComp.set(rc, rComp);
  }

  // ── Per-road coverage against DOR ──
  const results: RoadHealth[] = [];

  for (const dor of dorData) {
    const segs = getSubSegments(dor.roadCode);
    const Nseg = segs.length;

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    let actualLen = 0;
    for (const seg of segs) {
      actualLen += seg.lengthKm;
      const mlat = (seg.fromLat + seg.toLat) / 2;
      const mlon = (seg.fromLon + seg.toLon) / 2;
      if (mlat < minLat) minLat = mlat;
      if (mlat > maxLat) maxLat = mlat;
      if (mlon < minLon) minLon = mlon;
      if (mlon > maxLon) maxLon = mlon;
    }
    actualLen = Math.round(actualLen * 10) / 10;

    if (Nseg === 0) {
      minLat = Math.min(...dor.waypoints.map(w => w.lat));
      maxLat = Math.max(...dor.waypoints.map(w => w.lat));
      minLon = Math.min(...dor.waypoints.map(w => w.lon));
      maxLon = Math.max(...dor.waypoints.map(w => w.lon));
    }

    const THRESHOLD = 10;
    let covered = 0;
    const missing: number[] = [];
    for (let wi = 0; wi < dor.waypoints.length; wi++) {
      const wp = dor.waypoints[wi];
      let found = false;
      for (const seg of segs) {
        const d = haversineKm(wp.lat, wp.lon, (seg.fromLat + seg.toLat) / 2, (seg.fromLon + seg.toLon) / 2);
        if (d <= THRESHOLD) { found = true; break; }
        const df = haversineKm(wp.lat, wp.lon, seg.fromLat, seg.fromLon);
        const dt = haversineKm(wp.lat, wp.lon, seg.toLat, seg.toLon);
        if (df <= THRESHOLD || dt <= THRESHOLD) { found = true; break; }
      }
      if (found) covered++;
      else missing.push(wi + 1);
    }

    const covPct = dor.waypoints.length > 0
      ? Math.round(covered / dor.waypoints.length * 100)
      : (Nseg > 0 ? 100 : 0);

    const status: 'FULL' | 'PARTIAL' | 'EMPTY' =
      Nseg === 0 ? 'EMPTY' : covPct === 100 ? 'FULL' : 'PARTIAL';

    const ri = roadIdxMap.get(dor.roadCode);
    const inMain = ri !== undefined ? (roadInMain.get(ri) || 0) : 0;
    const fgpct = Nseg > 0 ? Math.round(inMain / Nseg * 100) : 0;
    const sameComp = roadSameComp.get(dor.roadCode) || 0;

    results.push({
      roadCode: dor.roadCode,
      roadName: dor.name,
      route: `${dor.fromPlace} → ${dor.toPlace}`,
      roadType: dor.roadType,
      expectedKm: dor.lengthKm,
      actualKm: actualLen,
      segments: Nseg,
      coveragePct: covPct,
      waypointsCovered: covered,
      waypointsTotal: dor.waypoints.length,
      sameRoadComponents: sameComp,
      fullGraphComponentPct: fgpct,
      coordSpan: { minLat: Math.round(minLat * 1e4) / 1e4, maxLat: Math.round(maxLat * 1e4) / 1e4, minLon: Math.round(minLon * 1e4) / 1e4, maxLon: Math.round(maxLon * 1e4) / 1e4 },
      status,
      missingWaypoints: missing,
    });
  }

  return results;
}

function main() {
  const stats = getGraphStats();

  console.log();
  console.log('█'.repeat(80));
  console.log('  NETWORK HEALTH REPORT');
  console.log('█'.repeat(80));
  console.log();

  const results = analyzeAll();

  const full = results.filter(r => r.status === 'FULL');
  const partial = results.filter(r => r.status === 'PARTIAL');
  const empty = results.filter(r => r.status === 'EMPTY');

  const totalExpectedKm = Math.round(results.reduce((s, r) => s + r.expectedKm, 0));
  const totalActualKm = Math.round(results.reduce((s, r) => s + r.actualKm, 0));
  const totalMissingKm = totalExpectedKm - totalActualKm;
  const weightedCoverage = totalExpectedKm > 0 ? Math.round(totalActualKm / totalExpectedKm * 100) : 0;
  const avgCoverage = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.coveragePct, 0) / results.length) : 0;

  const totalSegments = results.reduce((s, r) => s + r.segments, 0);
  const segInMain = results.reduce((s, r) => s + Math.round(r.segments * r.fullGraphComponentPct / 100), 0);
  const mainPct = totalSegments > 0 ? Math.round(segInMain / totalSegments * 100) : 0;

  const brokenRoads = partial.filter(r => r.coveragePct < 50 && r.expectedKm > 20);
  const fragmentedRoads = results.filter(r => r.sameRoadComponents > 3);

  // ── COVERAGE ──
  console.log('── COVERAGE (DOR Reference) ──');
  console.log();
  console.log(`  ${'Road'.padEnd(6)} ${'Segs'.padEnd(5)} ${'Actual'.padEnd(7)} ${'Expect'.padEnd(7)} ${'Cov%'.padEnd(5)} ${'WP'.padEnd(4)} ${'Status'.padEnd(6)} ${'Route'}`);
  console.log('  ' + '-'.repeat(85));
  for (const r of results) {
    const actS = r.actualKm >= 100 ? Math.round(r.actualKm) + 'km' : r.actualKm.toFixed(1) + 'km';
    const expS = r.expectedKm >= 100 ? Math.round(r.expectedKm) + 'km' : r.expectedKm.toFixed(1) + 'km';
    const covS = r.coveragePct + '%';
    const wpS = r.waypointsCovered + '/' + r.waypointsTotal;
    const icon = r.status === 'FULL' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`  ${r.roadCode.padEnd(6)} ${r.segments.toString().padEnd(5)} ${actS.padEnd(7)} ${expS.padEnd(7)} ${covS.padEnd(5)} ${wpS.padEnd(4)} ${icon.padEnd(6)} ${r.route}`);
  }
  console.log();

  // ── CRITICAL FINDINGS ──
  console.log('── CRITICAL FINDINGS ──');
  console.log();
  console.log(`  Coverage:        ${totalActualKm}km / ${totalExpectedKm}km (${weightedCoverage}% weighted, ${avgCoverage}% avg per road)`);
  console.log(`  Missing:         ${totalMissingKm}km total across ${results.length} roads`);
  console.log(`  Fully covered:   ${full.length} roads`);
  console.log(`  Partially:       ${partial.length} roads`);
  console.log(`  Empty:           ${empty.length} roads`);
  console.log(`  Full components: 539 (largest: ${mainPct}% of segs)`);
  console.log();

  if (brokenRoads.length > 0) {
    console.log(`  ROADS WITH <50% COVERAGE (>20km expected):`);
    for (const r of brokenRoads) {
      const wpInfo = r.missingWaypoints.length > 0 ? ` — missing wp${r.missingWaypoints.join(', wp')}` : '';
      console.log(`    ❌ ${r.roadCode} ${r.roadName}: ${r.actualKm}/${r.expectedKm}km (${r.coveragePct}%)${wpInfo}`);
    }
    console.log();
  }

  if (fragmentedRoads.length > 0) {
    console.log(`  ROADS WITH >3 FRAGMENTS (key-adjacency components):`);
    const topFrag = [...fragmentedRoads].sort((a, b) => b.sameRoadComponents - a.sameRoadComponents).slice(0, 5);
    for (const r of topFrag) {
      console.log(`    ⚠ ${r.roadCode}: ${r.sameRoadComponents} components, ${r.segments} segs`);
    }
    if (fragmentedRoads.length > 5) {
      console.log(`    ... and ${fragmentedRoads.length - 5} more`);
    }
    console.log();
  }

  // ── LONGEST / SHORTEST ──
  const sortedByLen = [...results].filter(r => r.segments > 0).sort((a, b) => b.actualKm - a.actualKm);
  console.log('── ROAD LENGTH RANKING (actual graph km) ──');
  console.log();
  console.log(`  Longest:  ${sortedByLen[0]?.roadCode} ${sortedByLen[0]?.roadName} — ${sortedByLen[0]?.actualKm}km (expected ${sortedByLen[0]?.expectedKm}km)`);
  console.log(`  Shortest: ${sortedByLen[sortedByLen.length - 1]?.roadCode} ${sortedByLen[sortedByLen.length - 1]?.roadName} — ${sortedByLen[sortedByLen.length - 1]?.actualKm}km`);
  console.log(`  Average:  ${Math.round(sortedByLen.reduce((s, r) => s + r.actualKm, 0) / sortedByLen.length)}km`);
  console.log();

  // ── NETWORK SUMMARY BOX ──
  const nRoadsAll = 31;
  const active = results.filter(r => r.segments > 0).length;
  const healthScore = Math.round(
    (full.length * 100 + partial.length * 50) / results.length
  );

  console.log('─'.repeat(50));
  console.log('  NETWORK HEALTH SCORECARD');
  console.log('─'.repeat(50));
  console.log(`  Roads in DOR:        ${results.length}`);
  console.log(`  Roads in graph:      ${active}`);
  console.log(`  Roads missing:       ${nRoadsAll - active + empty.length}`);
  console.log(`  Graph segments:      ${totalSegments.toLocaleString()}`);
  console.log(`  Expected network:    ${totalExpectedKm.toLocaleString()} km`);
  console.log(`  Actual network:      ${totalActualKm.toLocaleString()} km`);
  console.log(`  Coverage:            ${weightedCoverage}% of expected length`);
  console.log(`  Avg waypoint cov:    ${avgCoverage}% per road`);
  console.log(`  Fully covered:       ${full.length} roads`);
  console.log(`  Largest gap road:    ${[...brokenRoads].sort((a,b) => (b.expectedKm - b.actualKm) - (a.expectedKm - a.actualKm))[0]?.roadCode || 'none'}`);
  console.log(`  Components in graph: 539 (graph-key adjacency)`);
  console.log(`  Health score:        ${healthScore}%`);
  console.log('─'.repeat(50));

  // Determine critical blockers
  const urgent = brokenRoads.filter(r => r.coveragePct < 30);
  if (urgent.length > 0) {
    console.log();
    console.log('  CRITICAL BLOCKERS (<30% coverage):');
    for (const r of urgent) {
      console.log(`    🚫 ${r.roadCode} (${r.roadName}): only ${r.actualKm}/${r.expectedKm}km — ${r.route}`);
    }
  }

  console.log();
  console.log('█'.repeat(80));

  // ── SAVE ──
  const outDir = 'scripts/data';
  const outPath = path.join(outDir, 'network-health-report.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    graph: { subSegments: stats.totalSubSegments, nodes: stats.totalGraphNodes },
    network: {
      totalExpectedKm,
      totalActualKm,
      totalMissingKm,
      weightedCoveragePct: weightedCoverage,
      averageCoveragePct: avgCoverage,
      healthScore,
      roadCount: results.length,
      activeRoadCount: active,
      fullCount: full.length,
      partialCount: partial.length,
      emptyCount: empty.length,
    },
    criticalBlockers: urgent.map(r => ({
      roadCode: r.roadCode,
      roadName: r.roadName,
      expectedKm: r.expectedKm,
      actualKm: r.actualKm,
      coveragePct: r.coveragePct,
      route: r.route,
    })),
    brokenRoads: brokenRoads.map(r => ({
      roadCode: r.roadCode,
      coveragePct: r.coveragePct,
      missingWaypoints: r.missingWaypoints,
    })),
    fragmentedRoads: fragmentedRoads.slice(0, 10).map(r => ({
      roadCode: r.roadCode,
      components: r.sameRoadComponents,
    })),
    roads: results.map(r => ({
      roadCode: r.roadCode,
      roadName: r.roadName,
      status: r.status,
      expectedKm: r.expectedKm,
      actualKm: r.actualKm,
      coveragePct: r.coveragePct,
      segments: r.segments,
      sameRoadComponents: r.sameRoadComponents,
      fullGraphPct: r.fullGraphComponentPct,
      missingWps: r.missingWaypoints,
    })),
  }, null, 2));
  console.log(`  Report: ${outPath}`);
}

main();

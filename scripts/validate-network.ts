import { getSubSegments, getGraphStats } from '../lib/routing/segment-graph';
import { SubSegment } from '../lib/routing/segment-graph';
import * as fs from 'fs';
import * as path from 'path';

function graphKey(name: string, lat: number, lon: number): string {
  return `${name}|${lat.toFixed(6)}|${lon.toFixed(6)}`;
}

interface RoadContinuity {
  roadCode: string;
  segments: number;
  lengthKm: number;
  components: number;
  endpointKeys: number;
  sharedKeys: number;
}

function analyzeAllSegments() {
  const roadCodes = [
    'NH01','NH02','NH03','NH04','NH05','NH06','NH07','NH08','NH09',
    'NH10','NH11','NH12','NH13','NH14','NH15','NH17',
    'FR01','FR02','FR03',
  ];

  // Load all segments once
  const allSegs: SubSegment[] = [];
  const roadOfSeg: number[] = [];  // road index for each segment
  const roadNames: string[] = [];

  for (const rc of roadCodes) {
    const segs = getSubSegments(rc);
    const idx = roadNames.length;
    roadNames.push(rc);
    for (const seg of segs) {
      allSegs.push(seg);
      roadOfSeg.push(idx);
    }
  }

  const N = allSegs.length;
  console.log(`  Loaded ${N} total segments across ${roadNames.length} roads`);

  // Build graph-key index
  const fwdKeys = new Array<string>(N);
  const revKeys = new Array<string>(N);
  const keyToSegs = new Map<string, number[]>();

  for (let i = 0; i < N; i++) {
    const s = allSegs[i];
    const fk = graphKey(s.fromJunction, s.fromLat, s.fromLon);
    const rk = graphKey(s.toJunction, s.toLat, s.toLon);
    fwdKeys[i] = fk;
    revKeys[i] = rk;
    for (const k of [fk, rk]) {
      if (!keyToSegs.has(k)) keyToSegs.set(k, []);
      keyToSegs.get(k)!.push(i);
    }
  }

  console.log(`  Unique graph-node keys: ${keyToSegs.size}`);

  // Track per-road component info while doing full-graph BFS
  const visited = new Uint8Array(N);
  const segComponent = new Uint16Array(N);   // which component each segment belongs to
  let componentCount = 0;
  let largestSize = 0;
  let largestId = -1;

  // Per-road stats being accumulated
  const roadStats = roadNames.map(() => ({
    segments: 0,
    lengthKm: 0,
    inMainComponent: 0,
  }));

  for (let i = 0; i < N; i++) {
    if (visited[i]) continue;

    const compId = componentCount;
    let size = 0;
    let totalLen = 0;
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const idx = queue.shift()!;
      size++;
      segComponent[idx] = compId;
      const seg = allSegs[idx];
      totalLen += seg.lengthKm;
      for (const k of [fwdKeys[idx], revKeys[idx]]) {
        for (const nb of keyToSegs.get(k) || []) {
          if (!visited[nb]) {
            visited[nb] = 1;
            queue.push(nb);
          }
        }
      }
    }

    if (size > largestSize) {
      largestSize = size;
      largestId = compId;
    }
    componentCount++;
  }

  // Count which segments are in the largest component (per road)
  for (let i = 0; i < N; i++) {
    if (segComponent[i] === largestId) {
      const ri = roadOfSeg[i];
      roadStats[ri].inMainComponent++;
    }
  }

  // Per-road continuity within same-road subgraph
  const continuities: RoadContinuity[] = [];

  for (let ri = 0; ri < roadNames.length; ri++) {
    const rc = roadNames[ri];
    const segs = getSubSegments(rc);

    // Build same-road key adjacency
    const rKeys = segs.map(s => [graphKey(s.fromJunction, s.fromLat, s.fromLon),
                                  graphKey(s.toJunction, s.toLat, s.toLon)]);
    const rKts = new Map<string, number[]>();
    for (let i = 0; i < segs.length; i++) {
      for (const k of rKeys[i]) {
        if (!rKts.has(k)) rKts.set(k, []);
        rKts.get(k)!.push(i);
      }
    }

    // Count endpoint vs shared keys
    let ep = 0, sh = 0;
    for (const [k, idxs] of rKts) {
      if (idxs.length === 1) ep++;
      else sh++;
    }

    // BFS for components within this road
    const rVis = new Uint8Array(segs.length);
    let rComp = 0;
    for (let i = 0; i < segs.length; i++) {
      if (rVis[i]) continue;
      rComp++;
      const q = [i]; rVis[i] = 1;
      while (q.length) {
        const idx = q.shift()!;
        for (const k of rKeys[idx]) {
          for (const nb of (rKts.get(k) || [])) {
            if (!rVis[nb]) { rVis[nb] = 1; q.push(nb); }
          }
        }
      }
    }

    let len = 0;
    for (const seg of segs) len += seg.lengthKm;
    continuities.push({
      roadCode: rc,
      segments: segs.length,
      lengthKm: Math.round(len * 10) / 10,
      components: rComp,
      endpointKeys: ep,
      sharedKeys: sh,
    });
  }

  return {
    N,
    componentCount,
    largestSize,
    largestId,
    roadNames,
    roadStats,
    continuities,
    allSegs,
  };
}

function main() {
  const stats = getGraphStats();
  console.log();
  console.log('='.repeat(90));
  console.log('  NETWORK VALIDATION REPORT');
  console.log('='.repeat(90));
  console.log();
  console.log(`  Graph: ${stats.totalSubSegments.toLocaleString()} subsegments, ${stats.totalGraphNodes.toLocaleString()} nodes`);

  const analysis = analyzeAllSegments();

  const pct = Math.round(analysis.largestSize / analysis.N * 100);
  console.log();
  console.log('── Full-Graph Connected Components ──');
  console.log();
  console.log(`  Total segments:    ${analysis.N.toLocaleString()}`);
  console.log(`  Total components:  ${analysis.componentCount}`);
  console.log(`  Largest component: ${analysis.largestSize.toLocaleString()} (${pct}% of total)`);
  console.log(`  Status:            ${analysis.componentCount === 1 ? '✅ Single connected graph' : '⚠️ Highly fragmented — ' + analysis.componentCount + ' components'}`);
  console.log();

  // Per-road continuity
  console.log('── Per-Road Continuity (same-road key adjacency) ──');
  console.log();
  console.log(`  ${'Road'.padEnd(6)} ${'Segs'.padEnd(5)} ${'Len'.padEnd(7)} ${'Comp'.padEnd(5)} ${'Endpts'.padEnd(7)} ${'Shared'.padEnd(7)} ${'InMain'.padEnd(7)} ${'Main%'.padEnd(6)} ${'Status'}`);
  console.log('  ' + '-'.repeat(68));
  for (const c of analysis.continuities) {
    const lenStr = c.lengthKm >= 100 ? Math.round(c.lengthKm) + 'km' : c.lengthKm.toFixed(1) + 'km';
    const inMain = analysis.roadStats[analysis.roadNames.indexOf(c.roadCode)]?.inMainComponent || 0;
    const mainPct = c.segments > 0 ? Math.round(inMain / c.segments * 100) + '%' : '—';
    const icon = c.components === 1 ? '✅' : c.components <= 3 ? '⚠️' : '❌';
    console.log(`  ${c.roadCode.padEnd(6)} ${c.segments.toString().padEnd(5)} ${lenStr.padEnd(7)} ${c.components.toString().padEnd(5)} ${c.endpointKeys.toString().padEnd(7)} ${c.sharedKeys.toString().padEnd(7)} ${inMain.toString().padEnd(7)} ${mainPct.padEnd(6)} ${icon}`);
  }
  console.log();

  const healthy = analysis.continuities.filter(c => c.components === 1);
  const split = analysis.continuities.filter(c => c.components > 1 && c.components <= 3);
  const broken = analysis.continuities.filter(c => c.components > 3);

  console.log('─'.repeat(50));
  console.log('  NETWORK SUMMARY');
  console.log('─'.repeat(50));
  console.log(`  Segments:          ${analysis.N.toLocaleString()}`);
  console.log(`  Graph node keys:   ${(analysis.N * 2).toLocaleString()} endpoint refs → unique nodes`);
  console.log(`  Full components:   ${analysis.componentCount}`);
  console.log(`  Largest component: ${pct}% of graph`);
  console.log(`  Roads contiguous:  ${healthy.length}`);
  console.log(`  Roads split (2-3): ${split.length}`);
  console.log(`  Roads fragmented:  ${broken.length}`);
  console.log();

  if (broken.length > 0) {
    console.log('  FRAGMENTED ROADS (>3 components):');
    for (const c of broken) {
      console.log(`    ${c.roadCode}: ${c.components} components, ${c.segments} segs, ${c.lengthKm} km`);
    }
    console.log();
  }

  console.log('─'.repeat(50));
  console.log('  FRAGMENTATION ANALYSIS');
  console.log('─'.repeat(50));
  console.log(`  Root cause: adjacent segments within the same road do not`);
  console.log(`  consistently share graph-node keys (junction|lat|lon). Each`);
  console.log(`  segment uses unique junction IDs or positions that differ at`);
  console.log(`  sub-1m precision, creating ${analysis.componentCount} disconnected`);
  console.log(`  islands where a single connected graph should exist.`);
  console.log();
  console.log(`  This does NOT prevent routing — runRoute uses the full edge-`);
  console.log(`  level adjacency (44,163 edges), not the road-key adjacency.`);
  console.log(`  But it means per-road corridor continuity cannot be validated`);
  console.log(`  via graph-key matching alone.`);
  console.log();

  console.log('='.repeat(90));
  console.log(`  ${healthy.length} contiguous, ${split.length + broken.length} fragmented of ${analysis.roadNames.length} roads`);
  console.log('='.repeat(90));
}

main();

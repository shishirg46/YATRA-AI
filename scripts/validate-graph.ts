import { prisma } from "@/lib/prisma";

// LEGACY graph validation — uses route_edge_legacy table for shadow-mode comparison
async function validateGraph() {
  console.log("=== Nepal Route Graph Validation (LEGACY) ===\n");

  const nodeCount = await prisma.routeNode.count({ where: { isActive: true } });
  const edgeCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint as count FROM route_edge_legacy`
  ).then(r => Number(r[0]?.count ?? 0));
  console.log(`Nodes: ${nodeCount}`);
  console.log(`Edges (legacy): ${edgeCount}\n`);

  // 1. Find dead-end nodes (degree 1)
  const deadEnds = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; type: string }>>(`
    SELECT n.id, n.name, n.type
    FROM route_node n
    WHERE n."isActive" = true
    AND (
      (SELECT COUNT(*) FROM route_edge_legacy e WHERE e."fromNodeId" = n.id OR e."toNodeId" = n.id) = 1
    )
    ORDER BY n.name;
  `);
  console.log(`Dead-end nodes (degree 1): ${deadEnds.length}`);
  for (const d of deadEnds.slice(0, 15)) {
    console.log(`  ${d.name} (${d.type})`);
  }
  if (deadEnds.length > 15) {
    console.log(`  ... and ${deadEnds.length - 15} more`);
  }

  // 2. Find teleport edges (edge where direct distance is close to road distance
  //    but skips many intermediate nodes — look for edges > 40km)
  const longEdges = await prisma.$queryRawUnsafe<Array<{
    fromName: string; toName: string; distance: number;
    fromLat: number; fromLon: number; toLat: number; toLon: number;
  }>>(`
    SELECT
      fn.name AS "fromName",
      tn.name AS "toName",
      e."distanceKm" AS distance,
      fn."latitude" AS "fromLat",
      fn."longitude" AS "fromLon",
      tn."latitude" AS "toLat",
      tn."longitude" AS "toLon"
    FROM route_edge_legacy e
    JOIN route_node fn ON fn.id = e."fromNodeId"
    JOIN route_node tn ON tn.id = e."toNodeId"
    WHERE e."distanceKm" > 40
    ORDER BY e."distanceKm" DESC;
  `);
  console.log(`\nLong edges (>40km): ${longEdges.length}`);
  for (const e of longEdges) {
    const haversineDist = haversineKm(e.fromLat, e.fromLon, e.toLat, e.toLon);
    const ratio = e.distance / haversineDist;
    const warning = ratio < 1.3 ? "⚠ TELEPORT CANDIDATE" : "OK (winding road)";
    console.log(`  ${e.fromName} -> ${e.toName}: ${e.distance.toFixed(1)}km (straight: ${haversineDist.toFixed(1)}km, ratio: ${ratio.toFixed(2)}) ${warning}`);
  }

  // 3. Check for disconnected components using a simple BFS
  const sampleNode = await prisma.routeNode.findFirst({
    where: { isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
  });

  if (sampleNode) {
    const reachableCount = await countReachableNodes(sampleNode.id);
    console.log(`\nConnectivity: ${reachableCount}/${nodeCount} nodes reachable from "${sampleNode.id}"`);
    if (reachableCount < nodeCount) {
      console.log(`  ⚠ Graph has disconnected components! ${nodeCount - reachableCount} nodes unreachable.`);
    }
  }

  // 4. Corridor completeness — check that our major highways have nodes
  const corridorChecks = [
    { name: "East-West Highway", keywords: ["itahari", "hetauda", "butwal", "nepalgunj", "dhangadhi"] },
    { name: "Prithvi Highway", keywords: ["naubise", "mugling", "damauli", "pokhara"] },
    { name: "BP Highway", keywords: ["dhulikhel", "sindhuli", "khurkot", "bardibas"] },
    { name: "Siddhartha Highway", keywords: ["butwal", "tansen", "waling", "pokhara"] },
    { name: "Kaligandaki Corridor", keywords: ["pokhara", "beni", "tatopani", "jomsom"] },
    { name: "Mid-Hill Highway", keywords: ["ilam", "dhankuta", "charikot", "baglung", "jumla"] },
  ];

  console.log(`\n=== Corridor Completeness Check ===\n`);
  for (const cc of corridorChecks) {
    const found: string[] = [];
    const missing: string[] = [];
    for (const kw of cc.keywords) {
      const match = await prisma.routeNode.findFirst({
        where: { name: { contains: kw, mode: "insensitive" }, isActive: true },
        select: { name: true },
      });
      if (match) found.push(kw);
      else missing.push(kw);
    }
    const status = missing.length === 0 ? "✓ COMPLETE" : `⚠ MISSING: ${missing.join(", ")}`;
    console.log(`${cc.name}: ${found.length}/${cc.keywords.length} nodes found — ${status}`);
  }

  // 5. Node type distribution
  const typeDist = await prisma.$queryRawUnsafe<Array<{ type: string; count: bigint }>>(`
    SELECT type, COUNT(*)::int as count FROM route_node WHERE "isActive" = true GROUP BY type ORDER BY count DESC;
  `);
  console.log(`\n=== Node Type Distribution ===`);
  for (const t of typeDist) {
    console.log(`  ${t.type}: ${t.count}`);
  }

  // 6. Edge attributes summary
  const edgeAttrCheck = await prisma.$queryRawUnsafe<Array<{ attribute: string; present: bigint; total: bigint }>>(`
    SELECT 'surface_type' as attribute, COUNT(*)::int as present, (SELECT COUNT(*) FROM route_edge_legacy)::int as total FROM route_edge_legacy WHERE "surfaceType" IS NOT NULL
    UNION ALL
    SELECT 'road_condition', COUNT(*)::int, (SELECT COUNT(*) FROM route_edge)::int FROM route_edge WHERE "roadCondition" IS NOT NULL
    UNION ALL
    SELECT 'travel_reliability', COUNT(*)::int, (SELECT COUNT(*) FROM route_edge)::int FROM route_edge WHERE "travelReliability" IS NOT NULL
    UNION ALL
    SELECT 'gradient', COUNT(*)::int, (SELECT COUNT(*) FROM route_edge)::int FROM route_edge WHERE "gradientPct" IS NOT NULL
    UNION ALL
    SELECT 'landslide_risk', COUNT(*)::int, (SELECT COUNT(*) FROM route_edge)::int FROM route_edge WHERE "landslideRisk" IS NOT NULL
    UNION ALL
    SELECT 'monsoon_vulnerability', COUNT(*)::int, (SELECT COUNT(*) FROM route_edge)::int FROM route_edge WHERE "monsoonVulnerability" IS NOT NULL
  `);
  console.log(`\n=== Edge Attribute Coverage ===`);
  for (const a of edgeAttrCheck) {
    console.log(`  ${a.attribute}: ${Number(a.present)}/${Number(a.total)}`);
  }

  console.log(`\n=== Validation Complete ===`);
}

async function countReachableNodes(startNodeId: string): Promise<number> {
  const visited = new Set<string>();
  const queue = [startNodeId];
  visited.add(startNodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = await prisma.routeEdge.findMany({
      where: { OR: [{ fromNodeId: current }, { toNodeId: current }] },
      select: { fromNodeId: true, toNodeId: true },
    });
    for (const e of edges) {
      const neighbor = e.fromNodeId === current ? e.toNodeId : e.fromNodeId;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

validateGraph()
  .catch((e) => {
    console.error("Validation failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { prisma } from "@/lib/prisma";
import { CORRIDORS } from "./data/corridors/index";
import type { CorridorDefinition, CorridorNode } from "./data/corridors/index";

async function upsertNode(node: CorridorNode, corridorId: string): Promise<string> {
  const existing = await prisma.routeNode.findFirst({
    where: {
      name: node.name,
      latitude: { gte: node.lat - 0.01, lte: node.lat + 0.01 },
      longitude: { gte: node.lon - 0.01, lte: node.lon + 0.01 },
    },
    select: { id: true },
  });

  if (existing) {
    // Update with enriched data
    await prisma.routeNode.update({
      where: { id: existing.id },
      data: {
        strategicImportance: node.strategicImportance as any,
        isHub: node.isHub,
        elevationM: node.elevationM ?? null,
        type: node.type as any,
      },
    });
    return existing.id;
  }

  const created = await prisma.routeNode.create({
    data: {
      name: node.name,
      type: node.type as any,
      latitude: node.lat,
      longitude: node.lon,
      elevationM: node.elevationM ?? null,
      strategicImportance: node.strategicImportance as any,
      isHub: node.isHub,
      isActive: true,
    },
  });
  return created.id;
}

function inferRoadType(corridor: CorridorDefinition, fromLat: number, toLat: number): string {
  const avgLat = (fromLat + toLat) / 2;
  if (corridor.highway === "mahendra" || corridor.highway === "prithvi") return "highway";
  if (corridor.highway === "kaligandaki") return "mountainroad";
  if (avgLat > 28.0) return "mountainroad";
  if (avgLat > 27.0) return "feederroad";
  return "valleyroad";
}

function inferSurfaceType(corridor: CorridorDefinition, avgLat: number): string {
  if (corridor.highway === "mahendra" || corridor.highway === "prithvi" || corridor.highway === "bp") return "PAVED";
  if (corridor.highway === "siddhartha") return avgLat > 28.0 ? "GRAVEL" : "PAVED";
  if (corridor.highway === "kaligandaki") return "GRAVEL";
  return "GRAVEL";
}

function inferRiskScores(roadType: string, avgLat: number): { landslideRisk: number; floodRisk: number; monsoonVulnerability: number } {
  let landslideRisk = 0.2;
  let floodRisk = 0.1;
  let monsoonVulnerability = 0.2;

  if (roadType === "mountainroad") {
    landslideRisk = 0.7;
    monsoonVulnerability = 0.7;
  } else if (roadType === "feederroad") {
    landslideRisk = 0.4;
    monsoonVulnerability = 0.5;
  }

  if (avgLat < 27.0) {
    floodRisk = 0.6;
  } else if (avgLat < 28.0) {
    floodRisk = 0.3;
    landslideRisk = Math.max(landslideRisk, 0.3);
  } else {
    floodRisk = 0.05;
    landslideRisk = Math.max(landslideRisk, 0.5);
  }

  return { landslideRisk, floodRisk, monsoonVulnerability };
}

function computeGradient(fromElev: number | undefined, toElev: number | undefined, distanceKm: number): number | null {
  if (fromElev == null || toElev == null || distanceKm <= 0) return null;
  return ((toElev - fromElev) / (distanceKm * 1000)) * 100;
}

async function seedCorridor(corridor: CorridorDefinition): Promise<{ nodesCreated: number; edgesCreated: number; nodesUpdated: number }> {
  console.log(`\n=== Seeding corridor: ${corridor.name} ===`);

  const nodes = corridor.nodes;
  let nodesCreated = 0;
  let nodesUpdated = 0;

  // Step 1: Upsert all nodes
  const nodeIds: string[] = [];
  for (const node of nodes) {
    const existing = await prisma.routeNode.findFirst({
      where: { name: node.name },
      select: { id: true },
    });
    if (existing) {
      nodesUpdated++;
      nodeIds.push(existing.id);
    } else {
      const id = await upsertNode(node, corridor.id);
      nodeIds.push(id);
      nodesCreated++;
    }
  }

  // Step 2: Create sequential edges along corridor
  let edgesCreated = 0;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const fromElev = nodes[i].elevationM;
    const toElev = nodes[i + 1].elevationM;
    const avgLat = (nodes[i].lat + nodes[i + 1].lat) / 2;

    const distance = haversineKm(nodes[i].lat, nodes[i].lon, nodes[i + 1].lat, nodes[i + 1].lon);
    const roadType = inferRoadType(corridor, nodes[i].lat, nodes[i + 1].lat);
    const surfaceType = inferSurfaceType(corridor, avgLat);
    const gradient = computeGradient(fromElev, toElev, distance);
    const { landslideRisk, floodRisk, monsoonVulnerability } = inferRiskScores(roadType, avgLat);

    const existingEdge = await prisma.routeEdge.findFirst({
      where: {
        OR: [
          { fromNodeId: nodeIds[i], toNodeId: nodeIds[i + 1] },
          { fromNodeId: nodeIds[i + 1], toNodeId: nodeIds[i] },
        ],
      },
    });

    if (!existingEdge) {
      await prisma.routeEdge.create({
        data: {
          fromNodeId: nodeIds[i],
          toNodeId: nodeIds[i + 1],
          distanceKm: distance,
          surfaceType: surfaceType as any,
          roadCondition: surfaceType === "PAVED" ? "GOOD" : surfaceType === "GRAVEL" ? "FAIR" : "POOR",
          travelReliability: monsoonVulnerability > 0.5 ? 0.6 : 0.85,
          gradientPct: gradient,
          landslideRisk,
          floodRisk,
          weatherSensitivity: monsoonVulnerability,
          reliabilityScore: 1 - monsoonVulnerability * 0.4,
          monsoonVulnerability,
          roadName: corridor.name,
          isBidirectional: true,
        },
      });
      edgesCreated++;
    }

    // If not bidirectional, create reverse edge too
    const reverseEdge = await prisma.routeEdge.findFirst({
      where: { fromNodeId: nodeIds[i + 1], toNodeId: nodeIds[i] },
    });
    if (!reverseEdge) {
      await prisma.routeEdge.create({
        data: {
          fromNodeId: nodeIds[i + 1],
          toNodeId: nodeIds[i],
          distanceKm: distance,
          surfaceType: surfaceType as any,
          roadCondition: surfaceType === "PAVED" ? "GOOD" : surfaceType === "GRAVEL" ? "FAIR" : "POOR",
          travelReliability: monsoonVulnerability > 0.5 ? 0.6 : 0.85,
          gradientPct: gradient != null ? -gradient : null,
          landslideRisk,
          floodRisk,
          weatherSensitivity: monsoonVulnerability,
          reliabilityScore: 1 - monsoonVulnerability * 0.4,
          monsoonVulnerability,
          roadName: corridor.name,
          isBidirectional: true,
        },
      });
      edgesCreated++;
    }
  }

  console.log(`  Nodes: ${nodesCreated} created, ${nodesUpdated} updated`);
  console.log(`  Edges: ${edgesCreated} created`);
  return { nodesCreated, edgesCreated, nodesUpdated };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

async function main() {
  console.log("Starting corridor seeding...\n");
  let totalCreated = 0;
  let totalEdges = 0;
  let totalUpdated = 0;

  for (const corridor of CORRIDORS) {
    const result = await seedCorridor(corridor);
    totalCreated += result.nodesCreated;
    totalEdges += result.edgesCreated;
    totalUpdated += result.nodesUpdated;
  }

  console.log(`\n=== Seeding complete ===`);
  console.log(`Total new nodes: ${totalCreated}`);
  console.log(`Total updated nodes: ${totalUpdated}`);
  console.log(`Total new edges: ${totalEdges}`);
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

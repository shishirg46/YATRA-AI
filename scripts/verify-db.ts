import { prisma } from "../lib/prisma";

async function verify() {
  try {
    const nodeCount = await prisma.routeNode.count();
    const edgeCount = await prisma.routeEdge.count();
    const auditCount = await prisma.auditLog.count();
    const userCount = await prisma.user.count();
    const destCount = await prisma.destination.count();

    console.log("--- DB verification ---");
    console.log("Route Nodes:", nodeCount);
    console.log("Route Edges:", edgeCount);
    console.log("Audit Logs:", auditCount);
    console.log("Users:", userCount);
    console.log("Destinations:", destCount);

    if (nodeCount > 0) {
      const sampleNodes = await prisma.routeNode.findMany({ take: 3 });
      console.log("Sample Nodes:", sampleNodes);
    }
    if (edgeCount > 0) {
      const sampleEdges = await prisma.routeEdge.findMany({ 
        take: 3, 
        include: { fromNode: true, toNode: true } 
      });
      console.log("Sample Edges:", sampleEdges);
    }
  } catch (err) {
    console.error("Verification failed:", err);
  }
}

verify();

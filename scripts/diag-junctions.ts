import { Pool } from "pg";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const url = new URL(process.env.DATABASE_URL!);
const pool = new Pool({ host: url.hostname, port: parseInt(url.port) || 5432, database: url.pathname.slice(1).split("?")[0], user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });

async function main() {
  const res = await pool.query(`
    SELECT n.id, COUNT(*) as deg
    FROM (
      SELECT n1.id as from_id, n2.id as to_node_id
      FROM osm_way w JOIN route_node n1 ON n1."osmWayId" = w.id JOIN route_node n2 ON n2."osmWayId" = w.id AND n2."sequenceIndex" = n1."sequenceIndex" + 1
      WHERE w."isActive" AND n1."isActive" AND n2."isActive"
      UNION ALL
      SELECT n2.id, n1.id
      FROM osm_way w JOIN route_node n1 ON n1."osmWayId" = w.id JOIN route_node n2 ON n2."osmWayId" = w.id AND n2."sequenceIndex" = n1."sequenceIndex" + 1
      WHERE w."isActive" AND n1."isActive" AND n2."isActive" AND NOT w."oneWay"
    ) e JOIN route_node n ON n.id = e.from_id
    GROUP BY n.id ORDER BY deg DESC LIMIT 5
  `);
  console.log("Top 5 degrees (without junctions):", JSON.stringify(res.rows, null, 2));

  const jc = await pool.query(`
    SELECT COUNT(*) as clusters, COUNT(*) FILTER (WHERE cnt >= 2) as multi, MAX(cnt) as max_cluster
    FROM (SELECT ROUND(latitude / 0.0001)::text || ',' || ROUND(longitude / 0.0001)::text as ck, COUNT(*) as cnt FROM route_node WHERE "isJunctionNode" AND "isActive" GROUP BY ck) sub
  `);
  console.log("Junction clusters:", JSON.stringify(jc.rows[0]));

  // Sample junctions with cluster mates
  const jrows = await pool.query(`SELECT id, latitude, longitude, "roadClass" FROM route_node WHERE "isJunctionNode" AND "isActive" LIMIT 5`);
  for (const row of jrows.rows) {
    const mates = await pool.query(
      `SELECT id, latitude, longitude, "roadClass" FROM route_node WHERE "isJunctionNode" AND "isActive" AND ABS(latitude - $1) < 0.0001 AND ABS(longitude - $2) < 0.0001`,
      [row.latitude, row.longitude]
    );
    console.log(`Junction ${row.id.slice(0,20)}... (${row.latitude}, ${row.longitude}): ${mates.rows.length} cluster mates`);
  }

  await pool.end();
}
main().catch(e => { console.error(e); pool.end(); });

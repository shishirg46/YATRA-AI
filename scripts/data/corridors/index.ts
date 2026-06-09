import eastWest from "./east-west-highway.json";
import prithvi from "./prithvi-highway.json";
import bp from "./bp-highway.json";
import siddhartha from "./siddhartha-highway.json";
import midHill from "./mid-hill-highway.json";
import kaligandaki from "./kaligandaki-corridor.json";

export interface CorridorNode {
  name: string;
  lat: number;
  lon: number;
  type: string;
  strategicImportance: string;
  isHub: boolean;
  elevationM?: number;
}

export interface CorridorDefinition {
  id: string;
  name: string;
  description: string;
  highway: string;
  vehicleAccess: string[];
  nodes: CorridorNode[];
}

export const CORRIDORS: CorridorDefinition[] = [
  eastWest as CorridorDefinition,
  prithvi as CorridorDefinition,
  bp as CorridorDefinition,
  siddhartha as CorridorDefinition,
  midHill as CorridorDefinition,
  kaligandaki as CorridorDefinition,
];

export const CORRIDOR_MAP = new Map<string, CorridorDefinition>(
  CORRIDORS.map((c) => [c.id, c])
);

export function getAllCorridorNodeNames(): Set<string> {
  const names = new Set<string>();
  for (const c of CORRIDORS) {
    for (const n of c.nodes) {
      names.add(n.name.toLowerCase());
    }
  }
  return names;
}

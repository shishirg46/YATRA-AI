const ROUTE_KEY_VERSION = "v1";

export type RouteGeometryInput = {
  originNodeId: string;
  destNodeId: string;
  vehicle?: string;
};

export function routeGeometryKey(input: RouteGeometryInput): string {
  return `${ROUTE_KEY_VERSION}|${input.originNodeId}|${input.destNodeId}|${input.vehicle ?? "default"}`;
}

export type RouteIntelligenceInput = RouteGeometryInput & {
  departureDate: string;
};

export function routeIntelligenceKey(input: RouteIntelligenceInput): string {
  return `${routeGeometryKey(input)}|${input.departureDate}`;
}

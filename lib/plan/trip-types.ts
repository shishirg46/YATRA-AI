export type VehicleType = "car" | "motorcycle" | "jeep";

export type TravelStyle = "budget" | "standard" | "luxury";

export type RoadClass = "highway" | "paved" | "unpaved" | "trail";

export const VEHICLES: Record<VehicleType, { label: string; description: string }> = {
  car: { label: "Car / Sedan", description: "Paved roads only" },
  motorcycle: { label: "Motorcycle / Scooter", description: "Flexible on narrow roads" },
  jeep: { label: "Jeep / 4x4 / SUV", description: "Off-road capable" },
};

export const VEHICLE_RATES: Record<VehicleType, number> = {
  car: 15,
  motorcycle: 10,
  jeep: 22,
};

export const ROAD_MULTIPLIER: Record<RoadClass, number> = {
  highway: 1.0,
  paved: 1.2,
  unpaved: 1.5,
  trail: 2.0,
};

export const TRAVEL_STYLES: Record<TravelStyle, { label: string; description: string }> = {
  budget: { label: "Budget", description: "Economical travel" },
  standard: { label: "Standard", description: "Comfortable mid-range" },
  luxury: { label: "Luxury", description: "Premium experience" },
};

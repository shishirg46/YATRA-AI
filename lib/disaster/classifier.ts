import { DisasterType, TYPE_PATTERNS } from "./types";

export function classifyType(item: any): DisasterType {
  const blob = [
    item?.event?.title,
    item?.event?.title_en,
    item?.event?.title_np,
    item?.hazard?.title,
    item?.hazard?.title_en,
    item?.hazard?.title_np,
    item?.incident_type?.title,
    item?.incident_type?.title_en,
    item?.incident_type?.title_np,
    item?.title,
    item?.description,
    item?.remarks,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
    if (patterns.some((p) => blob.includes(p))) return type as DisasterType;
  }
  return "other";
}

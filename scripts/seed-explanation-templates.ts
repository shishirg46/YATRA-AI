import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type TemplateInput = {
  templateGroup: string;
  condition: string;
  severity: string | null;
  audience: string;
  template: string;
  priority: number;
};

const TEMPLATES: TemplateInput[] = [
  // ── Weather ──
  {
    templateGroup: "weather",
    condition: "heavy_rainfall",
    severity: "EXTREME",
    audience: "TRAVELER",
    template: "{{destination}} ({{district}}) is experiencing extreme rainfall ({{rainfall}} mm). Heavy rain probability is {{heavyRainProbability}}%. Consider postponing non-essential travel.",
    priority: 90,
  },
  {
    templateGroup: "weather",
    condition: "heavy_rainfall",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Heavy rain expected in {{destination}} ({{district}}) — {{rainfall}} mm forecast. Landslide risk may be elevated along mountain roads.",
    priority: 80,
  },
  {
    templateGroup: "weather",
    condition: "heavy_rainfall",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Moderate rainfall ({{rainfall}} mm) expected in {{destination}} during {{season}}. Pack rain gear and allow extra travel time.",
    priority: 60,
  },
  {
    templateGroup: "weather",
    condition: "freezing_temperatures",
    severity: "EXTREME",
    audience: "TRAVELER",
    template: "Extreme cold in {{destination}}: minimum temperature of {{minTemp}}°C. Frostbite risk is significant. Ensure proper cold-weather gear.",
    priority: 90,
  },
  {
    templateGroup: "weather",
    condition: "freezing_temperatures",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Freezing temperatures expected in {{destination}} (low of {{avgTempMin}}°C). Ice on roads may make driving hazardous.",
    priority: 80,
  },
  {
    templateGroup: "weather",
    condition: "freezing_temperatures",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Chilly conditions in {{destination}} with temperatures dropping to {{avgTempMin}}°C. Pack warm layers.",
    priority: 60,
  },
  {
    templateGroup: "weather",
    condition: "high_winds",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Strong winds ({{avgWindSpeed}} m/s) expected in {{destination}}. This may affect motorcycle and high-profile vehicle stability.",
    priority: 80,
  },
  {
    templateGroup: "weather",
    condition: "high_winds",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Breezy conditions in {{destination}} with winds around {{avgWindSpeed}} m/s. Secure loose items if camping.",
    priority: 60,
  },
  {
    templateGroup: "weather",
    condition: "snowfall",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Significant snowfall ({{avgSnowfall}} cm) expected in {{destination}} (altitude {{altitude}}m). Roads may be blocked. Check pass conditions before traveling.",
    priority: 85,
  },
  {
    templateGroup: "weather",
    condition: "snowfall",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Snow possible in {{destination}} ({{snowProbability}}% chance, ~{{avgSnowfall}} cm). Higher passes may require chains.",
    priority: 65,
  },
  {
    templateGroup: "weather",
    condition: "snowfall",
    severity: "LOW",
    audience: "TRAVELER",
    template: "Light snow dusting possible in {{destination}}. Roads should remain passable, but check local updates.",
    priority: 40,
  },
  {
    templateGroup: "weather",
    condition: "active_rain",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Active rainfall ({{rainfall}} mm) reported in {{destination}} via {{source}}. Road conditions may deteriorate quickly.",
    priority: 80,
  },
  {
    templateGroup: "weather",
    condition: "forecast_heavy_rain",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "{{days}} day(s) of heavy rain forecast during your stay in {{destination}} ({{dates}}). Plan indoor alternatives.",
    priority: 65,
  },

  // ── Route ──
  {
    templateGroup: "route",
    condition: "route_risk",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Route risk is {{risk}}: {{reason}}. Consider alternative routing or extra precautions.",
    priority: 85,
  },
  {
    templateGroup: "route",
    condition: "route_risk",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Route condition: {{risk}} — {{reason}}. Drive with caution.",
    priority: 65,
  },
  {
    templateGroup: "route",
    condition: "disaster_route_risk",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Disaster risk along route: {{riskLevel}}. Reasons: {{reasons}}. Consider an alternative safer corridor.",
    priority: 85,
  },
  {
    templateGroup: "route",
    condition: "disaster_route_risk",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Moderate disaster risk ({{riskLevel}}) on this route: {{reasons}}. Stay informed of local conditions.",
    priority: 65,
  },
  {
    templateGroup: "route",
    condition: "route_assessment",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Overall route assessment: {{overall}}. Road conditions: {{roadConditions}}. Seasonal corridor risk: {{seasonalCorridorRisk}}.",
    priority: 80,
  },
  {
    templateGroup: "route",
    condition: "route_assessment",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Route assessment: {{overall}}. Road conditions: {{roadConditions}}.",
    priority: 60,
  },
  {
    templateGroup: "route",
    condition: "route_blocked",
    severity: "EXTREME",
    audience: "EMERGENCY",
    template: "ROUTE BLOCKED at {{where}}: {{what}}. Effect: {{effect}}. Seek immediate alternative routing.",
    priority: 100,
  },
  {
    templateGroup: "route",
    condition: "route_advisory",
    severity: "HIGH",
    audience: "PROFESSIONAL",
    template: "Route advisory at {{where}}: {{what}}. Effect: {{effect}}. Professional drivers should exercise caution.",
    priority: 80,
  },
  {
    templateGroup: "route",
    condition: "segment_risk",
    severity: "EXTREME",
    audience: "TRAVELER",
    template: "High-risk segment: {{from}} to {{to}} (risk: {{riskLevel}}, score: {{riskScore}}). Hazards: {{hazards}}. Consider an alternate route around this segment.",
    priority: 90,
  },
  {
    templateGroup: "route",
    condition: "segment_risk",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Segment {{from}} → {{to}} has elevated risk ({{riskLevel}}). Hazards: {{hazards}}. Drive carefully through this section.",
    priority: 75,
  },

  // ── Health ──
  {
    templateGroup: "health",
    condition: "health_advisory",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "Health advisory for {{destination}}: {{advisory}}. Condition: {{condition}} (risk: {{risk}}). Take necessary precautions.",
    priority: 85,
  },
  {
    templateGroup: "health",
    condition: "health_advisory",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Health note for {{destination}}: {{advisory}}. Pack any required medications.",
    priority: 60,
  },
  {
    templateGroup: "health",
    condition: "vulnerable_member_health",
    severity: "HIGH",
    audience: "PROFESSIONAL",
    template: "{{member}} has health considerations for {{destination}}: {{conditions}} ({{count}} risk(s)). Ensure medical supplies and emergency contacts are ready.",
    priority: 85,
  },
  {
    templateGroup: "health",
    condition: "altitude_risk_member",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "{{member}} may experience altitude effects at {{destination}}: {{condition}}. Plan gradual ascent and monitor symptoms.",
    priority: 70,
  },
  {
    templateGroup: "health",
    condition: "high_altitude",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "{{destination}} is at {{altitude}}m — above 4000m. Risk of altitude sickness. Plan acclimatization days and carry diamox.",
    priority: 85,
  },
  {
    templateGroup: "health",
    condition: "high_altitude",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "{{destination}} sits at {{altitude}}m. Some travelers may experience mild altitude effects. Stay hydrated and ascend gradually.",
    priority: 65,
  },

  // ── Budget ──
  {
    templateGroup: "budget",
    condition: "budget_overrun",
    severity: "HIGH",
    audience: "PROFESSIONAL",
    template: "Budget overrun in {{destination}}: estimated cost NPR {{estimated}} exceeds specified budget NPR {{budget}} by NPR {{shortfall}}. Adjust itinerary or increase budget.",
    priority: 90,
  },
  {
    templateGroup: "budget",
    condition: "budget_tight",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Budget running tight for {{destination}}: NPR {{remaining}} remaining ({{remainingPercent}}% of NPR {{budget}}). Look for cost-saving opportunities.",
    priority: 70,
  },
  {
    templateGroup: "budget",
    condition: "budget_sufficient",
    severity: "LOW",
    audience: "TRAVELER",
    template: "Budget looks comfortable for {{destination}}: NPR {{remaining}} remaining ({{remainingPercent}}% of NPR {{budget}}). You have flexibility for extras.",
    priority: 40,
  },

  // ── Seasonal ──
  {
    templateGroup: "seasonal",
    condition: "monsoon_active",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "{{destination}} is in monsoon season during {{month}}. Expect rain, possible landslides, and road delays. Carry waterproof gear and check road conditions daily.",
    priority: 70,
  },
  {
    templateGroup: "seasonal",
    condition: "winter_season",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "{{destination}} is in winter conditions during {{month}}. Cold weather and possible snow can affect higher elevations. Pack warm clothing and check passes for closures.",
    priority: 65,
  },
  {
    templateGroup: "seasonal",
    condition: "peak_travel_season",
    severity: "LOW",
    audience: "TRAVELER",
    template: "{{destination}} is in peak travel season during {{month}}. Book accommodations in advance and expect popular sites to be busy.",
    priority: 40,
  },
  {
    templateGroup: "seasonal",
    condition: "seasonal_penalty",
    severity: "HIGH",
    audience: "PROFESSIONAL",
    template: "Seasonal modifier of {{modifier}}% for {{destination}}. Contributing factors: {{factors}}. Professional planning recommended.",
    priority: 80,
  },
  {
    templateGroup: "seasonal",
    condition: "seasonal_penalty",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "Seasonal conditions add {{modifier}}% difficulty for {{destination}}. Factors: {{factors}}. Plan accordingly.",
    priority: 60,
  },
  {
    templateGroup: "seasonal",
    condition: "seasonal_penalty",
    severity: "LOW",
    audience: "TRAVELER",
    template: "Slight seasonal modifier ({{modifier}}%) for {{destination}}. Minor adjustments may be helpful.",
    priority: 40,
  },

  // ── Destination ──
  {
    templateGroup: "destination",
    condition: "destination_high_risk",
    severity: "EXTREME",
    audience: "TRAVELER",
    template: "{{destination}} ({{district}}, {{province}}) has an extreme safety score of {{score}}/100. Level: {{level}}. Strongly consider choosing an alternative destination.",
    priority: 95,
  },
  {
    templateGroup: "destination",
    condition: "destination_high_risk",
    severity: "HIGH",
    audience: "TRAVELER",
    template: "{{destination}} ({{district}}, {{province}}) shows elevated risk (score: {{score}}/100, level: {{level}}). Exercise caution and prepare contingency plans.",
    priority: 80,
  },
  {
    templateGroup: "destination",
    condition: "destination_low_accessibility",
    severity: "MEDIUM",
    audience: "TRAVELER",
    template: "{{destination}} has a low accessibility score ({{accessibilityScore}}/100). Infrastructure may be limited. Plan for basic conditions.",
    priority: 60,
  },
  {
    templateGroup: "destination",
    condition: "destination_low_accessibility",
    severity: "LOW",
    audience: "TRAVELER",
    template: "{{destination}} accessibility score: {{accessibilityScore}}/100. Some facilities may be basic.",
    priority: 40,
  },

  // ── Group ──
  {
    templateGroup: "group",
    condition: "mixed_fitness_group",
    severity: "MEDIUM",
    audience: "PROFESSIONAL",
    template: "Mixed fitness group: {{count}} members with {{lowCount}} low-fitness and {{highCount}} high-fitness individuals. Plan activities that accommodate all levels.",
    priority: 70,
  },
  {
    templateGroup: "group",
    condition: "vulnerable_member_in_group",
    severity: "HIGH",
    audience: "PROFESSIONAL",
    template: "{{member}} has health vulnerabilities: {{risks}}. Ensure the group plan accommodates their needs and emergency protocols are in place.",
    priority: 85,
  },
  {
    templateGroup: "group",
    condition: "group_avg_diverges",
    severity: "MEDIUM",
    audience: "PROFESSIONAL",
    template: "Group average score ({{groupScore}}) diverges from overall score ({{overallScore}}) by {{gap}} points. Some members may have different risk profiles than the group as a whole.",
    priority: 60,
  },
  {
    templateGroup: "group",
    condition: "group_conflict",
    severity: "MEDIUM",
    audience: "PROFESSIONAL",
    template: "Potential group conflict detected for {{destination}}. Consider facilitating a group discussion to align expectations before departure.",
    priority: 70,
  },

  // ── Summary ──
  {
    templateGroup: "summary",
    condition: "summary_favorable",
    severity: null,
    audience: "TRAVELER",
    template: "{{destination}}: Conditions appear favorable for travel.",
    priority: 50,
  },
  {
    templateGroup: "summary",
    condition: "summary_caution",
    severity: null,
    audience: "TRAVELER",
    template: "{{destination}}: Exercise caution — conditions require preparation.",
    priority: 50,
  },
  {
    templateGroup: "summary",
    condition: "summary_avoid",
    severity: null,
    audience: "TRAVELER",
    template: "{{destination}}: Conditions are not favorable. Consider postponing or choosing an alternative.",
    priority: 50,
  },

  // ── Recommendation ──
  {
    templateGroup: "recommendation",
    condition: "recommendation_safer_alternative",
    severity: null,
    audience: "TRAVELER",
    template: "Consider {{altName}} ({{altDistrict}}) as a safer alternative (score: {{altScore}}/100).",
    priority: 80,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_pack_gear",
    severity: null,
    audience: "TRAVELER",
    template: "Pack appropriate gear for {{destination}}: {{gearList}}.",
    priority: 60,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_check_roads",
    severity: null,
    audience: "TRAVELER",
    template: "Check road conditions before traveling to {{destination}}, especially if driving.",
    priority: 50,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_water_safety",
    severity: null,
    audience: "TRAVELER",
    template: "Carry water purification tablets or filter. Avoid tap water and uncooked foods at {{destination}}.",
    priority: 70,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_vaccinations",
    severity: null,
    audience: "TRAVELER",
    template: "Ensure Typhoid, Hepatitis A vaccinations are current before travel to {{destination}}.",
    priority: 70,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_solo_trek_registration",
    severity: null,
    audience: "TRAVELER",
    template: "Register your trek to {{destination}} with Nepal Tourism Board. Share your itinerary with an emergency contact.",
    priority: 80,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_malaria_prevention",
    severity: null,
    audience: "TRAVELER",
    template: "Consider antimalarials for travel to {{district}}. Use DEET repellent. Cover skin at dusk.",
    priority: 70,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_air_quality",
    severity: null,
    audience: "TRAVELER",
    template: "Carry N95 masks for {{destination}}. Check real-time AQI at aqi.in before outdoor activity.",
    priority: 60,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_solo_first_aid",
    severity: null,
    audience: "TRAVELER",
    template: "Carry a first-aid kit on the route to {{destination}} and share live location check-ins every 4-6 hours with an emergency contact.",
    priority: 70,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_road_closure_alerts",
    severity: null,
    audience: "TRAVELER",
    template: "Check for road blockages en route to {{destination}}. Carry emergency contacts for DoR (Department of Roads) for {{district}}.",
    priority: 65,
  },
  {
    templateGroup: "recommendation",
    condition: "recommendation_high_altitude_diamox",
    severity: null,
    audience: "TRAVELER",
    template: "Consult a doctor about Diamox (acetazolamide) before travelling to {{destination}} at {{altitude}}m.",
    priority: 80,
  },

  // ── Intro ──
  {
    templateGroup: "intro",
    condition: "intro_trip_summary",
    severity: null,
    audience: "TRAVELER",
    template: "Trip to {{destination}} starting {{date}}. Trip type: {{tripType}}. Here's your full analysis.",
    priority: 50,
  },

  // ── Top Tip ──
  {
    templateGroup: "top_tip",
    condition: "top_tip_default",
    severity: null,
    audience: "TRAVELER",
    template: "{{tip}}",
    priority: 50,
  },

  // ── Evidence ──
  {
    templateGroup: "evidence",
    condition: "evidence_weather_source",
    severity: null,
    audience: "TRAVELER",
    template: "Weather data sourced from {{source}} on {{date}}. Value: {{value}}.",
    priority: 30,
  },
  {
    templateGroup: "evidence",
    condition: "evidence_historical_data",
    severity: null,
    audience: "TRAVELER",
    template: "Historical hazard data from {{source}} ({{date}}): {{value}}.",
    priority: 30,
  },
];

async function main() {
  console.log(`Seeding ${TEMPLATES.length} explanation templates...`);

  for (const tpl of TEMPLATES) {
    await prisma.explanationTemplate.create({
      data: {
        templateGroup: tpl.templateGroup,
        condition: tpl.condition,
        severity: tpl.severity as any,
        audience: tpl.audience as any,
        template: tpl.template,
        priority: tpl.priority,
        variant: 1,
        templateVersion: 1,
        enabled: true,
      },
    });
  }

  console.log(`Done: ${TEMPLATES.length} templates seeded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

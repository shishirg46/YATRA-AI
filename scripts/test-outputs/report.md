# Route Formatter Test Report
Generated: 2026-07-06T18:23:16.272Z

## low-risk
*Short intra-district route, low risk, no hazards*

**Overall risk:** LOW | **Segments:** 2

### riskExplanation
```
Overall route risk: LOW. The Kathmandu → Bhaktapur corridor (15 km, ~0.8h) has 2 segments requiring extra caution. Highest-risk: Kathmandu → Thimi — Risk 25 (LOW).. Kathmandu → Thimi — Risk 25 (LOW). Thimi → Bhaktapur — Risk 20 (LOW).
```

### routeAdvice
```
Route status: LOW
Corridor: Kathmandu → Bhaktapur (15 km, ~0.8h)

Segments:
  Kathmandu → Thimi — Risk 25 (LOW).
  Thimi → Bhaktapur — Risk 20 (LOW).
```

### Merged
```
Overall route risk: LOW. The Kathmandu → Bhaktapur corridor (15 km, ~0.8h) has 2 segments requiring extra caution. Highest-risk: Kathmandu → Thimi — Risk 25 (LOW).. Kathmandu → Thimi — Risk 25 (LOW). Thimi → Bhaktapur — Risk 20 (LOW). Minor altitude adjustment needed for some travellers.
```

### Checks
- ✅ No '0 segments' in output
- ✅ No undefined/null in output
- ✅ Length ≤ 600 (actual: 234) (234 chars)
- ✅ No repeated category in summary section
- ✅ Worst segment mentioned: Kathmandu → Thimi (score 25) (Kathmandu → Thimi)
- ✅ No sentence exceeds 180 chars (longest: 47)
- ✅ Corridor names not empty
- ✅ Merge includes formatter output
- ✅ routeAdvice has content (149 chars)

## medium-risk
*Inter-district hilly route with some hazards*

**Overall risk:** MEDIUM | **Segments:** 2

### riskExplanation
```
Overall route risk: MEDIUM. The Kathmandu → Pokhara corridor (200 km, ~6h) has 2 segments requiring extra caution. Highest-risk: Mugling → Pokhara — Risk 50 (MEDIUM). Landslide risk detected.. Kathmandu → Mugling — Risk 45 (MEDIUM). Landslide risk detected. Mugling → Pokhara — Risk 50 (MEDIUM). Landslide risk detected.
```

### routeAdvice
```
Route status: MEDIUM
Corridor: Kathmandu → Pokhara (200 km, ~6h)

Segments:
  Kathmandu → Mugling — Risk 45 (MEDIUM). Landslide risk detected.
  Mugling → Pokhara — Risk 50 (MEDIUM). Landslide risk detected.
```

### Merged
```
Overall route risk: MEDIUM. The Kathmandu → Pokhara corridor (200 km, ~6h) has 2 segments requiring extra caution. Highest-risk: Mugling → Pokhara — Risk 50 (MEDIUM). Landslide risk detected.. Kathmandu → Mugling — Risk 45 (MEDIUM). Landslide risk detected. Mugling → Pokhara — Risk 50 (MEDIUM). Landslide risk detected. Heavy rain expected during travel hours. Moderate fitness level required for altitude changes.
```

### Checks
- ✅ No '0 segments' in output
- ✅ No undefined/null in output
- ✅ Length ≤ 600 (actual: 320) (320 chars)
- ✅ No repeated category in summary section
- ✅ Worst segment mentioned: Mugling → Pokhara (score 50) (Mugling → Pokhara)
- ✅ No sentence exceeds 180 chars (longest: 85)
- ✅ Corridor names not empty
- ✅ Merge includes formatter output
- ✅ routeAdvice has content (207 chars)

## high-monsoon
*Terai flood-prone route during monsoon*

**Overall risk:** HIGH | **Segments:** 2

### riskExplanation
```
Overall route risk: HIGH. The Biratnagar → Janakpur corridor (180 km, ~4.5h) has 2 segments requiring extra caution. Highest-risk: Lahan → Janakpur — Risk 75 (HIGH). Flood risk detected. Rainfall affecting travel conditions.. Biratnagar → Lahan — Risk 70 (HIGH). Flood risk: elevated (multiple sources). Lahan → Janakpur — Risk 75 (HIGH). Flood risk detected. Rainfall affecting travel conditions.
```

### routeAdvice
```
Route status: HIGH
Corridor: Biratnagar → Janakpur (180 km, ~4.5h)

Segments:
  Biratnagar → Lahan — Risk 70 (HIGH). Flood risk: elevated (multiple sources).
  Lahan → Janakpur — Risk 75 (HIGH). Flood risk detected. Rainfall affecting travel conditions.

Recommendation: Consider alternative routing or extra precautions.
```

### Merged
```
Overall route risk: HIGH. The Biratnagar → Janakpur corridor (180 km, ~4.5h) has 2 segments requiring extra caution. Highest-risk: Lahan → Janakpur — Risk 75 (HIGH). Flood risk detected. Rainfall affecting travel conditions.. Biratnagar → Lahan — Risk 70 (HIGH). Flood risk: elevated (multiple sources). Lahan → Janakpur — Risk 75 (HIGH). Flood risk detected. Rainfall affecting travel conditions. Monsoon storm warning in effect for the region.
```

### Checks
- ✅ No '0 segments' in output
- ✅ No undefined/null in output
- ✅ Length ≤ 600 (actual: 397) (397 chars)
- ✅ No repeated category in summary section
- ✅ Recommendation present on HIGH/EXTREME
- ✅ Worst segment mentioned: Lahan → Janakpur (score 75) (Lahan → Janakpur)
- ✅ No sentence exceeds 180 chars (longest: 47)
- ✅ Corridor names not empty
- ✅ Merge includes formatter output
- ✅ routeAdvice has content (321 chars)

## multiple-hazards
*Hill to Terai crossing with flood + landslide + weather*

**Overall risk:** HIGH | **Segments:** 2

### riskExplanation
```
Overall route risk: HIGH. The Pokhara → Butwal corridor (280 km, ~7h) has 2 segments requiring extra caution. Highest-risk: Syangja → Butwal — Risk 72 (HIGH). Flood risk detected. Rainfall affecting travel conditions. Seismic activity recorded in the region.. Pokhara → Syangja — Risk 55 (MEDIUM). Landslide risk detected. Rainfall affecting travel conditions. Syangja → Butwal — Risk 72 (HIGH). Flood risk detected. Rainfall affecting travel conditions. Seismic activity recorded in the region.
```

### routeAdvice
```
Route status: HIGH
Corridor: Pokhara → Butwal (280 km, ~7h)

Segments:
  Pokhara → Syangja — Risk 55 (MEDIUM). Landslide risk detected. Rainfall affecting travel conditions.
  Syangja → Butwal — Risk 72 (HIGH). Flood risk detected. Rainfall affecting travel conditions. Seismic activity recorded in the region.

Recommendation: Consider alternative routing or extra precautions.
```

### Merged
```
Overall route risk: HIGH. The Pokhara → Butwal corridor (280 km, ~7h) has 2 segments requiring extra caution. Highest-risk: Syangja → Butwal — Risk 72 (HIGH). Flood risk detected. Rainfall affecting travel conditions. Seismic activity recorded in the region.. Pokhara → Syangja — Risk 55 (MEDIUM). Landslide risk detected. Rainfall affecting travel conditions. Syangja → Butwal — Risk 72 (HIGH). Flood risk detected. Rainfall affecting travel conditions. Seismic activity recorded in the region. Fuel costs may be higher due to detour.
```

### Checks
- ✅ No '0 segments' in output
- ✅ No undefined/null in output
- ✅ Length ≤ 600 (actual: 495) (495 chars)
- ✅ No repeated category in summary section
- ✅ Recommendation present on HIGH/EXTREME
- ✅ Worst segment mentioned: Syangja → Butwal (score 72) (Syangja → Butwal)
- ✅ No sentence exceeds 180 chars (longest: 82)
- ✅ Corridor names not empty
- ✅ Merge includes formatter output
- ✅ routeAdvice has content (378 chars)

## no-segment-details
*Very short local trip where segmentation didn't produce details*

**Overall risk:** MEDIUM | **Segments:** 0

### riskExplanation
```
Overall route risk: MEDIUM. The Kathmandu → Kathmandu corridor (5 km, ~0.25 hours) could not be assessed at the segment level. Travel conditions may still change due to weather, road conditions, and local hazards.
```

### routeAdvice
```
Route assessment: MEDIUM

Corridor: Kathmandu → Kathmandu
Distance: 5 km (~0.25 hours)

Detailed segment analysis is unavailable for this route.
Monitor weather forecasts and local road conditions before departure.
```

### Merged
```
Overall route risk: MEDIUM. The Kathmandu → Kathmandu corridor (5 km, ~0.25 hours) could not be assessed at the segment level. Travel conditions may still change due to weather, road conditions, and local hazards. No significant altitude concerns for this route.
```

### Checks
- ✅ No '0 segments' in output
- ✅ No undefined/null in output
- ✅ Length ≤ 600 (actual: 213) (213 chars)
- ✅ No repeated category in summary section
- ✅ No sentence exceeds 180 chars (longest: 85)
- ✅ Corridor names not empty
- ✅ Merge includes formatter output
- ✅ routeAdvice has content (214 chars)

## no-route-intelligence
*Route exists but no intelligence (outside Nepal or routing unavailable)*

**Overall risk:** MEDIUM | **Segments:** 0

### riskExplanation
```
Overall route risk: MEDIUM. The Origin → Destination corridor (0 km, ~0 hours) could not be assessed at the segment level. Travel conditions may still change due to weather, road conditions, and local hazards.
```

### routeAdvice
```
Route assessment: MEDIUM

Corridor: Origin → Destination
Distance: 0 km (~0 hours)

Detailed segment analysis is unavailable for this route.
Monitor weather forecasts and local road conditions before departure.
```

### Merged
```
Overall route risk: MEDIUM. The Origin → Destination corridor (0 km, ~0 hours) could not be assessed at the segment level. Travel conditions may still change due to weather, road conditions, and local hazards. Standard safety precautions recommended.
```

### Checks
- ✅ No '0 segments' in output
- ✅ No undefined/null in output
- ✅ Length ≤ 600 (actual: 209) (209 chars)
- ✅ No repeated category in summary section
- ✅ No sentence exceeds 180 chars (longest: 93)
- ✅ Corridor names not empty
- ✅ Merge includes formatter output
- ✅ routeAdvice has content (210 chars)

---
**Overall: ALL PASSED ✅**
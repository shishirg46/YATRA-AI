/**
 * Shared query filter to exclude BIPAD earthquake records from analytical queries.
 *
 * BIPAD earthquake records represent human/economic impact data, not canonical
 * seismic events. USGS is the authoritative source for earthquake events.
 * This filter prevents double-counting without mutating historical data.
 */
export const EXCLUDE_BIPAD_EARTHQUAKE =
  `NOT (source = 'bipad' AND type = 'earthquake')`;

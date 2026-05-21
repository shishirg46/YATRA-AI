/**
 * FILE: weather.ts
 * LOCATION: /lib/collectors/weather.ts
 * PURPOSE: Re-exports DHM weather API implementation
 * 
 * Uses Nepal's DHM API (https://dhm.gov.np/mfd/api/forecast)
 * Removed: Open-Meteo, WeatherAPI, OpenWeatherMap, BIPAD APIs
 * New: Streamlined DHM-only implementation
 */

export * from "./weather-dhm";

// Weather for outfits: the owner's town and temperature unit (kept on this
// device), and the forecast from Open-Meteo (free, no account; only the town's
// map position is sent).

const WEATHER_KEY = "wardrobe-weather";

function loadWeatherSettings() {
  try {
    return JSON.parse(localStorage.getItem(WEATHER_KEY)) || null;
  } catch {
    return null; // storage unavailable: weather is simply off
  }
}

function saveWeatherSettings(settings) {
  try {
    if (settings) localStorage.setItem(WEATHER_KEY, JSON.stringify(settings));
    else localStorage.removeItem(WEATHER_KEY);
  } catch {
    // storage unavailable
  }
}

// Most people using °F are in the US; everyone else gets °C unless they change it.
const defaultUnit = () => (/-US$/i.test(navigator.language || "") ? "F" : "C");

async function searchPlaces(query) {
  const url = "https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=" + encodeURIComponent(query);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't look up that town. Try again in a moment.");
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
    lat: r.latitude, lon: r.longitude,
  }));
}

// Two days of forecast (today, tomorrow), remembered for 30 minutes.
let forecastCache = null;
async function getForecast(place) {
  const key = `${place.lat},${place.lon}`;
  if (forecastCache && forecastCache.key === key && Date.now() - forecastCache.at < 30 * 60 * 1000) return forecastCache.days;
  const url = "https://api.open-meteo.com/v1/forecast?daily=apparent_temperature_max,apparent_temperature_min," +
    `precipitation_probability_max,weather_code&timezone=auto&forecast_days=2&latitude=${place.lat}&longitude=${place.lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't get the weather forecast right now.");
  const d = (await res.json()).daily;
  const days = d.time.map((date, i) => ({
    date,
    feelsMaxC: d.apparent_temperature_max[i],
    feelsMinC: d.apparent_temperature_min[i],
    rainChance: d.precipitation_probability_max[i] || 0,
    code: d.weather_code[i],
  }));
  forecastCache = { key, at: Date.now(), days };
  return days;
}

// What kind of day it is for clothes. Uses the "feels like" temperature
// halfway between the day's low and high (in °C).
//   warm: 21 °C / 70 °F or more → no cold-weather pieces, coats optional
//   cold: 10 °C / 50 °F or less → no warm-weather pieces, a coat if you have one
//   mild: anything in between
function weatherKind(day) {
  const mid = (day.feelsMaxC + day.feelsMinC) / 2;
  return {
    kind: mid >= 21 ? "warm" : mid <= 10 ? "cold" : "mild",
    rainy: day.rainChance >= 50 || [61, 63, 65, 80, 81, 82, 95, 96, 99].includes(day.code),
    snowy: [71, 73, 75, 77, 85, 86].includes(day.code),
  };
}

const SKY = (code) =>
  code === 0 ? "clear" : code <= 2 ? "partly cloudy" : code === 3 ? "cloudy" : code <= 48 ? "foggy" :
  code <= 57 ? "drizzle" : code <= 67 ? "rain" : code <= 77 ? "snow" : code <= 82 ? "showers" :
  code <= 86 ? "snow showers" : "thunderstorms";

const toUnit = (c, unit) => Math.round(unit === "F" ? c * 9 / 5 + 32 : c);

function describeDay(day, place, unit, whenLabel) {
  const w = weatherKind(day);
  const range = `${toUnit(day.feelsMinC, unit)}–${toUnit(day.feelsMaxC, unit)}°${unit}`;
  const kind = { warm: "warm-weather", cold: "cold-weather", mild: "mild-weather" }[w.kind];
  const extra = w.snowy ? " Snow expected." : w.rainy ? ` Rain likely (${day.rainChance}%): no open sandals.` : "";
  const where = place.name === "your location" ? "near you" : "in " + place.name.split(",")[0];
  return `${whenLabel} ${where}: ${SKY(day.code)}, feels like ${range}. Showing ${kind} outfits.${extra}`;
}

// Up to 16 days of forecast, by date ("2026-10-25" → day), for planning trips.
// Dates further ahead aren't in it yet. Remembered for 30 minutes per place.
const longForecasts = new Map();
async function getLongForecast(place) {
  const key = `${place.lat},${place.lon}`;
  const hit = longForecasts.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.byDate;
  const url = "https://api.open-meteo.com/v1/forecast?daily=apparent_temperature_max,apparent_temperature_min," +
    `precipitation_probability_max,weather_code&timezone=auto&forecast_days=16&latitude=${place.lat}&longitude=${place.lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't get the weather forecast right now.");
  const d = (await res.json()).daily;
  const byDate = new Map(d.time.map((date, i) => [date, {
    date,
    feelsMaxC: d.apparent_temperature_max[i],
    feelsMinC: d.apparent_temperature_min[i],
    rainChance: d.precipitation_probability_max[i] || 0,
    code: d.weather_code[i],
  }]));
  longForecasts.set(key, { at: Date.now(), byDate });
  return byDate;
}

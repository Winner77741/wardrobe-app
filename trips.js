// Trips: plan an outfit for every day and event of a trip, reusing pieces so
// the suitcase stays small, and tick off a packing checklist.
// Uses helpers from app.js, outfits.js and weather.js.

let trips = [];
let trip = null;        // the trip being edited or viewed
let tripPlans = [];     // [{ day, occasion, outfit, ignoredWeather }] for the open trip
let tripWeather = [];   // per day: { w, note }

const TYPE_ORDER = ["dress", "top", "layer", "bottom", "outerwear", "shoes", "bag", "accessory"];
const TYPE_TITLES = {
  dress: "Dresses", top: "Tops", layer: "Layers", bottom: "Bottoms", outerwear: "Coats & jackets",
  shoes: "Shoes", bag: "Bags", accessory: "Accessories",
};

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tripDate = (t, day) => {
  const [y, m, d] = t.startDate.split("-").map(Number);
  return new Date(y, m - 1, d + day - 1);
};
const shortDate = (date) => date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function showTripPanel(name) {
  for (const id of ["trip-list-panel", "trip-edit-panel", "trip-plan-panel"]) $("#" + id).hidden = id !== name;
  window.scrollTo(0, 0);
}

// ---------- List ----------
async function renderTrips() {
  try {
    trips = await api("/api/trips");
  } catch (err) {
    return showError(err);
  }
  showTripPanel("trip-list-panel");
  $("#trip-list").innerHTML = !trips.length
    ? `<p class="muted">No trips yet. Plan one and the app picks an outfit for every day, reusing pieces so you pack less.</p>`
    : trips.slice().reverse().map((t) => {
      const pieces = new Set(t.outfits.flatMap((o) => o.itemIds)).size;
      const packed = t.packed.filter((id) => t.outfits.some((o) => o.itemIds.includes(id))).length;
      return `<div class="card trip-card">
        <div><strong>${esc(t.name)}</strong>
          <span class="muted">${shortDate(tripDate(t, 1))} · ${t.days} day${t.days === 1 ? "" : "s"}${t.place ? " · " + esc(t.place.name.split(",")[0]) : ""}</span>
          <span class="muted">${pieces ? `${packed} of ${pieces} pieces packed` : "Not planned yet"}</span>
        </div>
        <div class="trip-card-buttons">
          <button class="primary" data-open-trip="${esc(t.id)}">Open</button>
          <button class="link danger" data-del-trip="${esc(t.id)}">Delete</button>
        </div>
      </div>`;
    }).join("");
}

$("#trip-list").addEventListener("click", async (e) => {
  const { openTrip, delTrip } = e.target.dataset;
  if (openTrip) return openTripPlan(trips.find((t) => t.id === openTrip));
  if (delTrip && confirm("Delete this trip and its packing list? Your clothes stay in your closet.")) {
    try {
      await api("/api/trips/" + delTrip, { method: "DELETE" });
      renderTrips();
    } catch (err) {
      showError(err);
    }
  }
});

// ---------- New / edit ----------
const occasionOptions = (selected) => Object.entries(OCCASIONS)
  .map(([k, o]) => `<option value="${k}"${k === selected ? " selected" : ""}>${o.label}</option>`).join("");

function openTripEditor(t) {
  const home = loadWeatherSettings();
  trip = t ? JSON.parse(JSON.stringify(t)) : {
    name: "", place: home && home.place ? home.place : null, startDate: isoDay(new Date(Date.now() + 86400000)),
    days: 3, weather: "auto", events: [1, 2, 3].map((day) => ({ day, occasion: "casual" })), outfits: [], packed: [],
  };
  const f = $("#trip-form");
  f.elements.name.value = trip.name;
  f.elements.startDate.value = trip.startDate;
  f.elements.days.value = trip.days;
  f.elements.weather.value = trip.weather;
  $("#trip-place").textContent = trip.place ? trip.place.name : "Not set (needed for the forecast)";
  $("#trip-place-results").innerHTML = "";
  $("#trip-edit-title").textContent = t ? "Edit trip" : "New trip";
  $("#trip-event-occasion").innerHTML = occasionOptions("dinner");
  renderTripEvents();
  showTripPanel("trip-edit-panel");
}

// Keep one everyday outfit per day; changing the number of days adds or drops days.
function setTripDays(days) {
  days = Math.min(21, Math.max(1, days || 1));
  trip.events = trip.events.filter((e) => e.day <= days);
  for (let d = trip.days + 1; d <= days; d++) trip.events.push({ day: d, occasion: "casual" });
  trip.days = days;
  renderTripEvents();
}

function renderTripEvents() {
  trip.events.sort((a, b) => a.day - b.day);
  $("#trip-event-day").innerHTML = Array.from({ length: trip.days }, (_, i) => `<option value="${i + 1}">Day ${i + 1}</option>`).join("");
  $("#trip-events").innerHTML = trip.events.map((e, i) => `
    <li><span>Day ${e.day} · ${esc(OCCASIONS[e.occasion] ? OCCASIONS[e.occasion].label : e.occasion)}</span>
      <button type="button" class="link danger" data-del-event="${i}" title="Remove">✕</button></li>`).join("")
    || `<li class="muted">No outfits needed yet. Add one below.</li>`;
}

$("#trip-form").elements.days.addEventListener("change", (e) => setTripDays(parseInt(e.target.value, 10)));
$("#trip-events").addEventListener("click", (e) => {
  const i = e.target.dataset.delEvent;
  if (i !== undefined) { trip.events.splice(Number(i), 1); renderTripEvents(); }
});
$("#trip-add-event").addEventListener("click", () => {
  trip.events.push({ day: Number($("#trip-event-day").value), occasion: $("#trip-event-occasion").value });
  renderTripEvents();
});

let tripPlaceChoices = [];
$("#trip-place-find").addEventListener("click", async () => {
  const q = $("#trip-form").elements.placeQuery.value.trim();
  if (!q) return;
  try {
    tripPlaceChoices = await searchPlaces(q);
    $("#trip-place-results").innerHTML = tripPlaceChoices.length
      ? tripPlaceChoices.map((p, i) => `<button type="button" data-trip-place="${i}">${esc(p.name)}</button>`).join("")
      : `<span class="muted">No town found by that name.</span>`;
  } catch (err) {
    showError(err);
  }
});
$("#trip-place-results").addEventListener("click", (e) => {
  const i = e.target.dataset.tripPlace;
  if (i === undefined) return;
  trip.place = tripPlaceChoices[Number(i)];
  $("#trip-place").textContent = trip.place.name;
  $("#trip-place-results").innerHTML = "";
  $("#trip-form").elements.placeQuery.value = "";
});

$("#trip-cancel").addEventListener("click", () => (trip && trip.id ? openTripPlan(trip) : renderTrips()));
$("#new-trip").addEventListener("click", () => openTripEditor(null));

$("#trip-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  Object.assign(trip, {
    name: f.elements.name.value.trim() || "Trip",
    startDate: f.elements.startDate.value,
    weather: f.elements.weather.value,
  });
  if (!trip.events.length) return showError(new Error("Add at least one outfit to plan."));
  $("#trip-form-msg").textContent = "Planning outfits…";
  await planWholeTrip();
  $("#trip-form-msg").textContent = "";
});

// ---------- Planning ----------
// Weather for each day: the forecast where available, otherwise the owner's choice.
async function loadTripWeather(t) {
  const chosen = t.weather === "auto" ? null : { kind: t.weather };
  let forecast = null;
  if (!chosen && t.place) {
    try {
      forecast = await getLongForecast(t.place);
    } catch {
      forecast = null;
    }
  }
  return Array.from({ length: t.days }, (_, i) => {
    if (chosen) return { w: chosen, note: `${t.weather} weather (your choice)` };
    if (!t.place) return { w: null, note: "no place set, weather ignored" };
    const day = forecast && forecast.get(isoDay(tripDate(t, i + 1)));
    if (!day) return { w: null, note: forecast ? "too far ahead for a forecast, weather ignored" : "forecast unavailable, weather ignored" };
    const w = weatherKind(day);
    const unit = (loadWeatherSettings() || {}).unit || defaultUnit();
    return { w, note: `${SKY(day.code)}, feels like ${toUnit(day.feelsMinC, unit)}–${toUnit(day.feelsMaxC, unit)}°${unit}` };
  });
}

const savedToPlans = (t) => t.outfits.map((o) => {
  const its = itemsOf(o.itemIds);
  return { day: o.day, occasion: o.occasion, outfit: its.length ? slotsFromItems(its) : null, ignoredWeather: false };
});

// Saves run one at a time, each sending the trip as it is at that moment, so
// quick ticks can't arrive out of order. What's on screen is never replaced
// by an older reply; only the new trip's id is taken from the first save.
let tripSaves = Promise.resolve();
function saveTrip() {
  trip.outfits = tripPlans.map((p) => ({ day: p.day, occasion: p.occasion, itemIds: p.outfit ? outfitItems(p.outfit).map((i) => i.id) : [] }));
  const inTrip = new Set(trip.outfits.flatMap((o) => o.itemIds));
  trip.packed = trip.packed.filter((id) => inTrip.has(id));
  const target = trip;
  const run = tripSaves.then(async () => {
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify(target);
    const saved = target.id
      ? await api("/api/trips/" + target.id, { method: "PUT", headers, body })
      : await api("/api/trips", { method: "POST", headers, body });
    if (!target.id) Object.assign(target, { id: saved.id, createdAt: saved.createdAt });
  });
  tripSaves = run.catch(() => {});
  return run;
}

async function planWholeTrip() {
  try {
    tripWeather = await loadTripWeather(trip);
    const entries = trip.events.map((e) => ({ ...e, w: tripWeather[e.day - 1].w }));
    tripPlans = planTrip(items, entries, prefs);
    await saveTrip();
    renderTripPlan();
  } catch (err) {
    showError(err);
  }
}

async function openTripPlan(t) {
  trip = JSON.parse(JSON.stringify(t));
  tripPlans = savedToPlans(trip);
  tripWeather = await loadTripWeather(trip);
  if (!tripPlans.length) return planWholeTrip();
  renderTripPlan();
}

// An outfit missing its shoes, or its dress / top and bottom (a piece was
// removed from the closet after the trip was planned).
const complete = (o) => !!(o.shoes && (o.dress || (o.top && o.bottom)));
// No outfit for an entry: either the closet can't dress it, or its pieces were removed.
const noOutfitNote = (p) => (generateOutfit(items, p.occasion, [], null)
  ? "No outfit planned here. Tap Another to plan one." : missingFor(items, p.occasion));

function renderTripPlan() {
  showTripPanel("trip-plan-panel");
  $("#trip-plan-title").textContent = trip.name;
  $("#trip-plan-sub").textContent = `${shortDate(tripDate(trip, 1))} – ${shortDate(tripDate(trip, trip.days))}` +
    (trip.place ? ` · ${trip.place.name.split(",")[0]}` : "");

  $("#trip-outfits").innerHTML = tripPlans.map((p, i) => {
    const wx = tripWeather[p.day - 1] || { note: "" };
    const label = OCCASIONS[p.occasion] ? OCCASIONS[p.occasion].label : p.occasion;
    return `<div class="card saved trip-outfit">
      <div class="saved-head">
        <strong>Day ${p.day} · ${esc(label)}</strong>
        <span class="muted">${shortDate(tripDate(trip, p.day))}</span>
        <button class="link style-it" data-replan="${i}">Another</button>
      </div>
      <p class="muted trip-weather">${esc(wx.note)}${p.ignoredWeather ? " · nothing fully suits this weather, so this outfit ignores it" : ""}</p>
      ${p.outfit && !complete(p.outfit) ? `<p class="msg">Part of this outfit was removed from your closet. Tap Another for a new one.</p>` : ""}
      ${p.outfit ? boardHtml(p.outfit) : `<p class="msg">${esc(noOutfitNote(p))}</p>`}
    </div>`;
  }).join("");
  renderPacking();
}

function renderPacking() {
  const ids = [...new Set(tripPlans.flatMap((p) => (p.outfit ? outfitItems(p.outfit).map((i) => i.id) : [])))];
  const its = itemsOf(ids);
  const packed = new Set(trip.packed);
  const done = its.filter((i) => packed.has(i.id)).length;
  $("#packing-count").textContent = its.length ? `${done} of ${its.length} packed` : "";
  $("#packing-list").innerHTML = TYPE_ORDER.map((type) => {
    const group = its.filter((i) => i.category === type);
    if (!group.length) return "";
    return `<h3>${TYPE_TITLES[type]}</h3>` + group.map((i) => `
      <label class="pack-row${packed.has(i.id) ? " packed" : ""}">
        <input type="checkbox" data-pack="${esc(i.id)}"${packed.has(i.id) ? " checked" : ""}>
        <img src="${esc(shownThumb(i))}" alt="">
        <span>${esc(i.name)}</span>
      </label>`).join("");
  }).join("");
}

$("#trip-outfits").addEventListener("click", async (e) => {
  const i = e.target.dataset.replan;
  if (i === undefined) return;
  const idx = Number(i);
  const p = tripPlans[idx];
  tripPlans[idx] = replanTripEntry(items, tripPlans, idx, { day: p.day, occasion: p.occasion, w: (tripWeather[p.day - 1] || {}).w }, prefs);
  renderTripPlan();
  try {
    await saveTrip();
  } catch (err) {
    showError(err);
  }
});

$("#packing-list").addEventListener("change", async (e) => {
  const id = e.target.dataset.pack;
  if (!id) return;
  trip.packed = e.target.checked ? [...new Set([...trip.packed, id])] : trip.packed.filter((x) => x !== id);
  renderPacking();
  try {
    await saveTrip();
  } catch (err) {
    showError(err);
  }
});

$("#trip-replan-all").addEventListener("click", () => {
  if (confirm("Plan every outfit again? Your packing ticks stay for pieces that are still needed.")) planWholeTrip();
});
$("#trip-edit").addEventListener("click", () => openTripEditor(trip));
$("#trip-back").addEventListener("click", renderTrips);

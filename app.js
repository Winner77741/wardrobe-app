// Wardrobe front end: closet management, outfit creation, saved outfits.

let items = [];
let current = null; // outfit currently shown on the Create board
let anchor = null;  // item the user chose to "build an outfit around"
const kept = new Set(); // ids of outfit pieces the user chose to keep (🔒) while trying others

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// On the Mac this talks to the server; inside the iPhone app, phone-bundle.js
// provides window.phoneApi, which answers the same requests from phone storage.
async function api(url, opts = {}) {
  if (window.phoneApi) return window.phoneApi(url, opts);
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

// ---------- Errors ----------
// A short message at the bottom of the screen when something fails, so a
// button never just stops working without a word.
let toastTimer = null;
function showError(err) {
  const toast = $("#toast");
  const text = err && err.message ? err.message : String(err || "Something went wrong.");
  // On the Mac, a network failure means the Wardrobe server isn't running.
  const offline = !window.phoneApi && /Failed to fetch|NetworkError|Load failed/i.test(text);
  toast.textContent = offline
    ? "Couldn't reach the Wardrobe app. Is it still running on your Mac? (Start it with: npm start)"
    : text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
}
// Safety net: any failure not handled elsewhere still gets a message.
window.addEventListener("unhandledrejection", (e) => showError(e.reason));

// ---------- Tabs ----------
function showView(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  if (name === "saved") renderSaved();
  if (name === "settings") renderSettings();
}

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => showView(btn.dataset.view)));

// ---------- Closet ----------
const form = $("#add-form");
const photoInput = form.querySelector('input[type="file"]');

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  const img = $("#photo-preview");
  if (!file) { img.hidden = true; $("#photo-hint").hidden = false; return; }
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  $("#photo-hint").hidden = true;
  suggestFromPhoto(file);
});

// ---------- AI fills in item details ----------
let aiReady = false;
let suggestRun = 0; // ignore an older answer if a newer photo was chosen meanwhile

async function suggestFromPhoto(file) {
  const note = $("#ai-msg");
  if (!aiReady) { note.hidden = true; return; }
  const run = ++suggestRun;
  note.hidden = false;
  note.textContent = "AI is looking at your photo…";
  const data = new FormData();
  data.append("photo", file);
  try {
    const { details, cost } = await api("/api/suggest", { method: "POST", body: data });
    if (run !== suggestRun) return;
    form.elements.name.value = details.name;
    form.elements.category.value = details.category;
    form.elements.colors.value = details.colors.join(", ");
    form.elements.formality.value = String(details.formality);
    form.elements.tags.value = details.tags.join(", ");
    note.textContent = `Filled in by AI. Please check before adding. (Cost: ${(cost * 100).toFixed(2)}¢)`;
  } catch (err) {
    if (run === suggestRun) note.textContent = err.message;
  }
}

// ---------- Settings ----------
async function renderSettings() {
  const s = await api("/api/settings");
  if (window.phoneApi) $("#key-where").textContent = "The key is saved only on this phone.";
  aiReady = s.hasKey;
  $("#key-status").innerHTML = s.hasKey
    ? `<span class="ok">✓ API key saved (ends in ${esc(s.keyHint)}).</span> Paste a new one below to replace it.`
    : "No API key yet. AI fill-in is off.";
  $("#model-select").innerHTML = s.models
    .map((m) => `<option value="${esc(m.id)}"${m.id === s.model ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  const [liked, disliked] = await Promise.all([api("/api/outfits"), api("/api/dislikes")]);
  $("#learned-summary").textContent = `${liked.length} loved (saved) outfit${liked.length === 1 ? "" : "s"}, ` +
    `${disliked.length} thumbs down.`;
  $("#reset-dislikes").disabled = disliked.length === 0;
}

// In the iPhone app the closet file is made on the phone and shared from there.
document.querySelector('a[href="/api/export"]').addEventListener("click", async (e) => {
  if (!window.phoneExport) return; // on the Mac, the link downloads from the server
  e.preventDefault();
  $("#import-msg").textContent = "Preparing your closet file…";
  try {
    await window.phoneExport();
    $("#import-msg").textContent = "";
  } catch (err) {
    $("#import-msg").textContent = "Couldn't make the closet file: " + err.message;
  }
});

$("#import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#import-msg");
  if (!confirm("Replace your whole closet with the one in this file? A backup of your current closet is made first.")) return;
  msg.textContent = "Backing up your current closet, then loading the file…";
  try {
    const r = await api("/api/import", { method: "POST", body: new FormData(e.target) });
    e.target.reset();
    msg.textContent = `Done: ${r.items} items, ${r.outfits} saved outfits and ${r.dislikes} thumbs down loaded. ` +
      `Your previous closet is backed up in ${r.backup}.`;
    items = await api("/api/items");
    renderCloset();
    refreshPrefs();
    renderSettings();
  } catch (err) {
    msg.textContent = err.message;
  }
});

$("#reset-dislikes").addEventListener("click", async () => {
  if (!confirm("Forget all your thumbs down? Disliked outfits may be suggested again. Your saved outfits stay.")) return;
  await api("/api/dislikes", { method: "DELETE" });
  await refreshPrefs();
  $("#learned-msg").textContent = "Done. Thumbs down cleared.";
  renderSettings();
});

$("#key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#settings-msg");
  msg.textContent = "Checking the key with Anthropic…";
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: e.target.elements.apiKey.value }),
    });
    e.target.reset();
    msg.textContent = "Key saved. AI fill-in is on.";
    renderSettings();
  } catch (err) {
    msg.textContent = err.message;
  }
});

$("#model-select").addEventListener("change", async (e) => {
  await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: e.target.value }),
  });
  $("#settings-msg").textContent = "AI model saved.";
});

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#add-msg");
  const name = form.elements.name.value;
  if (!photoInput.files.length) {
    msg.textContent = "Please choose a photo first (click the dashed box).";
    return;
  }
  if (items.some((i) => sameName(i.name, name)) &&
      !confirm(`You already have an item called “${name.trim()}”. Add it again anyway?`)) {
    msg.textContent = "Not added. Change the name if this is a different item.";
    return;
  }
  msg.textContent = "Saving…";
  try {
    const item = await api("/api/items", { method: "POST", body: new FormData(form) });
    items.push(item);
    form.reset();
    $("#photo-preview").hidden = true;
    $("#photo-hint").hidden = false;
    $("#ai-msg").hidden = true;
    renderCloset();
    if (canCutout()) {
      msg.textContent = `Added “${item.name}”. Removing the background…`;
      waitForCutout(item.id, msg);
    } else {
      msg.textContent = `Added “${item.name}”.`;
    }
  } catch (err) {
    msg.textContent = err.message;
  }
});

// Background removal runs on the Mac and in a native iPhone app, but not in
// the home-screen web app (it needs Apple's tools).
const canCutout = () => !window.phoneApi || !!window.phoneCanCutout;

// The server removes the background a few seconds after upload; refresh the item when it's ready.
async function waitForCutout(id, msg) {
  for (let tries = 0; tries < 30; tries++) {
    await new Promise((r) => setTimeout(r, 2000));
    let fresh;
    try {
      fresh = (await api("/api/items")).find((i) => i.id === id);
    } catch {
      return; // the photo still shows; the next page load picks up the result
    }
    if (!fresh) return;
    if (fresh.cutout || fresh.cutoutFailed) {
      items = items.map((i) => (i.id === id ? fresh : i));
      renderCloset();
      if (msg) msg.textContent = fresh.cutout
        ? `Added “${fresh.name}”. Background removed.`
        : `Added “${fresh.name}”. Couldn't find the item in the photo, so the original is used.`;
      return;
    }
  }
}

// The background-removed photo when there is one (and it's switched on), otherwise the original.
const shownPhoto = (i) => (i.cutout && i.useCutout !== false ? i.cutout : i.photo);
// The same, as a small copy (much faster to show); the full photo if there's no small copy yet.
const shownThumb = (i) => (i.cutout && i.useCutout !== false ? i.cutoutThumb || i.cutout : i.thumb || i.photo);

$("#closet-filter").addEventListener("change", renderCloset);

const LEVELS = ["", "Very casual", "Casual", "Smart casual", "Dressy", "Formal"];

function renderCloset() {
  const filter = $("#closet-filter").value;
  const shown = items.filter((i) => !filter || i.category === filter);
  $("#item-count").textContent = `(${items.length} item${items.length === 1 ? "" : "s"})`;
  const grid = $("#closet-grid");
  if (!shown.length) {
    grid.innerHTML = `<p class="muted">${items.length ? "Nothing of this type yet." :
      "Your closet is empty. Add your first item above."}</p>`;
    return;
  }
  grid.innerHTML = shown.map((i) => `
    <div class="card item">
      <img src="${esc(shownThumb(i))}" alt="${esc(i.name)}">
      <div class="item-info">
        <strong>${esc(i.name)}</strong>
        <span class="muted">${esc(i.category)} · ${LEVELS[i.formality]}</span>
        ${i.colors.length ? `<span class="muted">${esc(i.colors.join(", "))}</span>` : ""}
      </div>
      <div class="item-actions">
        <button class="link style-it" data-style="${esc(i.id)}">Style it</button>
        <button class="link" data-edit="${esc(i.id)}">Edit</button>
        <button class="link danger" data-del="${esc(i.id)}">Remove</button>
      </div>
    </div>`).join("");
}

$("#closet-grid").addEventListener("click", async (e) => {
  const { del, edit, style } = e.target.dataset;
  if (edit) return openEdit(edit);
  if (style) return buildAround(style);
  if (!del) return;
  const item = items.find((i) => i.id === del);
  if (!confirm(`Remove “${item.name}” from your closet? This also deletes its photo.`)) return;
  try {
    await api("/api/items/" + del, { method: "DELETE" });
  } catch (err) {
    return showError(err);
  }
  items = items.filter((i) => i.id !== del);
  if (anchor && anchor.id === del) setAnchor(null);
  renderCloset();
});

// ---------- Edit item ----------
const editDialog = $("#edit-dialog");
const editForm = $("#edit-form");
let editingId = null;

// Reuse the dropdown choices from the "Add an item" form.
for (const name of ["category", "formality"]) {
  editForm.elements[name].innerHTML = form.elements[name].innerHTML;
}

function openEdit(id) {
  const item = items.find((i) => i.id === id);
  editingId = id;
  editForm.reset();
  editForm.elements.name.value = item.name;
  editForm.elements.category.value = item.category;
  editForm.elements.colors.value = item.colors.join(", ");
  editForm.elements.formality.value = String(item.formality);
  editForm.elements.tags.value = item.tags.join(", ");
  const box = editForm.elements.useCutout;
  box.checked = item.useCutout !== false;
  box.disabled = !item.cutout;
  $("#cutout-note").textContent = item.cutout ? ""
    : item.cutoutFailed ? "Couldn't find the item in this photo, so the original is used."
    : !canCutout() ? "Background removal isn't available in the phone app. Photos added on the Mac get it."
    : "Background removal hasn't finished for this photo yet.";
  $("#edit-preview").src = shownPhoto(item);
  $("#edit-msg").textContent = "";
  editDialog.showModal();
}

// Switching background removal on or off shows the matching photo right away.
editForm.elements.useCutout.addEventListener("change", () => {
  if (editForm.elements.photo.files.length) return;
  const item = items.find((i) => i.id === editingId);
  $("#edit-preview").src = editForm.elements.useCutout.checked ? item.cutout : item.photo;
});

editForm.elements.photo.addEventListener("change", () => {
  const file = editForm.elements.photo.files[0];
  if (file) $("#edit-preview").src = URL.createObjectURL(file);
});

$("#edit-cancel").addEventListener("click", () => editDialog.close());

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(editForm);
  const newPhoto = editForm.elements.photo.files.length > 0;
  if (!newPhoto) data.delete("photo");
  data.set("useCutout", editForm.elements.useCutout.checked ? "true" : "false");
  $("#edit-msg").textContent = "Saving…";
  try {
    const updated = await api("/api/items/" + editingId, { method: "PUT", body: data });
    items = items.map((i) => (i.id === updated.id ? updated : i));
    if (anchor && anchor.id === updated.id) setAnchor(updated);
    editDialog.close();
    renderCloset();
    if (newPhoto && canCutout()) waitForCutout(updated.id);
  } catch (err) {
    $("#edit-msg").textContent = err.message;
  }
});

// ---------- Outfit board ----------
// `tools`: show Keep / Swap / remove buttons on each piece (Create Outfit only).
function tile(item, area, starId, tools) {
  if (!item) return "";
  const star = starId && item.id === starId;
  const isKept = kept.has(item.id);
  const id = esc(item.id);
  const buttons = !tools ? "" : star ? `<div class="tile-tools"><span class="tool on">★ Building around</span></div>` : `
    <div class="tile-tools">
      <button class="tool${isKept ? " on" : ""}" data-keep="${id}" title="Keep this piece when you click Try another">${isKept ? "🔒 Kept" : "Keep"}</button>
      <button class="tool" data-swap="${id}" title="Swap just this piece">Swap</button>
      ${canRemove(item) ? `<button class="tool" data-drop="${id}" title="Leave this piece out">✕</button>` : ""}
    </div>`;
  return `<figure class="slot slot-${area}${star ? " anchored" : ""}${isKept && tools ? " kept" : ""}">
    <img src="${esc(shownThumb(item))}" alt="${esc(item.name)}">
    ${buttons}
    <figcaption>${esc(item.name)}</figcaption>
  </figure>`;
}

// starId marks the "build around" item with a star on the board.
function boardHtml(o, starId, tools = false) {
  const t = (item, area) => tile(item, area, starId, tools);
  return `<div class="board ${o.dress ? "has-dress" : ""} ${o.outerwear ? "" : "no-outer"}">
    ${t(o.outerwear, "outer")}
    ${o.dress ? t(o.dress, "dress") : t(o.top, "top") + t(o.bottom, "bottom")}
    ${t(o.shoes, "shoes")}
    ${t(o.bag, "bag")}
    ${o.accessories && o.accessories.length ? `<div class="slot-acc">${o.accessories.map((a) => t(a, "accessory")).join("")}</div>` : ""}
  </div>`;
}

// ---------- Create ----------
const occSelect = $("#occasion");
occSelect.innerHTML = Object.entries(OCCASIONS)
  .map(([k, o]) => `<option value="${k}">${o.label}</option>`).join("");

// What the app has learned from thumbs up (saved outfits) and thumbs down.
let prefs = null;
async function refreshPrefs() {
  const [liked, disliked] = await Promise.all([api("/api/outfits"), api("/api/dislikes")]);
  prefs = learnPreferences(liked, disliked);
  const n = liked.length + disliked.length;
  $("#learned-note").textContent = n ? `Learning from your ${n} rating${n === 1 ? "" : "s"}.` : "";
}

// Pieces every new outfit must include: the "build around" item and kept pieces.
function fixedPieces() {
  const fixed = items.filter((i) => kept.has(i.id));
  return anchor && !kept.has(anchor.id) ? [anchor, ...fixed] : fixed;
}

function makeOutfit(note = "") {
  const msg = $("#create-msg");
  current = generateOutfit(items, occSelect.value, fixedPieces(), prefs);
  if (!current) {
    msg.textContent = missingFor(items, occSelect.value, fixedPieces());
    $("#board-wrap").innerHTML = "";
    $("#shuffle").hidden = $("#rate-bar").hidden = true;
    return;
  }
  showCurrent(typeof note === "string" ? note : "");
}

// Draw the current outfit, ready to rate.
function showCurrent(note = "") {
  $("#create-msg").textContent = note;
  $("#board-wrap").innerHTML = boardHtml(current, anchor && anchor.id, true);
  $("#shuffle").hidden = $("#rate-bar").hidden = false;
  $("#save-outfit").disabled = $("#dislike-outfit").disabled = false;
  $("#keep-hint").textContent = kept.size
    ? `🔒 ${kept.size} kept piece${kept.size === 1 ? "" : "s"} will stay when you click Try another.`
    : "Tip: tap Keep on pieces you like, then Try another to change the rest.";
}

const TYPE_NAMES = {
  top: "top", bottom: "bottom", dress: "dress", outerwear: "coat or jacket",
  shoes: "pair of shoes", bag: "bag", accessory: "accessory",
};

// Keep / Swap / remove one piece of the outfit on the board.
$("#board-wrap").addEventListener("click", (e) => {
  const { keep, swap, drop } = e.target.dataset;
  if (!current || !(keep || swap || drop)) return;
  if (keep) {
    kept.has(keep) ? kept.delete(keep) : kept.add(keep);
    return showCurrent();
  }
  if (swap) {
    const piece = items.find((i) => i.id === swap);
    const next = swapPiece(items, occSelect.value, current, swap, prefs);
    if (!next) {
      $("#create-msg").textContent = `No other ${TYPE_NAMES[piece.category]} in your closet suits ${OCCASIONS[occSelect.value].label}.`;
      return;
    }
    kept.delete(swap);
    current = next;
    return showCurrent();
  }
  const next = removePiece(current, drop);
  if (next) {
    kept.delete(drop);
    current = next;
    showCurrent();
  }
});

// ---------- Build an outfit around one item ----------
function setAnchor(item) {
  anchor = item;
  $("#anchor-bar").hidden = !item;
  if (item) {
    $("#anchor-img").src = shownThumb(item);
    $("#anchor-name").textContent = item.name;
  }
}

function buildAround(id) {
  kept.clear();
  setAnchor(items.find((i) => i.id === id));
  // Keep the chosen occasion if the item suits it; otherwise switch to one that does.
  if (!fits(anchor, OCCASIONS[occSelect.value])) {
    const match = Object.keys(OCCASIONS).find((k) => fits(anchor, OCCASIONS[k]));
    if (match) occSelect.value = match;
  }
  showView("create");
  makeOutfit();
}

$("#anchor-clear").addEventListener("click", () => {
  setAnchor(null);
  makeOutfit();
});

// "Create outfit" starts fresh; "Try another" keeps the pieces marked Keep.
$("#generate").addEventListener("click", () => {
  kept.clear();
  makeOutfit();
});
$("#shuffle").addEventListener("click", () => makeOutfit());

const rateBody = () => JSON.stringify({ occasion: occSelect.value, itemIds: outfitItems(current).map((i) => i.id) });

// Thumbs up: save the outfit. The app suggests these items together more often.
$("#save-outfit").addEventListener("click", async () => {
  if (!current) return;
  $("#save-outfit").disabled = $("#dislike-outfit").disabled = true;
  let saved;
  try {
    saved = await api("/api/outfits", { method: "POST", headers: { "Content-Type": "application/json" }, body: rateBody() });
  } catch (err) {
    $("#save-outfit").disabled = $("#dislike-outfit").disabled = false;
    return showError(err);
  }
  await refreshPrefs();
  $("#create-msg").textContent = saved.alreadySaved
    ? "You already love this one. It's in Saved Outfits."
    : "Saved to Saved Outfits. The app will suggest looks like this more often.";
});

// Thumbs down: never suggest this exact outfit again, and these items together less often.
$("#dislike-outfit").addEventListener("click", async () => {
  if (!current) return;
  $("#save-outfit").disabled = $("#dislike-outfit").disabled = true;
  let result;
  try {
    result = await api("/api/dislikes", { method: "POST", headers: { "Content-Type": "application/json" }, body: rateBody() });
  } catch (err) {
    $("#save-outfit").disabled = $("#dislike-outfit").disabled = false;
    return showError(err);
  }
  await refreshPrefs();
  makeOutfit(result.wasSaved
    ? "Got it. You'd saved that one before, so it's been removed from Saved Outfits. Here's another."
    : "Got it, the app won't suggest that one again. Here's another.");
});

// ---------- Saved ----------
async function renderSaved() {
  const outfits = await api("/api/outfits");
  const list = $("#saved-list");
  if (!outfits.length) {
    list.innerHTML = `<p class="muted">No saved outfits yet.</p>`;
    return;
  }
  list.innerHTML = outfits.slice().reverse().map((o) => {
    const its = o.itemIds.map((id) => items.find((i) => i.id === id)).filter(Boolean);
    const label = OCCASIONS[o.occasion] ? OCCASIONS[o.occasion].label : "Outfit";
    return `<div class="card saved">
      <div class="saved-head">
        <strong>${esc(label)}</strong>
        <span class="muted">${new Date(o.createdAt).toLocaleDateString()}</span>
        <button class="link danger" data-del-outfit="${esc(o.id)}">Delete</button>
      </div>
      ${boardHtml(slotsFromItems(its))}
    </div>`;
  }).join("");
}

$("#saved-list").addEventListener("click", async (e) => {
  const id = e.target.dataset.delOutfit;
  if (!id || !confirm("Delete this saved outfit? Your clothes stay in your closet.")) return;
  await api("/api/outfits/" + id, { method: "DELETE" });
  renderSaved();
  refreshPrefs();
});

// ---------- Start ----------
api("/api/items").then((data) => { items = data; renderCloset(); }).catch((err) => {
  $("#closet-grid").innerHTML = `<p class="msg">Couldn't load your closet: ${esc(err.message)}</p>`;
  showError(err);
});
api("/api/settings").then((s) => { aiReady = s.hasKey; });
refreshPrefs();

// "Add many items at once": choose several photos, AI fills in each one,
// the user checks the list, then adds them all. Uses helpers from app.js.

const MAX_BULK = 50;      // photos per batch
const AI_AT_ONCE = 3;     // AI requests running at the same time
let bulkRows = [];        // { key, file, state: "waiting"|"thinking"|"ready"|"added"|"failed" }
let bulkCost = 0;

$("#bulk-input").addEventListener("change", (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  const room = MAX_BULK - bulkRows.filter((r) => r.state !== "added").length;
  if (files.length > room) {
    $("#bulk-msg").textContent = `Only the first ${room} photos were added to the list (up to ${MAX_BULK} at a time).`;
  }
  for (const file of files.slice(0, Math.max(0, room))) {
    bulkRows.push({ key: crypto.randomUUID(), file, state: aiReady ? "waiting" : "ready" });
  }
  renderBulk();
  runBulkAI();
});

function bulkRowEl(row) {
  return document.querySelector(`.bulk-row[data-key="${row.key}"]`);
}

function renderBulk() {
  const list = $("#bulk-list");
  for (const row of bulkRows) {
    if (bulkRowEl(row)) continue;
    const el = document.createElement("div");
    el.className = "bulk-row";
    el.dataset.key = row.key;
    el.innerHTML = `
      <img alt="">
      <div class="bulk-fields">
        <input name="name" placeholder="Name">
        <select name="category">${form.elements.category.innerHTML}</select>
        <input name="colors" placeholder="Colors">
        <select name="formality">${form.elements.formality.innerHTML}</select>
        <input name="tags" placeholder="Tags">
        <p class="bulk-status"></p>
      </div>
      <button class="link danger" data-remove>Remove</button>`;
    el.querySelector("img").src = URL.createObjectURL(row.file);
    el.querySelector('[name="category"]').value = "";
    el.querySelector("[data-remove]").addEventListener("click", () => {
      bulkRows = bulkRows.filter((r) => r !== row);
      el.remove();
      updateBulkStatus();
    });
    list.appendChild(el);
  }
  updateBulkStatus();
}

function setRowStatus(row, text, kind = "") {
  const p = bulkRowEl(row)?.querySelector(".bulk-status");
  if (!p) return;
  p.textContent = text;
  p.className = "bulk-status " + kind;
}

function updateBulkStatus() {
  const pending = bulkRows.filter((r) => r.state !== "added");
  $("#bulk-actions").hidden = bulkRows.length === 0;
  const thinking = pending.filter((r) => r.state === "waiting" || r.state === "thinking").length;
  const btn = $("#bulk-add");
  btn.disabled = thinking > 0 || pending.length === 0;
  btn.textContent = pending.length ? `Add all ${pending.length}` : "Add all";
  for (const row of bulkRows) {
    if (row.state === "waiting") setRowStatus(row, "Waiting for AI…");
    if (row.state === "ready" && !aiReady) setRowStatus(row, "Fill in the details (AI fill-in is off — turn it on in Settings).");
  }
  if (thinking) $("#bulk-msg").textContent = `AI is filling in ${thinking} photo${thinking === 1 ? "" : "s"}…`;
  else if (bulkCost) $("#bulk-msg").textContent = `AI cost for these photos: ${(bulkCost * 100).toFixed(2)}¢`;
}

// AI fills in a few rows at a time until none are waiting.
let bulkWorkers = 0;
function runBulkAI() {
  while (bulkWorkers < AI_AT_ONCE) {
    const row = bulkRows.find((r) => r.state === "waiting");
    if (!row) break;
    bulkWorkers++;
    suggestRow(row).finally(() => {
      bulkWorkers--;
      updateBulkStatus();
      runBulkAI();
    });
  }
}

async function suggestRow(row) {
  row.state = "thinking";
  setRowStatus(row, "AI is looking at this photo…");
  const data = new FormData();
  data.append("photo", row.file);
  try {
    const { details, cost } = await api("/api/suggest", { method: "POST", body: data });
    const el = bulkRowEl(row);
    if (!el) return; // removed while AI was working
    el.querySelector('[name="name"]').value = details.name;
    el.querySelector('[name="category"]').value = details.category;
    el.querySelector('[name="colors"]').value = details.colors.join(", ");
    el.querySelector('[name="formality"]').value = String(details.formality);
    el.querySelector('[name="tags"]').value = details.tags.join(", ");
    bulkCost += cost;
    row.state = "ready";
    setRowStatus(row, "Filled in by AI. Please check.", "ready");
  } catch (err) {
    row.state = "ready";
    setRowStatus(row, `${err.message} Please fill in the details yourself.`, "problem");
  }
}

$("#bulk-clear").addEventListener("click", () => {
  if (bulkRows.some((r) => r.state !== "added") && !confirm("Clear the list? Items not yet added will be dropped (your photos on disk are not affected).")) return;
  bulkRows = [];
  bulkCost = 0;
  $("#bulk-list").innerHTML = "";
  $("#bulk-msg").textContent = "";
  updateBulkStatus();
});

$("#bulk-add").addEventListener("click", async () => {
  const rows = bulkRows.filter((r) => r.state === "ready");
  const fields = (row) => {
    const el = bulkRowEl(row);
    return Object.fromEntries(["name", "category", "colors", "formality", "tags"]
      .map((n) => [n, el.querySelector(`[name="${n}"]`).value]));
  };

  // Every item needs a name and a type.
  const incomplete = rows.filter((r) => { const f = fields(r); return !f.name.trim() || !f.category; });
  incomplete.forEach((r) => setRowStatus(r, "Needs a name and a type.", "problem"));

  // Same name as something already in the closet, or twice in this list?
  const ok = rows.filter((r) => !incomplete.includes(r));
  const seen = new Set();
  const dupes = ok.filter((r) => {
    const name = fields(r).name.trim().toLowerCase();
    const dup = items.some((i) => sameName(i.name, name)) || seen.has(name);
    seen.add(name);
    return dup;
  });
  let toAdd = ok;
  if (dupes.length) {
    const names = dupes.map((r) => `• ${fields(r).name.trim()}`).join("\n");
    if (!confirm(`These names are already in your closet (or appear twice in this list):\n\n${names}\n\nAdd them anyway? Click Cancel to skip them so you can rename them.`)) {
      toAdd = ok.filter((r) => !dupes.includes(r));
      dupes.forEach((r) => setRowStatus(r, "Same name as another item. Rename it, or click Add all again and choose OK.", "problem"));
    }
  }
  if (!toAdd.length) return;

  $("#bulk-add").disabled = true;
  let added = 0;
  for (const row of toAdd) {
    const data = new FormData();
    data.append("photo", row.file);
    for (const [k, v] of Object.entries(fields(row))) data.append(k, v);
    try {
      const item = await api("/api/items", { method: "POST", body: data });
      items.push(item);
      row.state = "added";
      bulkRowEl(row).classList.add("added");
      bulkRowEl(row).querySelectorAll("input, select").forEach((x) => (x.disabled = true));
      if (canCutout()) {
        setRowStatus(row, "Added ✓ Removing the background…", "ready");
        waitForCutout(item.id).then(() => setRowStatus(row, "Added ✓", "ready"));
      } else {
        setRowStatus(row, "Added ✓", "ready");
      }
      added++;
    } catch (err) {
      setRowStatus(row, err.message, "problem");
    }
    $("#bulk-msg").textContent = `Adding… ${added} of ${toAdd.length}`;
  }
  renderCloset();
  updateBulkStatus();
  $("#bulk-msg").textContent = `Added ${added} item${added === 1 ? "" : "s"} to your closet.`;
});

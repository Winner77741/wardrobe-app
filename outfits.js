// Outfit rules: which items fit an occasion, and how to pick a matching set.

const OCCASIONS = {
  opera:   { label: "Opera / Theater",  min: 4, max: 5, outerwear: true,  accessories: 2 },
  gala:    { label: "Gala / Black tie", min: 5, max: 5, outerwear: true,  accessories: 2 },
  wedding: { label: "Wedding guest",    min: 4, max: 5, outerwear: false, accessories: 2 },
  date:    { label: "Date night",       min: 3, max: 4, outerwear: false, accessories: 2 },
  dinner:  { label: "Dinner out",       min: 3, max: 4, outerwear: false, accessories: 1 },
  work:    { label: "Work / Office",    min: 3, max: 4, outerwear: true,  accessories: 1 },
  brunch:  { label: "Brunch",           min: 2, max: 3, outerwear: false, accessories: 1 },
  casual:  { label: "Casual day out",   min: 1, max: 2, outerwear: false, accessories: 1 },
};

// Colors that go with almost anything.
const NEUTRALS = new Set([
  "black", "white", "cream", "ivory", "beige", "tan", "camel", "grey", "gray",
  "navy", "brown", "denim", "nude", "gold", "silver", "khaki", "charcoal",
]);

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function fits(item, occ) {
  return item.formality >= occ.min && item.formality <= occ.max;
}

// Fewer "statement" colors = more harmonious. Lower score is better.
function colorScore(items) {
  const bold = new Set();
  for (const it of items) for (const c of it.colors) if (!NEUTRALS.has(c)) bold.add(c);
  return bold.size <= 1 ? 0 : bold.size - 1;
}

// Does an item suit the day's weather? `w` is { kind: "warm"|"mild"|"cold",
// rainy } from weather.js, or null when weather is off.
function suitsWeather(item, w) {
  if (!w) return true;
  if (w.kind === "warm" && item.weather === "cold") return false;
  if (w.kind === "cold" && item.weather === "warm") return false;
  if ((w.rainy || w.snowy) && item.category === "shoes" && item.weather === "warm") return false; // no open sandals
  return true;
}

function byCat(items, occ, cat, w) {
  return items.filter((i) => i.category === cat && fits(i, occ) && suitsWeather(i, w));
}

// The items available for each slot. `fixed` are pieces the owner wants in
// the outfit: the item they're building around, and pieces they chose to keep.
// A fixed piece's slot holds only that piece, whatever the occasion.
function pools(items, occ, fixed = [], w = null) {
  const fixedOf = (cat) => fixed.filter((i) => i.category === cat);
  const pool = (cat) => (fixedOf(cat).length ? [fixedOf(cat)[0]] : byCat(items, occ, cat, w));
  const fixedCats = new Set(fixed.map((i) => i.category));
  const p = {
    dress: pool("dress"), top: pool("top"), bottom: pool("bottom"),
    shoes: pool("shoes"), outerwear: pool("outerwear"), bag: pool("bag"),
    fixedAccessories: fixedOf("accessory"),
    accessory: byCat(items, occ, "accessory", w).filter((i) => !fixed.some((f) => f.id === i.id)),
    fixedCats,
  };
  // A chosen top or bottom rules out a dress, and a chosen dress rules out separates.
  p.canDress = p.dress.length > 0 && !fixedCats.has("top") && !fixedCats.has("bottom");
  p.canSeparates = p.top.length > 0 && p.bottom.length > 0 && !fixedCats.has("dress");
  return p;
}

// Build one candidate outfit (or null if the closet is missing a needed piece).
function buildOnce(items, occ, fixed, w) {
  const p = pools(items, occ, fixed, w);
  const { canDress, canSeparates } = p;
  const dresses = p.dress, tops = p.top, bottoms = p.bottom, shoes = p.shoes;
  if (!canDress && !canSeparates) return null;
  if (!shoes.length) return null;

  const outfit = {};
  if (canDress && (!canSeparates || Math.random() < 0.5)) {
    outfit.dress = pick(dresses);
  } else {
    outfit.top = pick(tops);
    outfit.bottom = pick(bottoms);
  }
  outfit.shoes = pick(shoes);

  // Extras (coat, bag, accessories) must suit the main pieces: no felt hat
  // with sandals, no straw bag with a wool coat.
  const main = outfitItems(outfit);
  const clash = main.some((i) => i.weather === "warm") ? "cold" : main.some((i) => i.weather === "cold") ? "warm" : null;
  const suits = (i) => p.fixedCats.has(i.category) || i.weather !== clash;

  // Coat or jacket: always on cold days, never forced on warm ones.
  const outer = p.outerwear.filter(suits);
  const warm = w && w.kind === "warm";
  const wantOuter = p.fixedCats.has("outerwear") || (w && w.kind === "cold") ||
    (!warm && (occ.outerwear || Math.random() < 0.3));
  if (outer.length && wantOuter) outfit.outerwear = pick(outer);

  const bags = p.bag.filter(suits);
  if (bags.length) outfit.bag = pick(bags);

  const acc = p.accessory.filter(suits).sort(() => Math.random() - 0.5);
  outfit.accessories = [...p.fixedAccessories, ...acc].slice(0, Math.max(p.fixedAccessories.length, occ.accessories));
  return outfit;
}

function outfitItems(outfit) {
  return [outfit.dress, outfit.top, outfit.bottom, outfit.outerwear, outfit.shoes, outfit.bag,
    ...(outfit.accessories || [])].filter(Boolean);
}

// ---------- Learning from thumbs up / thumbs down ----------
// Every pair of items in a loved (saved) outfit gets +1, every pair in a
// disliked outfit gets -1. Pairs that keep getting liked are suggested more,
// pairs that keep getting disliked less. An exact disliked outfit never comes back.
const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const outfitKey = (ids) => [...ids].sort().join(",");

function learnPreferences(liked, disliked) {
  const pairs = new Map();
  const add = (ids, amount) => {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = pairKey(ids[i], ids[j]);
        pairs.set(k, (pairs.get(k) || 0) + amount);
      }
  };
  liked.forEach((o) => add(o.itemIds, 1));
  disliked.forEach((o) => add(o.itemIds, -1));
  return { pairs, disliked: new Set(disliked.map((o) => outfitKey(o.itemIds))) };
}

// Positive = the owner tends to like these items together.
function preferenceScore(list, prefs) {
  let total = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) total += prefs.pairs.get(pairKey(list[i].id, list[j].id)) || 0;
  return total;
}

// How much one rating counts, and how strongly better-scoring outfits are
// favored. Tuned on the owner's closet (2026-10-20): 1 thumbs down roughly
// halves how often those items appear together and 3 make it rare; each
// thumbs up makes them several times more likely. Color harmony stays ~97%.
const RATING_WEIGHT = 0.2;
const CHOOSINESS = 0.5;

const isDisliked = (o, prefs) => prefs && prefs.disliked.has(outfitKey(outfitItems(o).map((it) => it.id)));

// Shorts with a felt hat, sandals with a wool coat: warm-weather and
// cold-weather pieces never go together, whatever the forecast.
const mixesSeasons = (o) => {
  const list = outfitItems(o);
  return list.some((i) => i.weather === "warm") && list.some((i) => i.weather === "cold");
};

// Pick one of several outfits at random, favoring good color harmony and what
// the owner's ratings say they like (lower score = more likely).
function chooseWeighted(outfits, prefs) {
  const scored = outfits.map((o) => {
    const list = outfitItems(o);
    return { o, score: colorScore(list) - (prefs ? RATING_WEIGHT * preferenceScore(list, prefs) : 0) };
  });
  const lowest = Math.min(...scored.map((c) => c.score));
  const weights = scored.map((c) => Math.exp(-(c.score - lowest) / CHOOSINESS));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i++) if ((r -= weights[i]) <= 0) return scored[i].o;
  return scored[scored.length - 1].o;
}

// Try many combinations and pick a good one. `fixed`: pieces that must be in it.
function generateOutfit(items, occasionKey, fixed, prefs, w = null) {
  const occ = OCCASIONS[occasionKey];
  const candidates = [];
  let fallback = null; // used only if every combination tried was disliked before
  for (let i = 0; i < 60; i++) {
    const o = buildOnce(items, occ, fixed, w);
    if (!o) break;
    if (isDisliked(o, prefs) || mixesSeasons(o)) { fallback = fallback || o; continue; }
    candidates.push(o);
  }
  return candidates.length ? chooseWeighted(candidates, prefs) : fallback;
}

// ---------- Changing one piece ----------
const SLOTS = ["dress", "top", "bottom", "outerwear", "shoes", "bag"];

// Where an item sits in an outfit: { slot } or { accessoryIndex }.
function findPiece(outfit, itemId) {
  const slot = SLOTS.find((k) => outfit[k] && outfit[k].id === itemId);
  if (slot) return { slot, item: outfit[slot] };
  const accessoryIndex = (outfit.accessories || []).findIndex((a) => a.id === itemId);
  return accessoryIndex >= 0 ? { accessoryIndex, item: outfit.accessories[accessoryIndex] } : null;
}

function withPiece(outfit, where, item) {
  const o = { ...outfit, accessories: [...(outfit.accessories || [])] };
  if (where.slot) o[where.slot] = item;
  else if (item) o.accessories[where.accessoryIndex] = item;
  else o.accessories.splice(where.accessoryIndex, 1);
  if (where.slot && !item) delete o[where.slot];
  return o;
}

// Replace one piece with another of the same type that suits the occasion,
// favoring good matches. Returns null if there's no other choice.
function swapPiece(items, occasionKey, outfit, itemId, prefs, w = null) {
  const where = findPiece(outfit, itemId);
  if (!where) return null;
  const occ = OCCASIONS[occasionKey];
  const inOutfit = new Set(outfitItems(outfit).map((i) => i.id));
  const options = items.filter((i) => i.category === where.item.category && fits(i, occ) &&
    suitsWeather(i, w) && !inOutfit.has(i.id));
  const candidates = options.map((alt) => withPiece(outfit, where, alt)).filter((o) => !isDisliked(o, prefs) && !mixesSeasons(o));
  return candidates.length ? chooseWeighted(candidates, prefs) : null;
}

// Coats, bags and accessories can be left out; a dress, top, bottom or shoes can't.
const OPTIONAL = new Set(["outerwear", "bag", "accessory"]);
const canRemove = (item) => OPTIONAL.has(item.category);

function removePiece(outfit, itemId) {
  const where = findPiece(outfit, itemId);
  return where && canRemove(where.item) ? withPiece(outfit, where, null) : null;
}

// Explain what's missing when no outfit can be made.
function missingFor(items, occasionKey, fixed = [], w = null) {
  const occ = OCCASIONS[occasionKey];
  const p = pools(items, occ, fixed, w);
  const need = [];
  if (!p.canDress && !p.canSeparates) {
    if (p.fixedCats.has("top")) need.push("a bottom (pants or skirt)");
    else if (p.fixedCats.has("bottom")) need.push("a top");
    else need.push("a dress, or a top and a bottom");
  }
  if (!p.shoes.length) need.push("shoes");
  const range = occ.min === occ.max ? occ.min : `${occ.min}–${occ.max}`;
  return `For ${occ.label} you need items rated ${range} on "How dressy". Add ${need.join(" and ")} at that level.`;
}

// Turn a list of items (e.g. from a saved outfit) back into board slots.
function slotsFromItems(items) {
  const o = { accessories: [] };
  for (const it of items) {
    if (it.category === "accessory") o.accessories.push(it);
    else o[it.category] = it;
  }
  return o;
}

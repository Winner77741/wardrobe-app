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

function byCat(items, occ, cat) {
  return items.filter((i) => i.category === cat && fits(i, occ));
}

// The items available for each slot. If the user chose an item to "build
// around" (the anchor), its slot holds only that item, whatever the occasion.
function pools(items, occ, anchor) {
  const A = anchor ? anchor.category : null;
  const pool = (cat) => (A === cat ? [anchor] : byCat(items, occ, cat));
  const p = {
    dress: pool("dress"), top: pool("top"), bottom: pool("bottom"),
    shoes: pool("shoes"), outerwear: pool("outerwear"), bag: pool("bag"),
    accessory: byCat(items, occ, "accessory").filter((i) => !anchor || i.id !== anchor.id),
  };
  // A chosen top or bottom rules out a dress, and a chosen dress rules out separates.
  p.canDress = p.dress.length > 0 && A !== "top" && A !== "bottom";
  p.canSeparates = p.top.length > 0 && p.bottom.length > 0 && A !== "dress";
  return p;
}

// Build one candidate outfit (or null if the closet is missing a needed piece).
function buildOnce(items, occ, anchor) {
  const p = pools(items, occ, anchor);
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

  const A = anchor ? anchor.category : null;
  const outer = p.outerwear;
  if (outer.length && (A === "outerwear" || occ.outerwear || Math.random() < 0.3)) outfit.outerwear = pick(outer);

  if (p.bag.length) outfit.bag = pick(p.bag);

  const acc = p.accessory.sort(() => Math.random() - 0.5);
  outfit.accessories = A === "accessory"
    ? [anchor, ...acc].slice(0, Math.max(1, occ.accessories))
    : acc.slice(0, occ.accessories);
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

// Try many combinations, then pick one at random, favoring good color harmony
// and what the owner's ratings say they like (lower score = more likely).
function generateOutfit(items, occasionKey, anchor, prefs) {
  const occ = OCCASIONS[occasionKey];
  const candidates = [];
  let fallback = null; // used only if every combination tried was disliked before
  for (let i = 0; i < 60; i++) {
    const o = buildOnce(items, occ, anchor);
    if (!o) break;
    const list = outfitItems(o);
    if (prefs && prefs.disliked.has(outfitKey(list.map((it) => it.id)))) { fallback = fallback || o; continue; }
    const score = colorScore(list) - (prefs ? RATING_WEIGHT * preferenceScore(list, prefs) : 0);
    candidates.push({ o, score });
  }
  if (!candidates.length) return fallback;
  const lowest = Math.min(...candidates.map((c) => c.score));
  const weights = candidates.map((c) => Math.exp(-(c.score - lowest) / CHOOSINESS));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) if ((r -= weights[i]) <= 0) return candidates[i].o;
  return candidates[candidates.length - 1].o;
}

// Explain what's missing when no outfit can be made.
function missingFor(items, occasionKey, anchor) {
  const occ = OCCASIONS[occasionKey];
  const p = pools(items, occ, anchor);
  const A = anchor ? anchor.category : null;
  const need = [];
  if (!p.canDress && !p.canSeparates) {
    if (A === "top") need.push("a bottom (pants or skirt)");
    else if (A === "bottom") need.push("a top");
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

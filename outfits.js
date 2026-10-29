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

// Colors that go with almost anything. A shade of one ("light grey", "off
// white", "dark navy") is neutral too.
const NEUTRALS = new Set([
  "black", "white", "cream", "ivory", "beige", "tan", "camel", "grey", "gray",
  "navy", "brown", "denim", "nude", "gold", "silver", "khaki", "charcoal",
  "taupe", "stone", "ecru", "oatmeal", "chocolate", "bronze",
]);

// Bold colors in the same family look planned together (red with burgundy,
// blush with hot pink), so a family counts as one color.
const COLOR_FAMILIES = {
  red: ["red", "burgundy", "maroon", "wine", "crimson", "scarlet", "cherry", "oxblood", "rust"],
  pink: ["pink", "blush", "rose", "fuchsia", "magenta", "coral", "salmon"],
  orange: ["orange", "peach", "apricot", "terracotta", "tangerine"],
  yellow: ["yellow", "mustard", "lemon", "ochre"],
  green: ["green", "olive", "emerald", "sage", "mint", "forest", "lime", "teal"],
  blue: ["blue", "cobalt", "sky", "turquoise", "aqua", "royal", "indigo"],
  purple: ["purple", "lilac", "lavender", "plum", "violet", "mauve", "aubergine"],
};
const FAMILY_OF = new Map(Object.entries(COLOR_FAMILIES).flatMap(([family, shades]) => shades.map((c) => [c, family])));
const baseColor = (c) => String(c).toLowerCase().trim().split(/\s+/).pop(); // "light grey" → "grey"
const isNeutral = (c) => NEUTRALS.has(baseColor(c));
const colorFamily = (c) => FAMILY_OF.get(baseColor(c)) || baseColor(c);

// Patterned pieces (stripes, florals, prints…): two in one outfit usually clash.
const PATTERN_WORDS = /\b(stripe[sd]?|floral|flowers?|plaid|check(ed)?|tartan|gingham|polka|dots?|print(ed)?|leopard|zebra|snake|animal|paisley|houndstooth|camo(uflage)?|tie-?dye)\b/i;
const isPatterned = (item) => PATTERN_WORDS.test([item.name, ...(item.tags || [])].join(" "));

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function fits(item, occ) {
  return item.formality >= occ.min && item.formality <= occ.max;
}

// Fewer "statement" colors (and at most one patterned piece) = more
// harmonious. Lower score is better.
function colorScore(items) {
  const bold = new Set();
  for (const it of items) for (const c of it.colors) if (!isNeutral(c)) bold.add(colorFamily(c));
  const patterned = items.filter(isPatterned).length;
  return (bold.size <= 1 ? 0 : bold.size - 1) + Math.max(0, patterned - 1);
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

  // Accessories: at most one of each kind (one hat, one necklace…).
  const acc = p.accessory.filter(suits).sort(() => Math.random() - 0.5);
  const chosen = [...p.fixedAccessories];
  const kinds = new Set(chosen.map(accessoryKind));
  for (const a of acc) {
    if (chosen.length >= Math.max(p.fixedAccessories.length, occ.accessories)) break;
    if (kinds.has(accessoryKind(a))) continue;
    kinds.add(accessoryKind(a));
    chosen.push(a);
  }
  outfit.accessories = chosen;
  return outfit;
}

// What kind of accessory an item is, from its name (or tags): two of the same
// kind never go in one outfit. Anything not recognised is a kind of its own.
const ACCESSORY_KINDS = [
  ["earrings", /\b(earrings?|studs?|hoops?)\b/],
  ["necklace", /\b(necklace|pendant|choker|locket)\b/],
  ["bracelet", /\b(bracelet|bangle|cuff)\b/],
  ["ring", /\brings?\b/],
  ["watch", /\bwatch\b/],
  ["hat", /\b(hat|cap|beret|fedora|beanie|fascinator|headband|hair)\b/],
  ["scarf", /\b(scarf|shawl|stole|wrap|pashmina|bandana)\b/],
  ["belt", /\bbelt\b/],
  ["glasses", /\b(sunglasses|glasses)\b/],
  ["gloves", /\bgloves?\b/],
  ["brooch", /\b(brooch|pin)\b/],
  ["tie", /\b(tie|bow tie)\b/],
];
function accessoryKind(item) {
  for (const text of [item.name, (item.tags || []).join(" ")]) {
    const found = ACCESSORY_KINDS.find(([, re]) => re.test(String(text).toLowerCase()));
    if (found) return found[0];
  }
  return "item:" + item.id;
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

// Whole days between a date and today, in the owner's own time zone.
function daysSince(iso) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(new Date()) - day(new Date(iso))) / 86400000);
}

function learnPreferences(liked, disliked, wears = []) {
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
  // When each item was last worn (days ago).
  const lastWorn = new Map();
  for (const w of wears) {
    const days = daysSince(w.createdAt);
    for (const id of w.itemIds) if (!lastWorn.has(id) || days < lastWorn.get(id)) lastWorn.set(id, days);
  }
  return {
    pairs, lastWorn,
    disliked: new Set(disliked.map((o) => outfitKey(o.itemIds))),
    saved: new Set(liked.map((o) => outfitKey(o.itemIds))),
  };
}

// Pieces worn in the last week are suggested less: a lot if worn today,
// fading to nothing after 7 days. A nudge, not a ban (small closets need repeats).
const WEAR_DAYS = 7;
const WEAR_WEIGHT = 0.6;
function wornPenalty(list, prefs) {
  let total = 0;
  for (const i of list) {
    const days = prefs.lastWorn && prefs.lastWorn.get(i.id);
    if (days !== undefined && days < WEAR_DAYS) total += (WEAR_DAYS - days) / WEAR_DAYS;
  }
  return total;
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

const keyOf = (o) => outfitKey(outfitItems(o).map((it) => it.id));
const isDisliked = (o, prefs) => prefs && prefs.disliked.has(keyOf(o));
const isSaved = (o, prefs) => !!(prefs && prefs.saved && prefs.saved.has(keyOf(o)));

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
    return {
      o,
      score: colorScore(list) + (prefs ? WEAR_WEIGHT * wornPenalty(list, prefs) - RATING_WEIGHT * preferenceScore(list, prefs) : 0),
    };
  });
  const lowest = Math.min(...scored.map((c) => c.score));
  const weights = scored.map((c) => Math.exp(-(c.score - lowest) / CHOOSINESS));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i++) if ((r -= weights[i]) <= 0) return scored[i].o;
  return scored[scored.length - 1].o;
}

// Try many combinations and pick a good one. `fixed`: pieces that must be in it.
// If every combination tried was disliked before (or mixed warm and cold
// pieces), one is shown anyway, marked `fallback` so the page can say so.
// `shown` (the Create page passes it): outfits already shown since the occasion
// was picked. Then new outfits come first, saved ones only when nothing new is
// left, and a repeat only when everything was shown (marked `seenAll`).
function generateOutfit(items, occasionKey, fixed, prefs, w = null, shown = null) {
  const occ = OCCASIONS[occasionKey];
  const candidates = [];
  let fallback = null;
  // More tries when avoiding repeats, so rarer combinations are found too.
  for (let i = 0; i < (shown ? 200 : 60); i++) {
    const o = buildOnce(items, occ, fixed, w);
    if (!o) break;
    if (isDisliked(o, prefs)) { fallback = fallback || { ...o, fallback: "disliked" }; continue; }
    if (mixesSeasons(o)) { fallback = fallback || { ...o, fallback: "seasons" }; continue; }
    candidates.push(o);
  }
  if (!candidates.length) return fallback;
  if (!shown) return chooseWeighted(candidates, prefs);
  const unseen = candidates.filter((o) => !shown.has(keyOf(o)));
  const fresh = unseen.filter((o) => !isSaved(o, prefs));
  if (fresh.length) return chooseWeighted(fresh, prefs);
  if (unseen.length) return chooseWeighted(unseen, prefs);
  return { ...chooseWeighted(candidates, prefs), seenAll: true };
}

// How many different outfits the closet can make for an occasion (found by
// trying many combinations, so a very rare one may be missed), and how many of
// them are saved. Disliked ones and warm-with-cold mixes don't count.
function countOutfits(items, occasionKey, fixed, prefs, w = null) {
  const occ = OCCASIONS[occasionKey];
  const all = new Set();
  const saved = new Set();
  for (let i = 0; i < 1500; i++) {
    const o = buildOnce(items, occ, fixed, w);
    if (!o) break;
    if (isDisliked(o, prefs) || mixesSeasons(o)) continue;
    all.add(keyOf(o));
    if (isSaved(o, prefs)) saved.add(keyOf(o));
  }
  return { total: all.size, saved: saved.size };
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

// ---------- Trips ----------
// Plan one outfit per trip event so the suitcase stays small: each piece not
// already packed "costs" a little, and wearing the exact same outfit twice
// costs more. Color harmony, weather and ratings still count as usual.
const NEW_PIECE_COST = 0.9;
const REPEAT_COST = 2;

function planOne(items, entry, packed, usedKeys, prefs) {
  const occ = OCCASIONS[entry.occasion];
  const tryWith = (w) => {
    const found = [];
    for (let i = 0; i < 80; i++) {
      const o = buildOnce(items, occ, [], w);
      if (!o) break;
      if (!isDisliked(o, prefs) && !mixesSeasons(o)) found.push(o);
    }
    return found;
  };
  let candidates = tryWith(entry.w);
  let ignoredWeather = false;
  if (!candidates.length && entry.w) { candidates = tryWith(null); ignoredWeather = candidates.length > 0; }
  if (!candidates.length) return null;
  const scored = candidates.map((o) => {
    const list = outfitItems(o);
    const fresh = list.filter((i) => !packed.has(i.id)).length;
    const repeat = usedKeys.has(outfitKey(list.map((i) => i.id))) ? REPEAT_COST : 0;
    const rated = prefs ? RATING_WEIGHT * preferenceScore(list, prefs) : 0;
    return { o, score: colorScore(list) + NEW_PIECE_COST * fresh + repeat - rated };
  });
  const lowest = Math.min(...scored.map((c) => c.score));
  const weights = scored.map((c) => Math.exp(-(c.score - lowest) / 0.3)); // choosier than everyday outfits
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let pickIt = scored[scored.length - 1].o;
  for (let i = 0; i < scored.length; i++) if ((r -= weights[i]) <= 0) { pickIt = scored[i].o; break; }
  return { outfit: pickIt, ignoredWeather };
}

// entries: [{ day, occasion, w }] in trip order. Returns one plan per entry:
// { day, occasion, outfit (or null if the closet can't dress it), ignoredWeather }.
function planTrip(items, entries, prefs) {
  const packed = new Set();
  const usedKeys = new Set();
  return entries.map((entry) => {
    const got = planOne(items, entry, packed, usedKeys, prefs);
    if (got) {
      const ids = outfitItems(got.outfit).map((i) => i.id);
      ids.forEach((id) => packed.add(id));
      usedKeys.add(outfitKey(ids));
    }
    return { day: entry.day, occasion: entry.occasion, outfit: got && got.outfit, ignoredWeather: !!(got && got.ignoredWeather) };
  });
}

// A different outfit for one entry, still favoring pieces the rest of the trip packs.
function replanTripEntry(items, plans, index, entry, prefs) {
  const others = plans.filter((p, i) => i !== index && p.outfit);
  const packed = new Set(others.flatMap((p) => outfitItems(p.outfit).map((i) => i.id)));
  const usedKeys = new Set(others.map((p) => outfitKey(outfitItems(p.outfit).map((i) => i.id))));
  if (plans[index].outfit) usedKeys.add(outfitKey(outfitItems(plans[index].outfit).map((i) => i.id)));
  const got = planOne(items, entry, packed, usedKeys, prefs);
  return { day: entry.day, occasion: entry.occasion, outfit: got && got.outfit, ignoredWeather: !!(got && got.ignoredWeather) };
}

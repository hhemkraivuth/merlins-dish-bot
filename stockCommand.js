// ============================================================
// MERLIN'S DISH -- "left" / "setstock" STOCK COMMAND
// ============================================================
// This is the logic behind the private group stock commands, pulled out of server.js so it can be tested and so
// ONE message can update several dishes at once. It changes nothing about how a single dish is set: the rules for a
// whole dish, a size (rws l4 r7) or a pasta (bolo luma 3 riga 5) are exactly the ones that lived in server.js.
//
//   left tpb 3                      one dish (as before)
//   left rws 2l 2r                  sizes (as before)
//   left tpb 3, bolo 8, brocs 1     several dishes in one message, separated by commas
//   left                            or one dish per line, with "left" on its own first line:
//   tpb 3
//   bolo 8
//   noir 0
//
// A dish at 0 is sold out on the order app. A number above 0 puts it back on sale.
// In a several dish message, every dish word it knows is applied, and anything it does not know (for example a dish
// that only exists on Grab) is listed back as "not changed" so nothing is lost silently.

const SEPARATORS = /[\n,;]+/;

// Splits "tpb 3, bolo 8" into [{ word, rest }]. A piece that starts with a size or pasta word of the dish before it
// ("rws 2l, 2r" or "bolo luma 3, riga 5") belongs to that dish, not a new one.
function splitSegments(body, { MENU, resolveItemId, resolveVariantId }) {
  const pieces = String(body || "").split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const segments = [];
  for (const piece of pieces) {
    const words = piece.split(/\s+/);
    const first = words[0];
    // A piece like "2r" or "4l" (number first) can only be a size continuation, never a dish word.
    const prev = segments[segments.length - 1];
    if (prev) {
      const prevDish = MENU.find((d) => d.id === resolveItemId(prev.word, MENU));
      const wholeDishNumber = /^-?\d+$/.test(prev.rest.trim());
      const startsWithNumber = /^\d/.test(first);
      const firstWord = first.replace(/[^a-z]/gi, "");
      if (prevDish && !wholeDishNumber && prev.rest.trim() !== "" && (startsWithNumber || (firstWord && resolveVariantId(prevDish, firstWord)))) {
        prev.rest += ` ${piece}`;
        continue;
      }
    }
    segments.push({ word: first, rest: words.slice(1).join(" ") });
  }
  return segments;
}

// Parses everything after "left"/"setstock". Pure: nothing is changed here.
// Returns { segments } or { error }.
function parseBody(body, deps) {
  const segments = splitSegments(body, deps);
  if (!segments.length) return { error: 'Tell me the dish and how many are left, for example "left tpb 3" or "left tpb 3, bolo 8".' };
  return { segments };
}

// state: { stockCount: Map, soldOut: Set, variantStockCount: Map, soldOutVariants: Set }, variantKey(itemId, variantId)
function createStockCommand(env) {
  const { MENU, SIZE_OPTIONS, PASTA_OPTIONS, resolveItemId, resolveVariantId, variantKey, stockCount, soldOut, variantStockCount, soldOutVariants } = env;

  // Works out what one dish's change would be, without applying it. Returns { error } or { apply(), summary, name }.
  function planOne(dish, restRaw) {
    const rest = String(restRaw || "").toLowerCase().trim();
    // Whole dish: just a number.
    if (/^-?\d+$/.test(rest)) {
      const n = Math.max(0, parseInt(rest, 10));
      return {
        name: dish.name,
        summary: n <= 0 ? `${dish.name} sold out` : `${dish.name} ${n}`,
        apply() {
          stockCount.set(dish.id, n);
          if (n <= 0) soldOut.add(dish.id);
          else soldOut.delete(dish.id);
          return `"${dish.id}" stock set to ${n}.`;
        },
      };
    }

    // One or more "<size or pasta> <number>" pairs, spaces optional.
    const pairRe = /([a-z]+)\s*[:=]?\s*(-?\d+)|(-?\d+)\s*([a-z]+)/g;
    const pairs = [...rest.matchAll(pairRe)];
    const leftover = rest.replace(pairRe, "").replace(/[\s,]+/g, "");
    const usage = dish.requiresSize
      ? `"setstock ${dish.id} l4 r7" (sizes) or "setstock ${dish.id} 10" (whole dish)`
      : dish.requiresPasta
      ? `"setstock ${dish.id} luma 3 riga 5" (pastas) or "setstock ${dish.id} 10" (whole dish)`
      : `"setstock ${dish.id} 10"`;
    if (!pairs.length || leftover) return { error: `I couldn't read that. Try ${usage}.` };
    if (!dish.requiresSize && !dish.requiresPasta) {
      return { error: `"${dish.id}" doesn't have separate sizes or pasta choices. Use "setstock ${dish.id} 10" to set the whole dish.` };
    }

    // Resolve every pair first, so a typo in one never leaves the others half applied.
    const variantList = dish.requiresSize ? SIZE_OPTIONS : PASTA_OPTIONS;
    const resolved = [];
    const unknown = [];
    for (const m of pairs) {
      // Either order works: "l4" or "4l", "large 4" or "4 large".
      const word = m[1] || m[4];
      const num = m[2] || m[3];
      const variantId = resolveVariantId(dish, word);
      const validVariant = variantId ? variantList.find((v) => v.id === variantId) : null;
      if (!validVariant) unknown.push(word);
      else resolved.push({ variant: validVariant, n: Math.max(0, parseInt(num, 10)) });
    }
    if (unknown.length) {
      return { error: `"${dish.id}" doesn't have a choice called ${unknown.map((u) => `"${u}"`).join(", ")}. Valid choices: ${variantList.map((v) => v.id).join(", ")}. Nothing was changed.` };
    }
    const summary = resolved.map((r) => `${r.variant.name} ${r.n}`).join(", ");
    return {
      name: dish.name,
      summary: `${dish.name} (${summary})`,
      apply() {
        let clearedWholeDish = false;
        for (const { variant, n } of resolved) {
          const key = variantKey(dish.id, variant.id);
          variantStockCount.set(key, n);
          if (n <= 0) soldOutVariants.add(key);
          else soldOutVariants.delete(key);
        }
        // Setting stock above zero for any size/pasta means the dish is on sale again, so lift an earlier
        // whole-dish "sold out" mark or zero count.
        if (resolved.some((r) => r.n > 0)) {
          if (soldOut.has(dish.id)) { soldOut.delete(dish.id); clearedWholeDish = true; }
          if (stockCount.has(dish.id) && stockCount.get(dish.id) <= 0) { stockCount.delete(dish.id); clearedWholeDish = true; }
        }
        return `"${dish.name}" stock set: ${summary}.${clearedWholeDish ? " The earlier sold out mark on the whole dish was cleared." : ""}`;
      },
    };
  }

  // body = everything after "left" / "setstock". Returns the reply text.
  function run(body) {
    const parsed = parseBody(body, { MENU, resolveItemId, resolveVariantId });
    if (parsed.error) return parsed.error;
    const { segments } = parsed;

    // ONE dish: exactly the old behaviour and the old wording.
    if (segments.length === 1) {
      const { word, rest } = segments[0];
      const itemId = resolveItemId(word, MENU);
      const dish = itemId ? MENU.find((d) => d.id === itemId) : null;
      if (!dish) return `Unknown item id "${word}". Text "stock" to see valid ids.`;
      const plan = planOne(dish, rest);
      return plan.error ? plan.error : plan.apply();
    }

    // SEVERAL dishes: plan every one first, then apply the ones that are understood.
    const done = [];
    const skipped = [];
    const plans = [];
    for (const { word, rest } of segments) {
      const itemId = resolveItemId(word, MENU);
      const dish = itemId ? MENU.find((d) => d.id === itemId) : null;
      if (!dish) { skipped.push(`${word}: not a dish on the order app`); continue; }
      const plan = planOne(dish, rest);
      if (plan.error) { skipped.push(`${word}: ${plan.error}`); continue; }
      plans.push(plan);
    }
    for (const p of plans) { p.apply(); done.push(p.summary); }
    const lines = [];
    if (done.length) lines.push(`Order app stock updated (${done.length}):\n${done.join("\n")}`);
    else lines.push("Nothing was changed on the order app.");
    if (skipped.length) lines.push(`Not changed:\n${skipped.join("\n")}`);
    return lines.join("\n\n");
  }

  return { run };
}

// Does this text look like a stock "left" command? Handles "left tpb 3, bolo 8" and the "left" + new lines form.
// Returns the body after the keyword, or null.
function stockBody(text) {
  const m = /^(left|setstock)\b[\s:]*([\s\S]*)$/i.exec(String(text || "").trim());
  if (!m) return null;
  return m[2].trim() ? m[2] : null;
}

module.exports = { createStockCommand, stockBody, splitSegments, parseBody };

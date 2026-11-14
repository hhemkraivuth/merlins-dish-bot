// Per size counts for the menu feed, so BOH can show Regular and Large separately instead of one total.
// variantList: SIZE_OPTIONS or PASTA_OPTIONS ({ id, name }), counts: the order app's variantStockCount map ("item:variant" -> n).
// Returns [{ id, name, left }] for the variants that have a count set, or [] when none do.
function variantRemainingList(variantList, itemId, counts) {
  const out = [];
  for (const v of variantList || []) {
    const key = `${itemId}:${v.id}`;
    if (counts && counts.has(key)) out.push({ id: v.id, name: v.name, left: Math.max(0, Number(counts.get(key)) || 0) });
  }
  return out;
}
module.exports = { variantRemainingList };

function applyDynamicDropWireCharges({ pkg, customer, isRechargeable, otcItems = [], baseAmount = 0 }) {
  const meters = Number(customer?.dropWireMeters || 0);
  if (isRechargeable || customer?.isFree || !pkg || meters <= 0) {
    return { packagePrice: baseAmount, otcItems };
  }

  let customPrices = {};
  try {
    if (pkg.addonPricesJson) customPrices = JSON.parse(pkg.addonPricesJson);
  } catch {}

  const charges = Array.isArray(pkg.oneTimeCharges) ? pkg.oneTimeCharges : [];
  const dynamicCharges = charges.filter(c => Boolean(c.isDropWireDynamic));
  if (dynamicCharges.length === 0) {
    return { packagePrice: baseAmount, otcItems };
  }

  const hasInitialConfigured = pkg.initialTotalWithTax !== null && pkg.initialTotalWithTax !== undefined;
  let extraWithTax = 0;
  const updatedOtcItems = [...otcItems];

  for (const charge of dynamicCharges) {
    const rate = customPrices[String(charge.id)] !== undefined
      ? Number(customPrices[String(charge.id)])
      : Number(charge.amount || 0);
    if (rate <= 0) continue;

    const dynamicNet = Math.round(rate * meters * 100) / 100;
    const taxMult = charge.isTaxable !== false ? 1.13 : 1;
    const deltaNet = hasInitialConfigured ? (dynamicNet - rate) : dynamicNet;
    extraWithTax += deltaNet * taxMult;

    const idx = updatedOtcItems.findIndex(it => Number(it.id) === Number(charge.id));
    const label = `${charge.name || 'Drop Wire'} (${meters}m @ Rs. ${rate}/m)`;
    if (idx >= 0) {
      updatedOtcItems[idx] = { ...updatedOtcItems[idx], name: label, amount: dynamicNet };
    } else {
      updatedOtcItems.push({
        id: charge.id,
        name: label,
        referenceId: charge.referenceId || null,
        amount: dynamicNet
      });
    }
  }

  const packagePrice = Math.max(0, Math.round((Number(baseAmount || 0) + extraWithTax) * 100) / 100);
  return { packagePrice, otcItems: updatedOtcItems };
}

module.exports = { applyDynamicDropWireCharges };

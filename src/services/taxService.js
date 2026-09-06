/**
 * taxService.js
 * Calculates tax breakdown for a single order item with support for both
 * tax-exclusive and tax-inclusive selling prices.
 */

function normalizeTaxRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) > 1 ? value / 100 : value;
}

function calculateItemPriceBreakdown(sellingPrice, taxClass, priceType = 'exclusive') {
  const configuredPrice = Number(sellingPrice) || 0;
  const normalizedType = String(priceType || 'exclusive').toLowerCase();
  const taxes = Array.isArray(taxClass?.taxes) ? taxClass.taxes : [];

  if (taxes.length === 0) {
    return {
      sellingPrice: configuredPrice,
      basePrice: configuredPrice,
      finalPrice: configuredPrice,
      taxTotal: 0,
      taxes: [],
    };
  }

  const taxEntries = taxes.map(({ tax }) => ({
    taxId: tax.id,
    taxName: tax.name,
    rate: Number(tax.rate) || 0,
    rateDecimal: normalizeTaxRate(tax.rate),
  }));

  const totalRate = taxEntries.reduce((sum, entry) => sum + entry.rateDecimal, 0);
  const isInclusive = normalizedType === 'inclusive' || normalizedType === 'tax_inclusive';
  const basePrice = isInclusive ? configuredPrice / (1 + totalRate || 1) : configuredPrice;

  const taxLines = taxEntries.map((entry) => {
    const amount = basePrice * entry.rateDecimal;
    return {
      taxId: entry.taxId,
      taxName: entry.taxName,
      rate: entry.rate,
      rateDecimal: entry.rateDecimal,
      taxAmount: amount,
    };
  });

  const taxTotal = taxLines.reduce((sum, line) => sum + line.taxAmount, 0);
  const finalPrice = isInclusive ? configuredPrice : basePrice + taxTotal;

  return {
    sellingPrice: configuredPrice,
    basePrice,
    finalPrice,
    taxTotal,
    taxes: taxLines,
  };
}

/**
 * @param {number} sellingPrice
 * @param {number} qty
 * @param {object|null} taxClass — PosMenuItem.taxClass with nested taxes[]
 * @param {string} priceType — 'exclusive' or 'inclusive'
 * @returns {Array<{ taxId, taxName, rate, perUnit, totalAmount }>}
 */
function calculateItemTaxes(sellingPrice, qty, taxClass, priceType = 'exclusive') {
  const breakdown = calculateItemPriceBreakdown(sellingPrice, taxClass, priceType);
  const quantity = Number(qty) || 0;

  return breakdown.taxes.map((line) => ({
    taxId: line.taxId,
    taxName: line.taxName,
    rate: line.rate,
    perUnit: line.taxAmount,
    totalAmount: line.taxAmount * quantity,
  }));
}

module.exports = { calculateItemPriceBreakdown, calculateItemTaxes };

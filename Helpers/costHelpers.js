const Recipe = require("../models/Recipe");
const Product = require("../models/Product");
const logger = require("../logger");

/**
 * Compute the unit cost of a single product.
 *
 * Returns:
 *   null                -> no recipe for this product (cost unknown)
 *   { cost, breakdown } -> cost in TND, breakdown per raw material
 *
 * Uses CURRENT rawMaterial.costPerUnit values. Only call this at
 * order-creation time (to snapshot) or as a fallback for old orders.
 */
exports.computeProductUnitCost = async (productId, session = null) => {
  if (!productId) return null;

  const query = Recipe.findOne({ product: productId })
    .populate({
      path: "rawMaterials.rawMaterial",
      model: "RawMaterial",
      select: "name unit costPerUnit",
    })
    .lean();

  if (session) query.session(session);

  const recipe = await query;

  if (
    !recipe ||
    !Array.isArray(recipe.rawMaterials) ||
    recipe.rawMaterials.length === 0
  ) {
    return null;
  }

  const breakdown = [];
  let total = 0;

  for (const entry of recipe.rawMaterials) {
    const rm = entry.rawMaterial;
    if (!rm) continue;

    const unitCost = Number(rm.costPerUnit) || 0;
    const qty = Number(entry.quantityPerUnit) || 0;
    const lineCost = unitCost * qty;

    total += lineCost;

    breakdown.push({
      rawMaterialId: rm._id,
      rawMaterialName: rm.name,
      unit: rm.unit,
      quantityPerUnit: qty,
      costPerUnit: unitCost,
      lineCost,
    });
  }

  return {
    cost: parseFloat(total.toFixed(4)),
    breakdown,
  };
};

/**
 * Build the per-line cost snapshot for a product at the current moment.
 *
 * Returns:
 *   { unitCost, costBreakdown, costSnapshotAt }  -- when a recipe exists
 *   { unitCost: null, costBreakdown: [], costSnapshotAt: null }  -- no recipe
 */
exports.buildProductCostSnapshot = async (productId, session = null) => {
  const info = await exports.computeProductUnitCost(productId, session);

  if (!info) {
    return {
      unitCost: null,
      costBreakdown: [],
      costSnapshotAt: null,
    };
  }

  return {
    unitCost: info.cost,
    costBreakdown: info.breakdown,
    costSnapshotAt: new Date(),
  };
};

/**
 * Compute the effective sell price for a product after discount.
 */
exports.computeSellPrice = (product) => {
  if (!product) return 0;
  const price = Number(product.price) || 0;
  const discount = Number(product.discountPercentage) || 0;
  if (discount <= 0) return price;
  return parseFloat((price * (1 - discount / 100)).toFixed(4));
};

/**
 * Compute the totals for a single order.
 *
 * Prefers the order's own snapshot (item.unitCost + costSnapshotAt).
 * Falls back to computing cost from current prices ONLY for old orders
 * that have no snapshot. The response includes `fromSnapshot` per line
 * so callers know which path was used.
 */
exports.computeOrderCost = async (
  order,
  session = null,
  productCache = null,
) => {
  const perProduct = [];
  const excludedProductIds = [];
  let revenue = 0;
  let cost = 0;

  for (const item of order.products || []) {
    const productId = item.productDetails?._id ?? item.product;
    const qty = Number(item.quantity) || 0;

    if (!productId) {
      excludedProductIds.push(null);
      continue;
    }

    // ── Determine unit price (snapshot first, then current) ──
    let unitPrice = Number(item.productDetails?.price) || 0;

    // ── Determine unit cost (snapshot first, then compute) ──
    let unitCost = null;
    let fromSnapshot = false;

    if (item.unitCost != null && item.costSnapshotAt) {
      unitCost = Number(item.unitCost);
      fromSnapshot = true;
    } else {
      // fallback for pre-snapshot orders
      let cacheEntry = productCache?.get(String(productId));
      if (!cacheEntry) {
        const product = await Product.findById(productId).lean();
        const costInfo = await exports.computeProductUnitCost(
          productId,
          session,
        );
        cacheEntry = {
          product,
          cost: costInfo?.cost ?? null,
          breakdown: costInfo?.breakdown ?? null,
        };
        productCache?.set(String(productId), cacheEntry);
      }

      if (!unitPrice) {
        unitPrice = Number(cacheEntry.product?.price) || 0;
        const discount = Number(cacheEntry.product?.discountPercentage) || 0;
        if (discount > 0) {
          unitPrice = parseFloat((unitPrice * (1 - discount / 100)).toFixed(4));
        }
      }

      unitCost = cacheEntry.cost;
    }

    const lineRevenue = unitPrice * qty;
    const lineCost = unitCost != null ? unitCost * qty : null;

    revenue += lineRevenue;
    if (lineCost != null) {
      cost += lineCost;
    } else {
      excludedProductIds.push(productId);
    }

    perProduct.push({
      productId,
      productName: item.productDetails?.name || "Unknown",
      quantity: qty,
      unitPrice,
      lineRevenue: parseFloat(lineRevenue.toFixed(4)),
      unitCost,
      lineCost: lineCost != null ? parseFloat(lineCost.toFixed(4)) : null,
      unitProfit:
        lineCost != null ? parseFloat((unitPrice - unitCost).toFixed(4)) : null,
      lineProfit:
        lineCost != null
          ? parseFloat((lineRevenue - lineCost).toFixed(4))
          : null,
      hasRecipe: unitCost != null,
      fromSnapshot,
    });
  }

  const profit = revenue - cost;
  const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

  return {
    revenue: parseFloat(revenue.toFixed(4)),
    cost: parseFloat(cost.toFixed(4)),
    profit: parseFloat(profit.toFixed(4)),
    marginPercent: parseFloat(marginPercent.toFixed(2)),
    perProduct,
    excludedProductIds,
  };
};

/**
 * Compute totals for a set of orders.
 * Reuses a single productCache across all orders for speed.
 */
exports.computeOrdersCost = async (orders, session = null) => {
  const productCache = new Map();
  const ordersOutput = [];
  const allExcluded = new Set();

  let totalRevenue = 0;
  let totalCost = 0;

  for (const order of orders) {
    const r = await exports.computeOrderCost(order, session, productCache);

    totalRevenue += r.revenue;
    totalCost += r.cost;
    r.excludedProductIds.forEach((id) => id && allExcluded.add(String(id)));

    ordersOutput.push({
      orderId: order._id,
      revenue: r.revenue,
      cost: r.cost,
      profit: r.profit,
      marginPercent: r.marginPercent,
      perProduct: r.perProduct,
    });
  }

  const totalProfit = totalRevenue - totalCost;
  const marginPercent =
    totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return {
    orderCount: orders.length,
    revenue: parseFloat(totalRevenue.toFixed(4)),
    cost: parseFloat(totalCost.toFixed(4)),
    profit: parseFloat(totalProfit.toFixed(4)),
    marginPercent: parseFloat(marginPercent.toFixed(2)),
    excludedProductIds: Array.from(allExcluded),
    orders: ordersOutput,
  };
};

const Inventory = require("../models/Inventory");
const Recipe = require("../models/Recipe");
const logger = require("../logger");

/**
 * Consume inventory for a single order.
 *
 * Contract:
 *   - The CALLER is responsible for saving the order afterward.
 *   - This function NEVER calls order.save().
 *   - If order.inventoryConsumed is already true, returns { skipped: true }
 *     and does nothing. This guarantees single-decrement per order.
 *
 * Returns:
 *   {
 *     skipped?: true,                          // already consumed, nothing done
 *     consumed?: true,                         // successful first-time consume
 *     warnings: string[],                      // non-fatal issues (missing recipe, etc.)
 *     insufficientMaterials: string[],         // kept for backward compat with frontend
 *     deficits: [{                             // materials that ran short
 *       rawMaterialId, rawMaterialName, unit,
 *       needed, available, deficit, consumedAt
 *     }]
 *   }
 */
exports.decrementForOrder = async (order, session) => {
  const warnings = [];
  const insufficientMaterials = [];
  const deficits = [];

  // ── Idempotency guard ─────────────────────────────────────
  if (order.inventoryConsumed === true) {
    logger.info(
      `[INVENTORY] Order ${order._id} already consumed inventory — skipping`,
    );
    return { skipped: true, warnings, insufficientMaterials, deficits };
  }

  for (const item of order.products) {
    const productDetails = item.productDetails;
    const orderQty = item.quantity;

    // Prefer the embedded snapshot (survives product deletion),
    // fall back to the product reference if the snapshot is missing.
    const productId = productDetails?._id ?? item.product;
    const productName = productDetails?.name ?? "Unnamed product";

    if (!productId) {
      warnings.push("Product reference missing for one item");
      continue;
    }

    // ── Load recipe for this product ──────────────────────────
    const recipe = await Recipe.findOne({ product: productId })
      .populate({
        path: "rawMaterials.rawMaterial",
        model: "RawMaterial",
        select: "name unit",
      })
      .session(session)
      .lean();

    if (!recipe) {
      warnings.push(`No recipe defined for ${productName}`);
      continue;
    }

    if (
      !Array.isArray(recipe.rawMaterials) ||
      recipe.rawMaterials.length === 0
    ) {
      warnings.push(`Recipe for ${productName} has no raw materials`);
      continue;
    }

    // ── For each raw material, compute and consume ────────────
    for (const entry of recipe.rawMaterials) {
      const rm = entry.rawMaterial;
      if (!rm || !rm._id) {
        warnings.push(
          `Missing raw material reference in recipe for ${productName}`,
        );
        continue;
      }

      const rmId = rm._id;
      const rmName = rm.name || "Unnamed material";
      const rmUnit = rm.unit || "";

      const inv = await Inventory.findOne({ rawMaterial: rmId }).session(
        session,
      );

      if (!inv) {
        warnings.push(`Inventory record missing for ${rmName}`);
        continue;
      }

      const toRemove = entry.quantityPerUnit * orderQty;
      const available = inv.currentQuantity;

      // ── Sufficient stock: subtract normally ───────────────
      if (available >= toRemove) {
        inv.currentQuantity = available - toRemove;
        await inv.save({ session });
        continue;
      }

      // ── Insufficient stock: clamp to zero, record deficit ──
      const deficitAmount = toRemove - available;

      inv.currentQuantity = 0;
      await inv.save({ session });

      const deficitEntry = {
        rawMaterialId: rmId,
        rawMaterialName: rmName,
        unit: rmUnit,
        needed: toRemove,
        available,
        deficit: deficitAmount,
        consumedAt: new Date(),
      };

      deficits.push(deficitEntry);
      insufficientMaterials.push(rmName);

      logger.warn(
        `[INVENTORY] Deficit for ${rmName}: needed ${toRemove} ${rmUnit}, ` +
          `available ${available} ${rmUnit}, deficit ${deficitAmount} ${rmUnit} ` +
          `(order ${order._id}, product ${productName})`,
      );
    }
  }

  return {
    consumed: true,
    warnings,
    insufficientMaterials,
    deficits,
  };
};

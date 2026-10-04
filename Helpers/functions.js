const Inventory = require("../models/Inventory");
const Recipe = require("../models/Recipe");

exports.decrementForOrder = async (order, session) => {
  const warnings = [];
  const insufficientMaterials = [];

  for (const { productDetails, quantity: orderQty } of order.products) {
    // 1) Fetch the single Recipe doc for this product
    const id = productDetails._id;
    const name = productDetails.name;
    const recipe = await Recipe.findOne({ product: id })
      .populate({
        path: "rawMaterials.rawMaterial", // <— populate the nested field
        model: "RawMaterial", // <— specify the model (optional if ref is set)
        select: "name", // <— only pull back the fields you need
      })
      .session(session)
      .lean();
    if (!recipe) {
      warnings.push(`No recipe defined for ${name}`);
      continue; // Skip to next product
    }

    // 2) Loop through each rawMaterial entry
    for (const { rawMaterial, quantityPerUnit } of recipe.rawMaterials) {
      // 3) Load & lock the Inventory record
      const inv = await Inventory.findOne({ rawMaterial }).session(session);
      if (!inv) {
        warnings.push(`Inventory record missing for ${rawMaterial.name}`);
        continue; // Skip to next material
      }

      // 4) Compute how much to remove
      const toRemove = quantityPerUnit * orderQty;

      // 5) Check for stock sufficiency
      if (inv.currentQuantity < toRemove) {
        warnings.push(`Insufficient stock for ${rawMaterial.name}`);
        // insufficientMaterials.push(rawMaterial.name);
        continue; // Skip decrementing this material
      }

      // 6) Decrement & save
      inv.currentQuantity -= toRemove;
      await inv.save({ session });
    }
  }

  return {
    warnings,
    // insufficientMaterials
  };
};

const RawMaterial = require("../models/RawMaterial");
const Inventory = require("../models/Inventory");

exports.createRawMaterial = async (req, res) => {
  try {
    const { name, unit, costPerUnit, reorderLevel } = req.body;
    const userId = req.superClientId;

    if (!unit || !costPerUnit || !reorderLevel) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (costPerUnit <= 0 || reorderLevel < 0) {
      return res.status(400).json({ error: "Invalid cost or reorder level" });
    }

    const rawMaterial = new RawMaterial({
      userId,
      name,
      unit,
      costPerUnit,
      reorderLevel,
    });
    await rawMaterial.save();

    const inventory = new Inventory({
      userId,
      rawMaterial: rawMaterial._id,
      currentQuantity: 0,
    });
    await inventory.save();

    res.status(201).json(rawMaterial);
  } catch (error) {
    // if (error.code === 11000) {
    //   return res.status(400).json({ error: 'Raw material name already exists' });
    // }
    res.status(500).json({ error: error.message });
  }
};

exports.getAllRawMaterials = async (req, res) => {
  try {
    const userId = req.superClientId;
    const rawMaterials = await RawMaterial.find({ userId }).sort({
      createdAt: -1,
    });

    // Attach a recipe usage count so the UI can warn before delete.
    const Recipe = require("../models/Recipe");
    const withCounts = await Promise.all(
      rawMaterials.map(async (rm) => {
        const usedInRecipes = await Recipe.countDocuments({
          "rawMaterials.rawMaterial": rm._id,
        });
        return { ...rm.toObject(), usedInRecipes };
      }),
    );

    res.json(withCounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRawMaterialById = async (req, res) => {
  try {
    const rawMaterial = await RawMaterial.findById(req.params.id);
    if (rawMaterial) {
      return res.status(404).json({ error: "Raw material not found" });
    }
    res.json(rawMaterial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateRawMaterial = async (req, res) => {
  try {
    const { name, unit, costPerUnit, reorderLevel } = req.body;
    if (costPerUnit == undefined && costPerUnit <= 0) {
      return res.status(400).json({ error: "Cost per unit must be positive" });
    }
    if (reorderLevel == undefined && reorderLevel < 0) {
      return res
        .status(400)
        .json({ error: "Reorder level cannot be negative" });
    }
    const rawMaterial = await RawMaterial.findByIdAndUpdate(
      req.params.id,
      { name, unit, costPerUnit, reorderLevel },
      { new: true, runValidators: true },
    );
    if (!rawMaterial) {
      return res.status(404).json({ error: "Raw material not found" });
    }
    res.json(rawMaterial);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ error: "Raw material name already exists" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.deleteRawMaterial = async (req, res) => {
  try {
    const rawMaterial = await RawMaterial.findByIdAndDelete(req.params.id);
    if (!rawMaterial) {
      return res.status(404).json({ error: "Raw material not found" });
    }
    await Inventory.findOneAndDelete({ rawMaterial: req.params.id });
    res.json({ message: "Raw material deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

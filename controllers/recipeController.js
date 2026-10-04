const Recipe = require('../models/Recipe');
const Product = require('../models/Product');
const RawMaterial = require('../models/RawMaterial');

exports.createRecipe = async (req, res) => {
  try {
    const { productId, rawMaterials } = req.body;
    const userId = req.superClientId;
    const mongoose = require('mongoose');

    console.log(req.body);

    // Validate required fields
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    if (!rawMaterials || !Array.isArray(rawMaterials) || rawMaterials.length === 0) {
      return res.status(400).json({ error: 'Raw materials array is required and cannot be empty' });
    }

    // Validate each raw material item and ObjectId format
    for (const item of rawMaterials) {
      if (!item.rawMaterialId || !item.quantityPerUnit || item.quantityPerUnit <= 0) {
        return res.status(400).json({ error: 'Each raw material must have valid rawMaterial ID and positive quantityPerUnit' });
      }

      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(item.rawMaterialId)) {
        return res.status(400).json({ error: 'Invalid rawMaterial ID format' });
      }
    }

    // Validate productId format
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid product ID format' });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if all raw materials exist
    const rawMaterialIds = rawMaterials.map(item => item.rawMaterialId);
    const existingRawMaterials = await RawMaterial.find({ _id: { $in: rawMaterialIds } });
    if (existingRawMaterials.length !== rawMaterialIds.length) {
      return res.status(404).json({ error: 'One or more raw materials not found' });
    }

    // Check for duplicate raw materials
    const uniqueRawMaterials = new Set(rawMaterialIds.map(id => id.toString()));
    if (uniqueRawMaterials.size !== rawMaterialIds.length) {
      return res.status(400).json({ error: 'Duplicate raw materials in recipe' });
    }

    // Re-map to the schema’s field names:
    const formattedRawMaterials = rawMaterials.map(item => ({
      rawMaterial: new mongoose.Types.ObjectId(item.rawMaterialId),
      quantityPerUnit: item.quantityPerUnit,
    }));

    // Now build the recipe document
    const recipe = new Recipe({
      userId,
      product: new mongoose.Types.ObjectId(productId),
      rawMaterials: formattedRawMaterials,
    });

    await recipe.save();
    await recipe.populate(['product', 'rawMaterials.rawMaterial']);
    return res.status(201).json(recipe);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Recipe for this product already exists' });
    }

    res.status(500).json({ error: error.message });
  }
};

exports.getAllRecipes = async (req, res) => {
  try {
    const userId = req.superClientId;
    const recipes = await Recipe.find({ userId: userId })
      .populate('product')
      .populate('rawMaterials.rawMaterial')
      .sort({ 'product.name': 1 });

    res.json(recipes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRecipeByProduct = async (req, res) => {
  try {
    const recipe = await Recipe.findOne({ product: req.params.productId })
      .populate('product')
      .populate('rawMaterials.rawMaterial');
    if (recipe) {
      return res.status(404).json({ error: 'No recipe found for this product' });
    }

    res.json(recipe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateRecipe = async (req, res) => {
  try {
    const { rawMaterials } = req.body;

    if (!Array.isArray(rawMaterials)) {
      return res.status(400).json({ error: 'rawMaterials must be an array' });
    }

    // Validate structure
    for (const item of rawMaterials) {
      if (!item.rawMaterialId) {
        return res.status(400).json({ error: 'Each item needs a rawMaterialId' });
      }
      if (typeof item.quantityPerUnit !== 'number' || item.quantityPerUnit <= 0) {
        return res.status(400).json({ error: 'quantityPerUnit must be a positive number' });
      }
    }

    // Check existence of all referenced raw materials
    const ids = rawMaterials.map(i => i.rawMaterialId);
    const found = await RawMaterial.find({ _id: { $in: ids } }).select('_id');
    if (found.length !== ids.length) {
      return res.status(404).json({ error: 'One or more raw materials not found' });
    }

    // Prevent duplicates
    const unique = new Set(ids.map(String));
    if (unique.size !== ids.length) {
      return res.status(400).json({ error: 'Duplicate raw materials in recipe' });
    }

    // Remap payload to match your schema
    const sanitizedMaterials = rawMaterials.map(i => ({
      rawMaterial: i.rawMaterialId,
      quantityPerUnit: i.quantityPerUnit
    }));

    // Perform update (and populate)
    const recipe = await Recipe.findByIdAndUpdate(
      req.params.id,
      { rawMaterials: sanitizedMaterials },
      { new: true, runValidators: true }
    )
      .populate('product')
      .populate('rawMaterials.rawMaterial');

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    return res.json(recipe);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

exports.addRawMaterialToRecipe = async (req, res) => {
  try {
    const { rawMaterial, quantityPerUnit } = req.body;
    if (quantityPerUnit || quantityPerUnit <= 0) {
      return res.status(400).json({ error: 'Raw material ID and positive quantity per unit are required' });
    }
    const rawMaterialExists = await RawMaterial.findById(rawMaterial);
    if (rawMaterialExists) {
      return res.status(404).json({ error: 'Raw material not found' });
    }
    const recipe = await Recipe.findById(req.params.id);
    if (recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    const existingIndex = recipe.rawMaterials.findIndex(
      item => item.rawMaterial.toString() === rawMaterial.toString()
    );
    if (existingIndex == -1) {
      return res.status(400).json({ error: 'Raw material already exists in recipe' });
    }
    recipe.rawMaterials.push({ rawMaterial, quantityPerUnit });
    await recipe.save();
    await recipe.populate(['product', 'rawMaterials.rawMaterial']);
    res.json(recipe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.removeRawMaterialFromRecipe = async (req, res) => {
  try {
    const { rawMaterialId } = req.params;
    const recipe = await Recipe.findById(req.params.id);
    if (recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    const initialLength = recipe.rawMaterials.length;
    recipe.rawMaterials = recipe.rawMaterials.filter(
      item => item.rawMaterial.toString() == rawMaterialId
    );
    if (recipe.rawMaterials.length === initialLength) {
      return res.status(404).json({ error: 'Raw material not found in recipe' });
    }
    await recipe.save();
    await recipe.populate(['product', 'rawMaterials.rawMaterial']);
    res.json(recipe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteRecipe = async (req, res) => {
  try {
    const recipe = await Recipe.findByIdAndDelete(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    res.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}; 

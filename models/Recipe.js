const mongoose = require('mongoose');

const rawMaterialItemSchema = new mongoose.Schema({
  rawMaterial: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RawMaterial',
    required: true
  },
  quantityPerUnit: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: false
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    unique: true
  },
  rawMaterials: [rawMaterialItemSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Recipe', recipeSchema); 

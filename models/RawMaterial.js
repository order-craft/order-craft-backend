const mongoose = require('mongoose');

const rawMaterialSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: false
  },
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  costPerUnit: {
    type: Number,
    required: true,
    min: 0
  },
  reorderLevel: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  timestamps: true
});

// Pre-hook on findOneAndDelete (covers findByIdAndDelete too)
rawMaterialSchema.pre('findOneAndDelete', async function (next) {
  // `this` is the Query
  const id = this.getQuery()._id;
  const Recipe = require('./Recipe');

  // Count recipes that include this rawMaterial
  const count = await Recipe.countDocuments({
    'rawMaterials.rawMaterial': id
  });

  if (count > 0) {
    return next(new Error(
      `Cannot delete raw material – it’s still used in ${count} recipe(s)`
    ));
  }
  next();
});

module.exports = mongoose.model('RawMaterial', rawMaterialSchema); 

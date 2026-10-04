const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Define the schema for a product type
const productTypeSchema = new Schema({
  subname: {
    type: String,
    required: true, // Subname (e.g., Fanta, Sprite) is required
  },
  description: {
    type: String,
    required: false, // Optional description for the type
  },
  rate: {
    type: Number,
    default: 0, // Default rate for the type
  },
  img: {
    type: String,
    required: false, // Optional image for the type
  },
  available: {
    type: Boolean,
    default: true, // Whether the type is available
  },
});

// Main product schema
const productSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  rate: {
    type: Number,
    default: 0,
  },
  price: {
    type: Number,
    required: true,
  },
  raters: {
    type: Number,
    default: 0,
  },
  img: {
    type: String,
    required: false,
  },
  available: {
    type: Boolean,
    default: true,
  },
  types: {
    type: [productTypeSchema], // Array of product types
    default: [], // Default to an empty array if no types are provided
  },
  discountPercentage: {
    type: Number,
  },
});

// Create the Product model
const Product = mongoose.model("Product", productSchema);
module.exports = Product;

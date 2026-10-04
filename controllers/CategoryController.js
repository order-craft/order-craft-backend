const Category = require("../models/Category");
const Section = require("../models/Section");
const logger = require("../logger");
const Product = require("../models/Product");

const createCategory = async (req, res) => {
  try {
    const { name, sectionId } = req.body;

    // Find the section associated with the sectionId
    const section = await Section.findById(sectionId);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    // Create a new category
    const newCategory = new Category({ name });
    await newCategory.save();

    // Add the new category to the section
    section.categories.push(newCategory._id);
    await section.save();

    logger.info(`Category ${name} created and added to section successfully`);

    res.status(201).json({
      message: "Category created and added to section successfully",
      category: newCategory,
    });
  } catch (error) {
    logger.error("Error creating category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getCategories = async (req, res) => {
  try {
    const categories = await Category.find().populate("products");
    res.status(200).json(categories);
  } catch (error) {
    logger.error("Error fetching categories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name } = req.body;

    const category = await Category.findByIdAndUpdate(
      categoryId,
      { name },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    logger.info(`Category with ID ${categoryId} updated successfully`);
    res
      .status(200)
      .json({ message: "Category updated successfully", category });
  } catch (error) {
    logger.error(
      `Error updating category with ID ${req.params.categoryId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    // Find the category by ID
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Find and update the section to remove the category reference
    await Section.updateMany(
      { categories: categoryId },
      { $pull: { categories: categoryId } }
    );

    // Delete all products in the category
    await Product.deleteMany({ _id: { $in: category.products } });

    // Delete the category itself
    await Category.findByIdAndDelete(categoryId);

    logger.info(
      `Category with ID ${categoryId} deleted successfully and removed from associated sections`
    );
    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    logger.error(
      `Error deleting category with ID ${req.params.categoryId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const getCategoryById = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const category = await Category.findById(categoryId).populate("products");
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.status(200).json(category);
  } catch (error) {
    logger.error(
      `Error fetching category with ID ${req.params.categoryId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  getCategoryById,
};

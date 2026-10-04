const Section = require("../models/Section");
const Category = require("../models/Category");
const Menu = require("../models/Menu");
const logger = require("../logger");

const createSection = async (req, res) => {
  try {
    const { name } = req.body;
    const superClientId = req.superClientId;

    // Create a new section
    const newSection = new Section({ name });
    await newSection.save();

    // Find the menu associated with the superClientId
    const menu = await Menu.findOne({ user: superClientId });

    if (!menu) {
      return res.status(404).json({ error: "Menu not found" });
    }

    // Add the new section to the menu
    menu.sections.push(newSection._id);
    await menu.save();

    logger.info(`Section ${name} created and added to menu successfully`);

    res.status(201).json({
      message: "Section created and added to menu successfully",
      section: newSection,
    });
  } catch (error) {
    logger.error("Error creating section:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getSections = async (req, res) => {
  try {
    // Fetch the menu associated with the superClientId
    const menu = await Menu.findOne({ user: req.superClientId }).populate({
      path: "sections",
      populate: {
        path: "categories",
      },
    });

    if (!menu) {
      return res
        .status(404)
        .json({ error: "Menu not found for the provided superClientId" });
    }

    // Extract the populated sections from the menu
    const sections = menu.sections;

    res.status(200).json(sections);
  } catch (error) {
    logger.error("Error fetching sections:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateSection = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { name } = req.body;

    const section = await Section.findByIdAndUpdate(
      sectionId,
      { name },
      { new: true }
    );
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    logger.info(`Section with ID ${sectionId} updated successfully`);
    res.status(200).json({ message: "Section updated successfully", section });
  } catch (error) {
    logger.error(
      `Error updating section with ID ${req.params.sectionId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { sectionId } = req.params;

    // Find the section by ID
    const section = await Section.findById(sectionId);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    // Remove all categories in the section
    await Category.deleteMany({ _id: { $in: section.categories } });

    // Delete the section itself
    await Section.findByIdAndDelete(sectionId);

    // Update the Menu to remove the section ID from the sections array
    await Menu.updateMany(
      { sections: sectionId },
      { $pull: { sections: sectionId } }
    );

    logger.info(
      `Section with ID ${sectionId} deleted successfully and removed from associated menus`
    );
    res.status(200).json({ message: "Section deleted successfully" });
  } catch (error) {
    logger.error(
      `Error deleting section with ID ${req.params.sectionId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const getSectionById = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const section = await Section.findById(sectionId).populate({
      path: "categories", // Populate the categories of the section
      populate: {
        path: "products", // For each category, populate the products
        model: "Product", // Ensure it uses the Product model
      },
    });
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }
    res.status(200).json(section);
  } catch (error) {
    logger.error(
      `Error fetching section with ID ${req.params.sectionId}:`,
      error
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createSection,
  getSections,
  updateSection,
  deleteSection,
  getSectionById,
};

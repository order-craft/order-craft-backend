const { Plan, Table } = require("../models/Table"); // Adjust path as needed

// Create a new plan
const createPlan = async (req, res) => {
  try {
    const { name, description } = req.body;
    const createdBy = req.superClientId;

    // Check if plan with this name already exists
    const existingPlan = await Plan.findOne({ name, createdBy });
    if (existingPlan) {
      return res
        .status(400)
        .json({ error: "Plan with this name already exists" });
    }

    const newPlan = new Plan({
      name,
      description,
      createdBy,
    });

    const savedPlan = await newPlan.save();
    res.status(201).json(savedPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all plans for a superClient
const getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ createdBy: req.superClientId });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get a single plan
const getPlan = async (req, res) => {
  try {
    const plan = await Plan.findOne({
      _id: req.params.id,
      createdBy: req.superClientId,
    }).populate("tables"); // If you're using the virtual population

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a plan
const updatePlan = async (req, res) => {
  try {
    const { name, description } = req.body;

    const updatedPlan = await Plan.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.superClientId },
      { name, description },
      { new: true }
    );

    if (!updatedPlan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json(updatedPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a plan (with checks for associated tables)
const deletePlan = async (req, res) => {
  try {
    // Check if any tables are using this plan
    const tablesWithPlan = await Table.countDocuments({
      plan: req.params.id,
      superClient: req.superClientId,
    });

    if (tablesWithPlan > 0) {
      return res.status(400).json({
        error: "Cannot delete plan - it has tables assigned to it",
      });
    }

    const deletedPlan = await Plan.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.superClientId,
    });

    if (!deletedPlan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json({ message: "Plan deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
  deletePlan,
};

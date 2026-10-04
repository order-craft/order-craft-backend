const PaymentMethod = require("../models/PaymentMethod");

// GET all payment methods for the authenticated superClient
exports.getAllPaymentMethods = async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ user: req.superClientId });
    res.status(200).json(methods);
  } catch (error) {
    res.status(500).json({ message: "Error fetching payment methods", error });
  }
};

// GET a single payment method by ID (only if it belongs to the user)
exports.getPaymentMethodById = async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({
      _id: req.params.id,
      user: req.superClientId,
    });

    if (!method) {
      return res.status(404).json({ message: "Payment method not found" });
    }

    res.status(200).json(method);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving payment method", error });
  }
};

// CREATE a new payment method
exports.createPaymentMethod = async (req, res) => {
  try {
    const { name, description } = req.body;

    const newMethod = new PaymentMethod({
      name,
      description,
      user: req.superClientId,
    });

    await newMethod.save();
    res.status(201).json(newMethod);
  } catch (error) {
    res.status(500).json({ message: "Error creating payment method", error });
  }
};

// UPDATE a payment method by ID (only if it belongs to the user)
exports.updatePaymentMethod = async (req, res) => {
  try {
    const { name, description } = req.body;

    const updated = await PaymentMethod.findOneAndUpdate(
      { _id: req.params.id, user: req.superClientId },
      { name, description },
      { new: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ message: "Payment method not found or unauthorized" });
    }

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: "Error updating payment method", error });
  }
};

// DELETE a payment method by ID (only if it belongs to the user)
exports.deletePaymentMethod = async (req, res) => {
  try {
    const deleted = await PaymentMethod.findOneAndDelete({
      _id: req.params.id,
      user: req.superClientId,
    });

    if (!deleted) {
      return res
        .status(404)
        .json({ message: "Payment method not found or unauthorized" });
    }

    res.status(200).json({ message: "Payment method deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting payment method", error });
  }
};

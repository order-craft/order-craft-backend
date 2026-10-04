const Bill = require("../models/Bill");

// Create a new bill
const createBill = async (req, res) => {
  try {
    const { client, totalAmount } = req.body;

    const existingBill = await Bill.findOne({ client });
    if (existingBill) {
      return res
        .status(400)
        .json({ message: "Bill for this client already exists." });
    }

    const bill = new Bill({ client, totalAmount });
    await bill.save();

    res.status(201).json({ message: "Bill created successfully.", bill });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error creating bill.", error: error.message });
  }
};

// Get all bills
const getAllBills = async (req, res) => {
  try {
    const bills = await Bill.find().populate("client", "fullName email");
    res.status(200).json(bills);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching bills.", error: error.message });
  }
};

// Get a single bill by client ID
const getBillByClient = async (req, res) => {
  try {
    const clientId = req.superClientId;
    console.log(clientId);
    const bill = await Bill.findOne({ client: clientId }).populate(
      "client",
      "name email"
    );
    if (!bill) {
      return res
        .status(404)
        .json({ message: "Bill not found for this client." });
    }

    res.status(200).json(bill);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching bill.", error: error.message });
  }
};

// Update a bill (e.g., adding a payment)
const updateBill = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { amountPaid, description } = req.body;

    const bill = await Bill.findOne({ client: clientId });
    if (!bill) {
      return res
        .status(404)
        .json({ message: "Bill not found for this client." });
    }

    // Update payment and log transaction
    bill.amountPaid += amountPaid;
    bill.transactions.push({ amount: amountPaid, description });
    await bill.save();

    res.status(200).json({ message: "Bill updated successfully.", bill });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating bill.", error: error.message });
  }
};

// Delete a bill
const deleteBill = async (req, res) => {
  try {
    const { clientId } = req.params;

    const bill = await Bill.findOneAndDelete({ client: clientId });
    if (!bill) {
      return res
        .status(404)
        .json({ message: "Bill not found for this client." });
    }

    res.status(200).json({ message: "Bill deleted successfully." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting bill.", error: error.message });
  }
};

// Get transaction details by client ID
const getTransactionsByClient = async (req, res) => {
  try {
    const { clientId } = req.params;

    const bill = await Bill.findOne({ client: clientId }).populate(
      "client",
      "name email"
    );
    if (!bill) {
      return res
        .status(404)
        .json({ message: "Bill not found for this client." });
    }

    res.status(200).json({ transactions: bill.transactions });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching transactions.", error: error.message });
  }
};

// Get total revenue (dashboard utility)
const getTotalRevenue = async (req, res) => {
  try {
    const bills = await Bill.find();
    const totalRevenue = bills.reduce((sum, bill) => sum + bill.amountPaid, 0);

    res.status(200).json({ totalRevenue });
  } catch (error) {
    res.status(500).json({
      message: "Error calculating total revenue.",
      error: error.message,
    });
  }
};

// Get outstanding balance (dashboard utility)
const getOutstandingBalance = async (req, res) => {
  try {
    const bills = await Bill.find();
    const totalOutstanding = bills.reduce((sum, bill) => sum + bill.balance, 0);

    res.status(200).json({ totalOutstanding });
  } catch (error) {
    res.status(500).json({
      message: "Error calculating outstanding balance.",
      error: error.message,
    });
  }
};

module.exports = {
  createBill,
  getAllBills,
  getBillByClient,
  updateBill,
  deleteBill,
  getTransactionsByClient,
  getTotalRevenue,
  getOutstandingBalance,
};

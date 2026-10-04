const express = require("express");
const {
  createBill,
  getAllBills,
  getBillByClient,
  updateBill,
  deleteBill,
  getTransactionsByClient,
  getTotalRevenue,
  getOutstandingBalance,
} = require("../controllers/BillController");
const verifySuperClient = require("../middleWares/VerifySuperClient");

const router = express.Router();

router.post("/bills", createBill);
router.get("/bills", getAllBills);
router.get("/current",verifySuperClient,getBillByClient);
router.put("/bills/:clientId", updateBill);
router.delete("/bills/:clientId", deleteBill);
router.get("/bills/:clientId/transactions", getTransactionsByClient);
router.get("/dashboard/revenue", getTotalRevenue);
router.get("/dashboard/outstanding", getOutstandingBalance);

module.exports = router;

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
const requireInternalKey = require("../middleWares/requireInternalKey");
const router = express.Router();

router.post("/bills", requireInternalKey, createBill);
router.get("/bills", requireInternalKey, getAllBills);

router.get("/current", verifySuperClient, getBillByClient);
// router.put("/bills/:clientId", updateBill);
// router.delete("/bills/:clientId", deleteBill);
// router.get("/bills/:clientId/transactions", getTransactionsByClient);
// router.get("/dashboard/revenue", getTotalRevenue);
// router.get("/dashboard/outstanding", getOutstandingBalance);

router.put("/bills/:clientId", requireInternalKey, updateBill);
router.delete("/bills/:clientId", requireInternalKey, deleteBill);
router.get(
  "/bills/:clientId/transactions",
  verifySuperClient,
  getTransactionsByClient,
);
router.get("/dashboard/revenue", requireInternalKey, getTotalRevenue);
router.get("/dashboard/outstanding", requireInternalKey, getOutstandingBalance);

module.exports = router;

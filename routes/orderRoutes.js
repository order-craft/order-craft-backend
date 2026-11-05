const express = require("express");

const {
  createOrder,
  getOrder,
  getAllOrders,
  updateOrder,
  rateOrderProducts,
  deleteOrder,
  confirmSelectedPayments,
  getOrdersBySuperClientIdFIFO,
  updateOrderStatus,
  confirmSelectedProductsPayments,
  tipOrder,
  deleteCancelledOrders,
  getNonDineInOrdersToday,
  confirmNotDineinSelectedOrder,
  confirmSelectedNotDineinProductsPayments,
} = require("../controllers/OrderController");
const decodeTableToken = require("../middleWares/decodeTableToken");
//const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");
const verifyToken = require("../middleWares/jerifyToken");
const verifyClientOrSuperClientOrTable = require("../middleWares/verifyClientOrSuperClientOrTable");
const router = express.Router();

// ════════════════════════════════════════════════════════════════════
// POST routes
// ════════════════════════════════════════════════════════════════════
router.post("/", decodeTableToken, createOrder);
router.post("/manual", verifyClientOrSuperClient, createOrder);

// ════════════════════════════════════════════════════════════════════
// Static GET routes MUST come before "/:orderId" so they are not
// shadowed by the parameterized route.
// ════════════════════════════════════════════════════════════════════
router.get("/dineIn/today", verifyClientOrSuperClient, getNonDineInOrdersToday);
router.get("/takeaway", verifyClientOrSuperClient, getNonDineInOrdersToday);
router.get(
  "/orders/ordersfifo",
  verifyClientOrSuperClient,
  getOrdersBySuperClientIdFIFO,
);

// ── Parameterized GET routes (must come last) ──────────────────────
router.get("/", decodeTableToken, getAllOrders);
router.get("/:orderId", decodeTableToken, getOrder);

// ════════════════════════════════════════════════════════════════════
// POST routes with parameters
// ════════════════════════════════════════════════════════════════════
router.post("/:orderId/rate", decodeTableToken, rateOrderProducts);
router.post("/:orderId/tips", decodeTableToken, tipOrder);

// ════════════════════════════════════════════════════════════════════
// PUT routes
// ════════════════════════════════════════════════════════════════════
// Static confirm routes first
router.put(
  "/confirm/confirm-payment",
  verifyClientOrSuperClient,
  confirmSelectedPayments,
);
router.put(
  "/confirm/confirm-products-payment",
  verifyClientOrSuperClient,
  confirmSelectedProductsPayments,
);
router.put(
  "/confirm/confirm-notdinein-products-payment",
  verifyClientOrSuperClient,
  confirmSelectedNotDineinProductsPayments,
);
router.put(
  "/confirm/confirm-notdinein-payment",
  verifyClientOrSuperClient,
  confirmNotDineinSelectedOrder,
);

// Then the parameterized update
router.put("/:orderId", verifyClientOrSuperClientOrTable, updateOrder);

// ════════════════════════════════════════════════════════════════════
// PATCH routes
// ════════════════════════════════════════════════════════════════════
router.patch(
  "/update-status/:orderId",
  verifyClientOrSuperClient,
  updateOrderStatus,
);

// ════════════════════════════════════════════════════════════════════
// DELETE routes
// ════════════════════════════════════════════════════════════════════
// Static delete first, then the parameterized one
router.delete(
  "/delete/cancelled",
  verifyClientOrSuperClient,
  deleteCancelledOrders,
);
router.delete("/:orderId", verifyToken, deleteOrder);

module.exports = router;

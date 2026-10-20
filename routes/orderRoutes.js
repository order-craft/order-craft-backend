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
  markOrderDelivered,
  claimDelivery,
} = require("../controllers/OrderController");
const decodeTableToken = require("../middleWares/decodeTableToken");
//const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");
const verifyToken = require("../middleWares/jerifyToken");
const verifyClientOrSuperClientOrTable = require("../middleWares/verifyClientOrSuperClientOrTable");
const router = express.Router();

// Define routes for User model
router.post("/", decodeTableToken, createOrder);
router.post("/manual", verifyClientOrSuperClient, createOrder);

router.post("/:orderId/rate", decodeTableToken, rateOrderProducts);
router.post("/:orderId/tips", decodeTableToken, tipOrder);
router.put("/:orderId", verifyClientOrSuperClientOrTable, updateOrder);
router.patch(
  "/update-status/:orderId",
  verifyClientOrSuperClient,
  updateOrderStatus
);
router.patch(
  "/:orderId/deliver",
  verifyClientOrSuperClient,
  markOrderDelivered
);
router.patch(
  "/:orderId/claim-delivery",
  verifyClientOrSuperClient,
  claimDelivery
);

router.delete("/:orderId", verifyToken, deleteOrder);
//delete all cancelled orders for a specific superClient
router.delete(
  "/delete/cancelled",
  verifyClientOrSuperClient,
  deleteCancelledOrders
);

router.get("/:orderId", decodeTableToken, getOrder);
router.get("/", decodeTableToken, getAllOrders);
router.get("/dineIn/today", verifyClientOrSuperClient, getNonDineInOrdersToday);
//router.get("/client", getAllOrders);
router.get(
  "/orders/ordersfifo",
  verifyClientOrSuperClient,
  getOrdersBySuperClientIdFIFO
);

// router.put("/:orderId/increase/:productId", increaseProductQuantity);
// router.put("/:orderId/decrease/:productId", decreaseProductQuantity);
router.put(
  "/confirm/confirm-payment",
  verifyClientOrSuperClient,
  confirmSelectedPayments
);
router.put(
  "/confirm/confirm-products-payment",
  verifyClientOrSuperClient,
  confirmSelectedProductsPayments
);
router.put(
  "/confirm/confirm-notdinein-products-payment",
  verifyClientOrSuperClient,
  confirmSelectedNotDineinProductsPayments
);
router.put(
  "/confirm/confirm-notdinein-payment",
  verifyClientOrSuperClient,
  confirmNotDineinSelectedOrder
);

module.exports = router;

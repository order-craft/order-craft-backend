const express = require("express");
const router = express.Router();
const controller = require("../controllers/paymentMethodController");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClinetOrSuperClient = require("../middleWares/verifyClientOrSuperClient");

// Middleware should set req.superClientId before these routes
router.get("/", verifyClinetOrSuperClient, controller.getAllPaymentMethods);
router.get("/:id", verifySuperClient, controller.getPaymentMethodById);
router.post("/", verifySuperClient, controller.createPaymentMethod);
router.put("/:id", verifySuperClient, controller.updatePaymentMethod);
router.delete("/:id", verifySuperClient, controller.deletePaymentMethod);

module.exports = router;

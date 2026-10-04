// In your routes.js
const express = require("express");
const {
  createRequestType,
  getRequestTypes,
  updateRequestType,
  deleteRequestType,
  createSupportRequest,
  getSupportRequests,
  markAsAnswered,
  deleteRequest,
} = require("../controllers/SupportRequestController");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");
const verifyClientOrSuperClientOrTable = require("../middleWares/verifyClientOrSuperClientOrTable");

const verifySuperClient = require("../middleWares/VerifySuperClient");

const router = express.Router();

// SuperClient request type routes
router.post("/request-types", verifySuperClient, createRequestType);
router.get("/request-types", verifyClientOrSuperClientOrTable, getRequestTypes);
router.put("/request-types/:id", verifySuperClient, updateRequestType);
router.delete("/request-types/:id", verifySuperClient, deleteRequestType);

// Support request routes
router.post("/support-requests", createSupportRequest);
router.get("/support-requests", verifyClientOrSuperClient, getSupportRequests);
router.put(
  "/support-requests/:id/answered",
  verifyClientOrSuperClient,
  markAsAnswered
);
router.delete(
  "/support-requests/:id",
  verifyClientOrSuperClient,
  deleteRequest
);

module.exports = router;

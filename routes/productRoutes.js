const express = require("express");

const {
  createProduct,
  deleteProduct,
  updateProduct,
  getMenuProducts,
  changeProductAvailability,
  getProductRatingsBySuperClient,
} = require("../controllers/ProductController");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");
const router = express.Router();

// Define routes for User model
router.post("/", verifySuperClient, createProduct); // Create a new user
router.get("/", verifyClientOrSuperClient, getMenuProducts); // Create a new user
router.get("/rates", verifyClientOrSuperClient, getProductRatingsBySuperClient); // Create a new user
router.put("/:productId", verifySuperClient, updateProduct);
router.put(
  "/:productId/availability",
  verifyClientOrSuperClient,
  changeProductAvailability
);
router.delete("/:productId", verifySuperClient, deleteProduct);

module.exports = router;

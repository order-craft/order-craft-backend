const express = require("express");
const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} = require("../controllers/CategoryController");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");
const router = express.Router();

router.post("/", verifySuperClient, createCategory);
router.get("/", verifyClientOrSuperClient, getCategories);
router.get("/:categoryId", getCategoryById);
router.put("/:categoryId", updateCategory);
router.delete("/:categoryId", deleteCategory);

module.exports = router;

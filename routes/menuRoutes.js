const express = require("express");

const { getMenu } = require("../controllers/MenuController");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyToken = require("../middleWares/jerifyToken");
const router = express.Router();

// Define routes for User model
router.get("/", verifyToken, getMenu);
router.get("/admin", verifySuperClient, getMenu);

module.exports = router;

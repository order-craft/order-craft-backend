const express = require("express");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClientOrTable = require("../middleWares/verifyClientOrSuperClientOrTable");

const {
  createSection,
  getSections,
  getSectionById,
  updateSection,
  deleteSection,
} = require("../controllers/SectionController");
const router = express.Router();

router.post("/", verifySuperClient, createSection);
router.get("/", verifyClientOrSuperClientOrTable, getSections);
router.get("/:sectionId", verifyClientOrSuperClientOrTable, getSectionById);
router.put("/:sectionId", verifySuperClient, updateSection);
router.delete("/:sectionId", verifySuperClient, deleteSection);

module.exports = router;

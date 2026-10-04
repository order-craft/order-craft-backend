const express = require('express');
const rawMaterialController = require('../controllers/rawMaterialController');
const verifySuperClient = require("../middleWares/VerifySuperClient")
const router = express.Router();

router.post('/', verifySuperClient, rawMaterialController.createRawMaterial);
router.get('/', verifySuperClient, rawMaterialController.getAllRawMaterials);
router.get('/:id', verifySuperClient, rawMaterialController.getRawMaterialById);
router.put('/:id', verifySuperClient, rawMaterialController.updateRawMaterial);
router.delete('/:id', verifySuperClient, rawMaterialController.deleteRawMaterial);

module.exports = router;

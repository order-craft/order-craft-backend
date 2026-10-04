const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const verifySuperClient = require('../middleWares/VerifySuperClient');

router.post('/receive', verifySuperClient, inventoryController.receiveInventory);
router.get('/', verifySuperClient, inventoryController.getAllInventory);
router.get('/low-stock', verifySuperClient, inventoryController.getLowStock);
router.put('/:id', verifySuperClient, inventoryController.updateInventory);
router.delete('/:id', verifySuperClient, inventoryController.deleteInventoryItem);

module.exports = router;

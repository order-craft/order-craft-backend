const Inventory = require('../models/Inventory');
const RawMaterial = require('../models/RawMaterial');

exports.receiveInventory = async (req, res) => {
  try {
    const { rawMaterialId, quantity } = req.body;
    if (!quantity) {
      return res.status(400).json({ error: 'Raw material ID and quantity are required' });
    }
    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }
    const rawMaterial = await RawMaterial.findById(rawMaterialId);
    if (!rawMaterial) {
      return res.status(404).json({ error: 'Raw material not found' });
    }
    const inventory = await Inventory.findOneAndUpdate(
      { rawMaterial: rawMaterialId },
      { $inc: { currentQuantity: quantity } },
      { new: true, upsert: true }
    ).populate('rawMaterial');
    res.json({
      message: 'Inventory updated successfully',
      inventory
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllInventory = async (req, res) => {
  try {
    const userId = req.superClientId;
    const inventory = await Inventory.find({ userId: userId })
      .populate('rawMaterial')
      .sort({ 'rawMaterial.name': 1 });
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getLowStock = async (req, res) => {
  try {
    const userId = req.superClientId;

    const lowStockItems = await Inventory.aggregate([
      // 1) keep only this user’s inventory records
      { $match: { userId } },

      // 2) bring in the raw‐material details
      {
        $lookup: {
          from: 'rawmaterials',
          localField: 'rawMaterial',
          foreignField: '_id',
          as: 'rawMaterialInfo'
        }
      },
      { $unwind: '$rawMaterialInfo' },

      // 3) filter to those at or below reorder level
      {
        $match: {
          $expr: {
            $lte: ['$currentQuantity', '$rawMaterialInfo.reorderLevel']
          }
        }
      },

      // 4) shape the output
      {
        $project: {
          rawMaterial: '$rawMaterialInfo',
          currentQuantity: 1,
          deficit: {
            $subtract: ['$rawMaterialInfo.reorderLevel', '$currentQuantity']
          }
        }
      }
    ]);

    // (optional) warn in server logs for each low‐stock item
    lowStockItems.forEach(item => {
      console.warn(
        `LOW STOCK [User ${userId}]: ${item.rawMaterial.name} — ` +
        `Current ${item.currentQuantity} ${item.rawMaterial.unit}, ` +
        `Reorder @ ${item.rawMaterial.reorderLevel}`
      );
    });

    res.json({ lowStockItems, count: lowStockItems.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateInventory = async (req, res) => {
  try {
    const { currentQuantity } = req.body;
    if (!currentQuantity) {
      return res.status(400).json({ error: 'Quantity is required' });
    }
    // if (quantity <= 0) {
    //   return res.status(400).json({ error: 'Quantity must be positive' });
    // }
    // const rawMaterial = await RawMaterial.findById(rawMaterialId);
    // if (!rawMaterial) {
    //   return res.status(404).json({ error: 'Raw material not found' });
    // }

    const inventory = await Inventory.findByIdAndUpdate(
      req.params.id,
      { currentQuantity },
      { new: true, runValidators: true }
    ).populate('rawMaterial');
    if (!inventory) {
      return res.status(404).json({ error: 'Inventory not found' });
    }

    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteInventoryItem = async (req, res) => {
  try {
    const invItem = await Inventory.findByIdAndDelete(req.params.id);
    if (!invItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    res.json({ message: 'Inventory item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
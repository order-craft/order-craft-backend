const express = require('express'); 
const router = express.Router(); 
const recipeController = require('../controllers/recipeController'); 
const verifySuperClient = require('../middleWares/VerifySuperClient');

router.post('/', verifySuperClient, recipeController.createRecipe); 
router.get('/', verifySuperClient, recipeController.getAllRecipes); 
router.get('/product/:productId', verifySuperClient, recipeController.getRecipeByProduct); 
router.put('/:id', verifySuperClient, recipeController.updateRecipe); 
router.post('/:id/raw-materials', verifySuperClient, recipeController.addRawMaterialToRecipe); 
router.delete('/:id/raw-materials/:rawMaterialId', verifySuperClient, recipeController.removeRawMaterialFromRecipe); 
router.delete('/:id', verifySuperClient, recipeController.deleteRecipe); 

module.exports = router; 

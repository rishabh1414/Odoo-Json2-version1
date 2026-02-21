import { Router } from "express";
import { listInventory, listLocationProducts, listLocations } from "../controllers/inventoryController.js";

const router = Router();

router.get("/inventory/quants", listInventory);
router.get("/inventory/locations", listLocations);
router.get("/inventory/locations/:id/products", listLocationProducts);

export default router;

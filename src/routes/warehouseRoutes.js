import { Router } from "express";
import {
  getWarehouseById,
  getWarehouseFields,
  listWarehouses,
} from "../controllers/warehouseController.js";

const router = Router();

router.get("/warehouses/fields", getWarehouseFields);
router.get("/warehouses/:id", getWarehouseById);
router.get("/warehouses", listWarehouses);

export default router;

import { Router } from "express";
import {
  createSalesOrder,
  downloadSalesOrderPdf,
  getSalesOrderById,
  getSalesOrderFields,
  listSalesOrders,
  updateSalesOrder,
  updateSalesOrderState,
} from "../controllers/salesOrderController.js";

const router = Router();

router.get("/sales-orders/fields", getSalesOrderFields);
router.get("/sales-orders/:id/pdf", downloadSalesOrderPdf);
router.get("/sales-orders/:id", getSalesOrderById);
router.get("/sales-orders", listSalesOrders);
router.post("/sales-orders", createSalesOrder);
router.patch("/sales-orders/:id", updateSalesOrder);
router.patch("/sales-orders/:id/state", updateSalesOrderState);

export default router;

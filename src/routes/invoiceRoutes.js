import { Router } from "express";
import {
  createInvoice,
  downloadInvoicePdf,
  getInvoiceById,
  getInvoiceFields,
  listInvoices,
} from "../controllers/invoiceController.js";

const router = Router();

router.get("/invoices/fields", getInvoiceFields);
router.get("/invoices/:id/pdf", downloadInvoicePdf);
router.get("/invoices/:id", getInvoiceById);
router.get("/invoices", listInvoices);
router.post("/invoices", createInvoice);

export default router;

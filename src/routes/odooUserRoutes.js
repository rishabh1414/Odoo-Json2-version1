import { Router } from "express";
import {
  listSalespersons,
  resolveOdooUser,
} from "../controllers/odooUserController.js";

const router = Router();

router.get("/odoo/users/salespersons", listSalespersons);
router.get("/odoo/users/resolve", resolveOdooUser);
router.post("/odoo/users/resolve", resolveOdooUser);

export default router;

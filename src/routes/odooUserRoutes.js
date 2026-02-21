import { Router } from "express";
import { resolveOdooUser } from "../controllers/odooUserController.js";

const router = Router();

router.get("/odoo/users/resolve", resolveOdooUser);
router.post("/odoo/users/resolve", resolveOdooUser);

export default router;

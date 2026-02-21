import { Router } from "express";
import {
  createCategory,
  getCategoryById,
  listCategories,
} from "../controllers/categoryController.js";

const router = Router();

router.get("/categories", listCategories);
router.get("/categories/:id", getCategoryById);
router.post("/categories", createCategory);

export default router;

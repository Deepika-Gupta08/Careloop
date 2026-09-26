import { Router, type IRouter } from "express";
import healthRouter from "./health";
import hmsRouter from "./hms";

const router: IRouter = Router();

router.use(healthRouter);
router.use(hmsRouter);

export default router;

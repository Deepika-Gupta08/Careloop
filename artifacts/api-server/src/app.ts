import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Standard root health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", router);

// Serve compiled React web app if available
const publicDistCandidates = [
  path.resolve(process.cwd(), "artifacts/health-management-system/dist/public"),
  path.resolve(process.cwd(), "Health-Management-System/artifacts/health-management-system/dist/public"),
  path.resolve(__dirname, "../../health-management-system/dist/public"),
  path.resolve(__dirname, "../health-management-system/dist/public"),
];

let staticServed = false;
for (const candidate of publicDistCandidates) {
  if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "index.html"))) {
    logger.info({ staticDir: candidate }, "Serving frontend static files");
    app.use(express.static(candidate));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api") && req.path !== "/health") {
        if (path.extname(req.path)) {
          return res.status(404).end();
        }
        return res.sendFile(path.join(candidate, "index.html"));
      }
      next();
    });
    staticServed = true;
    break;
  }
}

if (!staticServed) {
  logger.warn("Frontend static build directory not found. Server running in API-only mode.");
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled API error");
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;

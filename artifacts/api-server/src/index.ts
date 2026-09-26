import app from "./app";
import { logger } from "./lib/logger";
import { ensureDemoData } from "./routes/hms";
import { initDatabase } from "@workspace/db";

const rawPort = process.env["PORT"] || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  try {
    logger.info("Initializing database schema...");
    await initDatabase();

    logger.info("Ensuring demo data exists...");
    await ensureDemoData();

    const server = app.listen(port, "0.0.0.0", () => {
      logger.info({ port, env: process.env.NODE_ENV || "development" }, `HMS Server running at http://localhost:${port}`);
    });

    const gracefulShutdown = (signal: string) => {
      logger.info({ signal }, "Received shutdown signal. Closing server...");
      server.close(() => {
        logger.info("HTTP server closed.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (err) {
    logger.error({ err }, "Unable to initialize and start server");
    process.exit(1);
  }
}

startServer();

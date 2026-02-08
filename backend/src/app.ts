import cors from "cors";
import express from "express";
import { authContext } from "./middleware/auth.js";
import { copilotRouter } from "./routes/copilot.js";
import { filesRouter } from "./routes/files.js";
import { importsRouter } from "./routes/imports.js";
import { errorHandler } from "./utils/errorHandler.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(authContext);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "ipmds-backend" });
  });

  app.use("/api/v1/copilot", copilotRouter);
  app.use("/api/v1/imports", importsRouter);
  app.use("/api/v1/files", filesRouter);

  app.use(errorHandler);
  return app;
}

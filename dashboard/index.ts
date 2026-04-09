import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../shared/env";

const connection = new IORedis({ host: config.REDIS_HOST, port: config.REDIS_PORT });
const taskQueue = new Queue("main-task-queue", { connection });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/ui");

createBullBoard({
  queues: [new BullMQAdapter(taskQueue)],
  serverAdapter: serverAdapter,
});

const app = express();
app.use("/ui", serverAdapter.getRouter());

const server = app.listen(config.DASHBOARD_PORT, () => {
  console.log(`Admin Dashboard running on http://localhost:${config.DASHBOARD_PORT}/ui`);
});

async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down dashboard...`);
  //stops taking new requests
  server.close(async () => {
    //then cuts the Redis connection
    connection.quit();
    console.log("Dashboard Graceful shutdown complete.");
    process.exit(0);
  });
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import type { JobData } from "../shared/types";

//establish connection to docker redis container
const connection = new IORedis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
});

//intialize the queue
const taskQueue = new Queue<JobData>("main-task-queue", { connection });
const queueEvents = new QueueEvents("main-task-queue", { connection });

const activeConnections = new Map<string, any>();

queueEvents.on("completed", ({ jobId, returnvalue }) => {
  const ws = activeConnections.get(jobId);

  if (ws) {
    ws.send(JSON.stringify({ status: "completed", data: returnvalue }));
    activeConnections.delete(jobId);
    ws.close();
  }
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  const ws = activeConnections.get(jobId);

  if (ws) {
    ws.send(JSON.stringify({ status: "failed", error: failedReason }));
    activeConnections.delete(jobId);
    ws.close();
  }
});

type WebSocketData = {
  jobId: string;
};

Bun.serve<WebSocketData>({
  port: 3000,

  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const jobId = url.searchParams.get("jobId");
      if (!jobId) return new Response("Missing jobId", { status: 400 });

      const success = server.upgrade(req, { data: { jobId } });
      if (success) return undefined;
      return new Response("Websocket connection failed", { status: 500 });
    }

    if (req.method === "POST" && url.pathname === "/submit") {
      try {
        const data = (await req.json()) as JobData;

        const job = await taskQueue.add("process-task", data, {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        });

        console.log(`Added job ${job.id} to the queue`);

        return new Response(
          JSON.stringify({
            success: true,
            jobId: job.id,
            message: "job is now in the queue",
          }),
          {
            status: 202,
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (error) {
        console.log(error);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const jobId = ws.data.jobId;
      activeConnections.set(jobId, ws);
    },

    close(ws) {
      const jobId = ws.data.jobId;
      activeConnections.delete(jobId);
    },

    message(ws, message) {},
  },
});

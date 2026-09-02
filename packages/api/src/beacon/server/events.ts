import {ChainForkConfig} from "@lodestar/config";
import {ApiError, ApplicationMethods, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, eventTypes, getDefinitions, getEventSerdes} from "../routes/events.js";

export function getRoutes(config: ChainForkConfig, methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  const eventSerdes = getEventSerdes(config);
  const serverRoutes = createFastifyRoutes(getDefinitions(config), methods);

  return {
    // Non-JSON route. Server Sent Events (SSE)
    eventstream: {
      ...serverRoutes.eventstream,
      handler: async (req, res) => {
        const validTopics = new Set(Object.values(eventTypes));
        for (const topic of req.query.topics) {
          if (!validTopics.has(topic)) {
            throw new ApiError(400, `Invalid topic: ${topic}`);
          }
        }

        const controller = new AbortController();

        try {
          // Add injected headers from other plugins. This is required for fastify-cors for example
          // From: https://github.com/NodeFactoryIo/fastify-sse-v2/blob/b1686a979fbf655fb9936c0560294a0c094734d4/src/plugin.ts
          for (const [key, value] of Object.entries(res.getHeaders())) {
            if (value !== undefined) res.raw.setHeader(key, value);
          }

          res.raw.setHeader("Content-Type", "text/event-stream");
          res.raw.setHeader("Cache-Control", "no-cache,no-transform");
          res.raw.setHeader("Connection", "keep-alive");
          // It was reported that chrome and firefox do not play well with compressed event-streams https://github.com/lolo32/fastify-sse/issues/2
          res.raw.setHeader("x-no-compression", 1);
          // In case this beacon node is behind a NGINX, instruct it to disable buffering which can disrupt SSE by
          // infinitely buffering it. http://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering
          // Source: https://stackoverflow.com/questions/13672743/eventsource-server-sent-events-through-nginx
          res.raw.setHeader("X-Accel-Buffering", "no");

          await new Promise<void>((resolve, reject) => {
            void methods.eventstream({
              topics: req.query.topics,
              signal: controller.signal,
              onEvent: (event) => {
                // Serialization is per event and must not tear down the stream. Throwing here is
                // handled by the caller which logs it and keeps the subscription alive, the client
                // only misses this single event instead of silently losing the whole stream.
                const data = eventSerdes.toJson(event);

                try {
                  res.raw.write(serializeSSEEvent({event: event.type, data}));
                } catch (e) {
                  // The connection itself is broken, there is no way to recover it
                  reject(e);
                }
              },
            });

            // The stream will never end by the server unless the node is stopped.
            // In that case the BeaconNode class will call server.close() and end this connection.

            // The client may disconnect and we need to clean the subscriptions.
            req.socket.once("close", () => resolve());
            req.socket.once("end", () => resolve());
          });
        } finally {
          controller.abort();
          // Always end the response. If an error is thrown after the headers were sent, fastify can
          // no longer write a status code and would leave the socket open, the client then waits
          // forever on a stream that will never emit another event.
          if (!res.raw.writableEnded && !res.raw.destroyed) res.raw.end();
        }
      },
    },
  };
}

export function serializeSSEEvent(chunk: {event: string; data: unknown}): string {
  return [`event: ${chunk.event}`, `data: ${JSON.stringify(chunk.data)}`, "\n"].join("\n");
}

import {AbortController} from "@chainsafe/abort-controller";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ServerRoutes} from "./utils";
import {Api, ReqTypes, routesData, getEventSerdes} from "../routes/events";

export function getRoutes(config: IChainForkConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  const eventSerdes = getEventSerdes();

  return {
    // Non-JSON route. Server Sent Events (SSE)
    eventstream: {
      url: routesData.eventstream.url,
      method: routesData.eventstream.method,
      id: "eventstream",

      handler: async (req, res) => {
        const controller = new AbortController();

        try {
          res.raw.setHeader("Content-Type", "text/event-stream");
          res.raw.setHeader("Cache-Control", "no-cache,no-transform");
          res.raw.setHeader("Connection", "keep-alive");
          // It was reported that chrome and firefox do not play well with compressed event-streams https://github.com/lolo32/fastify-sse/issues/2
          res.raw.setHeader("x-no-compression", 1);

          await new Promise<void>((resolve, reject) => {
            api.eventstream(req.query.topics, controller.signal, (event) => {
              try {
                const data = eventSerdes.toJson(event);
                res.raw.write(serializeSSEEvent({event: event.type, data}));
              } catch (e) {
                reject(e as Error);
              }
            });

            // The stream will never end by the server unless the node is stopped.
            // In that case the BeaconNode class will call server.close() and end this connection.

            // The client may disconnect and we need to clean the subscriptions.
            req.raw.once("close", () => resolve());
            req.raw.once("end", () => resolve());
            req.raw.once("error", (err) => reject(err));
          });

          // api.eventstream will never stop, so no need to ever call `res.raw.end();`
        } finally {
          controller.abort();
        }
      },

      // TODO: Bundle this in /routes/events?
      schema: {
        querystring: {
          type: "object",
          properties: {
            topics: {type: "array", items: {type: "string"}},
          },
        },
      },
    },
  };
}

export function serializeSSEEvent(chunk: {event: string; data: unknown}): string {
  return [`event: ${chunk.event}`, `data: ${JSON.stringify(chunk.data)}`, "\n"].join("\n");
}

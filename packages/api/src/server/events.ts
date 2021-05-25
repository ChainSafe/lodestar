import {AbortController} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ServerRoutes} from "./utils";
import {Api, ReqTypes, routesData, getEventSerdes} from "../routes/events";

export function getRoutes(config: IBeaconConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  const eventSerdes = getEventSerdes(config);

  return {
    eventstream: {
      ...routesData.eventstream,
      id: "eventstream",

      handler: async (req, res) => {
        const controller = new AbortController();

        try {
          await res.headers({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache,no-transform",
            // prettier-ignore
            // eslint-disable-next-line
            "Connection": "keep-alive",
            // It was reported that chrome and firefox do not play well with compressed event-streams https://github.com/lolo32/fastify-sse/issues/2
            "x-no-compression": 1,
          });

          await new Promise<void>((resolve, reject) => {
            api.eventstream(req.query.topics, controller.signal, (event) => {
              try {
                const data = eventSerdes.toJson(event);
                res.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
              } catch (e) {
                reject(e);
              }
            });

            // The stream will never end by the server unless the node is stopped.
            // In that case the BeaconNode class will call server.close() and end this connection.

            // The client may disconnect and we need to clean the subscriptions.
            req.req.once("close", () => resolve());
            req.req.once("end", () => resolve());
            req.req.once("error", (err) => reject(err));
          });
        } finally {
          controller.abort();
        }
      },

      // TODO: Bundle this in lodestar-api?
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

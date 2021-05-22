import {AbortController} from "abort-controller";
import {routes} from "@chainsafe/lodestar-api";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiControllers} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.events.Api
): ApiControllers<routes.events.Api, routes.events.ReqTypes> {
  const eventSerdes = routes.events.getEventSerdes(config);

  return {
    eventstream: {
      ...routes.events.routesData.eventstream,
      id: "eventstream",

      handler: async (req, res) => {
        const controller = new AbortController();

        try {
          res.header("Content-Type", "text/event-stream");
          res.header("Cache-Control", "no-cache,no-transform");
          res.header("Connection", "keep-alive");
          // It was reported that chrome and firefox do not play well with compressed event-streams https://github.com/lolo32/fastify-sse/issues/2
          res.header("x-no-compression", 1);

          await new Promise<void>((resolve, reject) => {
            api.eventstream(req.query.topics, controller.signal, (event) => {
              try {
                const data = eventSerdes.toJson(event);
                res.res.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
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

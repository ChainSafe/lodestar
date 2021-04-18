import {EventMessage} from "fastify";
import {BasicType, CompositeType} from "@chainsafe/ssz";
import {BeaconEvent, BeaconEventType} from "../../impl/events";
import {ApiController} from "../types";

type Query = {
  topics?: BeaconEventType[];
};

export const getEventStream: ApiController<Query> = {
  url: "/",
  method: "GET",
  id: "eventstream",

  handler: async function (req, resp) {
    resp.sent = true;
    const source = this.api.events.getEventStream(req.query.topics ?? Object.values(BeaconEventType));
    for (const event of ["end", "error", "close"]) {
      req.req.once(event, () => {
        source.stop();
      });
    }

    const config = this.config;
    async function* transform(source: AsyncIterable<BeaconEvent>): AsyncIterable<EventMessage> {
      for await (const event of source) {
        switch (event.type) {
          case BeaconEventType.HEAD:
            yield serializeEvent(config.types.phase0.ChainHead, event);
            break;
          case BeaconEventType.BLOCK:
            yield serializeEvent(config.types.phase0.BlockEventPayload, event);
            break;
          case BeaconEventType.ATTESTATION:
            yield serializeEvent(config.types.phase0.Attestation, event);
            break;
          case BeaconEventType.FINALIZED_CHECKPOINT:
            yield serializeEvent(config.types.phase0.FinalizedCheckpoint, event);
            break;
          case BeaconEventType.CHAIN_REORG:
            yield serializeEvent(config.types.phase0.ChainReorg, event);
            break;
          default:
            req.log.warn("Missing serializer for event " + event.type);
        }
      }
    }
    resp
      .type("text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("Connection", "keep-alive")
      .sse(transform(source));
  },

  schema: {
    querystring: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: {
            type: "string",
            enum: Object.values(BeaconEventType),
          },
        },
      },
    },
  },
};

function serializeEvent<T extends BeaconEvent>(
  type: BasicType<T["message"]> | CompositeType<T["message"]>,
  event: T
): EventMessage {
  return {
    event: event.type,
    data: JSON.stringify(type.toJson(event.message)),
  };
}

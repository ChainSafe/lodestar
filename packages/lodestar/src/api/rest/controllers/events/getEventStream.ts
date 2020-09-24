import {ApiController} from "../types";
import {EventMessage} from "fastify";
import {BeaconEvent, BeaconEventType} from "../../../impl/events";
import {BasicType, CompositeType} from "@chainsafe/ssz";

export const getEventStream: ApiController = {
  url: "/",

  handler: async function (req, resp) {
    resp.sent = true;
    const source = this.api.events.getEventStream();
    ["end", "error", "close"].forEach((event) => {
      req.req.once(event, () => {
        source.stop();
      });
    });
    const config = this.config;
    const transform = (source: AsyncIterable<BeaconEvent>): AsyncIterable<EventMessage> =>
      (async function* () {
        for await (const event of source) {
          switch (event.type) {
            case BeaconEventType.HEAD:
              yield serializeEvent(config.types.ChainHead, event);
              break;
            case BeaconEventType.BLOCK:
              yield serializeEvent(config.types.BlockEventPayload, event);
              break;
            case BeaconEventType.ATTESTATION:
              yield serializeEvent(config.types.Attestation, event);
              break;
            case BeaconEventType.FINALIZED_CHECKPOINT:
              yield serializeEvent(config.types.FinalizedCheckpoint, event);
              break;
            case BeaconEventType.CHAIN_REORG:
              yield serializeEvent(config.types.ChainReorg, event);
              break;
            default:
              req.log.warn("Missing serializer for event " + event.type);
          }
        }
      })();
    resp
      .type("text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("Connection", "keep-alive")
      .sse(transform(source));
  },

  opts: {
    schema: {},
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeEvent(type: BasicType<unknown> | CompositeType<any>, event: BeaconEvent): EventMessage {
  return {
    event: event.type,
    data: JSON.stringify(type.toJson(event.message)),
  };
}

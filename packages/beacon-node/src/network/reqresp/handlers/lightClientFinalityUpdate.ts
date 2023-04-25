import {ContextBytesType, EncodedPayloadBytes, EncodedPayloadType, RespStatus, ResponseError} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientFinalityUpdate(chain: IBeaconChain): AsyncIterable<EncodedPayloadBytes> {
  const finalityUpdate = chain.lightClientServer.getFinalityUpdate();
  if (finalityUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: chain.config
        .getLightClientForkTypes(chain.clock.currentSlot)
        .LightClientFinalityUpdate.serialize(finalityUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: chain.config.getForkName(chain.clock.currentSlot),
      },
    };
  }
}

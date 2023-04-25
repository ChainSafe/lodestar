import {ForkName} from "@lodestar/params";
import {ContextBytesType, EncodedPayloadBytes, EncodedPayloadType, RespStatus, ResponseError} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientFinalityUpdate(chain: IBeaconChain): AsyncIterable<EncodedPayloadBytes> {
  const finalityUpdate = chain.lightClientServer.getFinalityUpdate();
  if (finalityUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: ssz.altair.LightClientFinalityUpdate.serialize(finalityUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: ForkName.altair,
      },
    };
  }
}

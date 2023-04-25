import {ContextBytesType, EncodedPayloadBytes, EncodedPayloadType, ResponseError, RespStatus} from "@lodestar/reqresp";
import {allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientOptimisticUpdate(chain: IBeaconChain): AsyncIterable<EncodedPayloadBytes> {
  const optimisticUpdate = chain.lightClientServer.getOptimisticUpdate();
  if (optimisticUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  } else {
    yield {
      type: EncodedPayloadType.bytes,
      bytes: ssz.altair.LightClientOptimisticUpdate.serialize(optimisticUpdate),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        fork: ForkName.altair,
      },
    };
  }
}

import {EncodedPayload, EncodedPayloadType, ResponseError, RespStatus} from "@lodestar/reqresp";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientOptimisticUpdate(
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<allForks.LightClientOptimisticUpdate>> {
  const optimisticUpdate = chain.lightClientServer.getOptimisticUpdate();
  if (optimisticUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  } else {
    yield {
      type: EncodedPayloadType.ssz,
      data: optimisticUpdate,
    };
  }
}

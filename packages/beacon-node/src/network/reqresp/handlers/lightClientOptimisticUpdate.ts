import {EncodedPayload, EncodedPayloadType, ResponseError, RespStatus} from "@lodestar/reqresp";
import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientOptimisticUpdate(
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<altair.LightClientOptimisticUpdate>> {
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

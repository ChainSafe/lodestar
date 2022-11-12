import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";
import {EncodedPayload, EncodedPayloadType} from "../types.js";

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

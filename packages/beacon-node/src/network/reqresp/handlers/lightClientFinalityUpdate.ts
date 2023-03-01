import {EncodedPayload, ResponseError, RespStatus, EncodedPayloadType} from "@lodestar/reqresp";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientFinalityUpdate(
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<allForks.LightClientFinalityUpdate>> {
  const finalityUpdate = chain.lightClientServer.getFinalityUpdate();
  if (finalityUpdate === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest finality update available");
  } else {
    yield {
      type: EncodedPayloadType.ssz,
      data: finalityUpdate,
    };
  }
}

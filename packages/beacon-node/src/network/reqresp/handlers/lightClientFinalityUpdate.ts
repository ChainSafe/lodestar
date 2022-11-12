import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";
import {EncodedPayload, EncodedPayloadType} from "../types.js";

export async function* onLightClientFinalityUpdate(
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<altair.LightClientFinalityUpdate>> {
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

import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {IBeaconChain} from "../../../chain/index.js";
import {assertLightClientServerEnabled} from "../../../node/utils/lightclient.js";

export async function* onLightClientOptimisticUpdate(chain: IBeaconChain): AsyncIterable<ResponseOutgoing> {
  assertLightClientServerEnabled(chain.opts.disableLightClientServer);

  const update = await chain.beaconEngine.getLightClientOptimisticUpdate();
  if (update === null) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No latest optimistic update available");
  }

  const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(update.slot));
  yield {
    data: update.data,
    boundary,
  };
}

import {allForks, phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlocksByRange: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRangeRequest,
  allForks.SignedBeaconBlock
> = (_modules, handler) => {
  return {
    method: "beacon_blocks_by_range",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.BeaconBlocksByRangeRequest,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    renderRequestBody: (req) => `${req.startSlot},${req.step},${req.count}`,
    contextBytes: {type: ContextBytesType.Empty},
  };
};

import fs from "node:fs";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {config as chainConfig} from "@lodestar/config/default";

const config: ChainForkConfig = createChainForkConfig(chainConfig);
const SLOT_BYTES_POSITION_IN_STATE = 40;
const SLOT_BYTE_COUNT = 8;

describe("load mainnet state and processSlots", function () {
  this.timeout(0);

  it.only("load mathew state", async () => {
    const filePath = "/Users/tuyennguyen/Downloads/state_mainnet_6123583.ssz";
    const bytes = fs.readFileSync(filePath);
    console.log("bytes.length", bytes.length);
    const slot = bytesToInt(
      bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT)
    );
    console.log("slot", slot);
    // const state = ssz.phase0.BeaconState.deserialize(bytes);
    const state = config.getForkTypes(slot).BeaconState.deserializeToViewDU(bytes);
    console.log("loaded state", state.slot);
  });
});

// export function getStateTypeFromBytes(
//   config: ChainForkConfig,
//   bytes: Buffer | Uint8Array
// ): allForks.AllForksSSZTypes["BeaconState"] {
//   const slot = bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
//   return config.getForkTypes(slot).BeaconState;
// }

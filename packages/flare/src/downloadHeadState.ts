import {getClient} from "@lodestar/api";
import {gnosisChainConfig as chainConfig} from "@lodestar/config/networks";
import {createIChainForkConfig} from "@lodestar/config";
import {getStateTypeFromBytes} from "@lodestar/beacon-node";
import {bytesToInt} from "@lodestar/utils";
import {Slot} from "@lodestar/types";

/* eslint-disable
no-console,
@typescript-eslint/explicit-function-return-type,
@typescript-eslint/naming-convention
*/

const SLOT_BYTE_COUNT = 8;
const SLOT_BYTES_POSITION_IN_STATE = 40;

export async function downloadHeadState() {
  const config = createIChainForkConfig({
    ...chainConfig,
    // chiado and denver specs
    ALTAIR_FORK_EPOCH: 90,
    BELLATRIX_FORK_EPOCH: 180,
  });

  const client = getClient({baseUrl: "http://localhost:4000"}, {config});

  const stateBytes = await client.debug.getStateV2("head", "ssz");

  const stateType = getStateTypeFromBytes(config, stateBytes);

  const slot = getStateSlotFromBytes(stateBytes);
  const stateFork = config.getForkName(slot);

  console.log("Parsing state", {slot, stateFork});

  const state = stateType.deserialize(stateBytes);

  const fork = config.getForkName(state.slot);
  console.log("Downloaded state", {fork});

  return {state, config, fork};
}

function getStateSlotFromBytes(stateBytes: Uint8Array): Slot {
  return bytesToInt(stateBytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
}

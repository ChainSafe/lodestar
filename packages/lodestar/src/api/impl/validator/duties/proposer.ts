import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../../../../db/api";
import {BLSPubkey, Epoch, Slot} from "@chainsafe/eth2.0-types";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBeaconProposerIndex,
  processSlots
} from "@chainsafe/eth2.0-state-transition";
import assert from "assert";
import {IBeaconChain} from "../../../../chain";

export async function getEpochProposers(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  epoch: Epoch
): Promise<Map<Slot, BLSPubkey>> {
  const block = await db.block.get(chain.forkChoice.head());
  const state = await db.state.get(block.message.stateRoot.valueOf() as Uint8Array);
  assert(epoch >= 0 && epoch <= computeEpochAtSlot(config, state.slot) + 2);
  const startSlot = computeStartSlotAtEpoch(config, epoch);
  if(state.slot < startSlot) {
    processSlots(config, state, startSlot);
  }
  const slotProposerMapping: Map<Slot, BLSPubkey> = new Map();

  for(let slot = startSlot; slot < startSlot + config.params.SLOTS_PER_EPOCH; slot ++) {
    const blockProposerIndex = getBeaconProposerIndex(config, {...state, slot});
    slotProposerMapping.set(slot, state.validators[blockProposerIndex].pubkey);
  }
  return slotProposerMapping;
}

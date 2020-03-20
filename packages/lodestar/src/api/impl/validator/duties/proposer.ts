import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../../../db/api";
import {BLSPubkey, Epoch, Slot} from "@chainsafe/lodestar-types";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBeaconProposerIndex,
  processSlots
} from "@chainsafe/lodestar-beacon-state-transition";
import assert from "assert";
import {IBeaconChain} from "../../../../chain";

export async function getEpochProposers(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  epoch: Epoch
): Promise<Map<Slot, BLSPubkey>> {
  const state = await db.state.get(chain.forkChoice.headStateRoot());
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

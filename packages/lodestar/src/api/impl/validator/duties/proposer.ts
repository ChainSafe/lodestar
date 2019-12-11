import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../../../../db/api";
import {BLSPubkey, Epoch, Slot} from "@chainsafe/eth2.0-types";
import {computeStartSlotAtEpoch, getBeaconProposerIndex, processSlots} from "@chainsafe/eth2.0-state-transition";

export async function getEpochProposers(
  config: IBeaconConfig,
  db: IBeaconDb,
  epoch: Epoch
): Promise<Map<Slot, BLSPubkey>> {
  const state = await db.state.getLatest();
  //TODO: assert epoch isn't too far ahead
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
import {computeStartSlotOfEpoch, getBeaconProposerIndex} from "../../../chain/stateTransition/util";
import {assembleValidatorDuty} from "../../../chain/factory/duties";
import {BLSPubkey, Epoch, ValidatorDuty, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {processSlots} from "../../../chain/stateTransition";

export async function getValidatorDuties(
  config: IBeaconConfig,
  db: IBeaconDb,
  validatorPublicKeys: BLSPubkey[],
  epoch: Epoch
): Promise<ValidatorDuty[]> {
  const state = await db.state.getLatest();

  const validatorIndexes = await Promise.all(validatorPublicKeys.map(async publicKey => {
    return  state.validators.findIndex((v) => v.pubkey.equals(publicKey));
  }));

  const startSlot = computeStartSlotOfEpoch(config, epoch);
  if(state.slot < startSlot) {
    processSlots(config, state, startSlot);
  }
  const slotProposerMapping = {};

  for(let slot = startSlot; slot < startSlot + config.params.SLOTS_PER_EPOCH; slot ++) {
    const blockProposerIndex = getBeaconProposerIndex(config, {...state, slot});
    slotProposerMapping[blockProposerIndex] = slot;
  }

  return validatorPublicKeys.map(
    (validatorPublicKey: BLSPubkey, index: number) => {
      const validatorIndex: ValidatorIndex = validatorIndexes[index] as ValidatorIndex;
      return assembleValidatorDuty(
        config,
        {
          publicKey: validatorPublicKey,
          index: validatorIndex
        },
        state,
        epoch,
        slotProposerMapping
      );
    }
  );
}

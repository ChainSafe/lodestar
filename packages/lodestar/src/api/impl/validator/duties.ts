import {computeStartSlotOfEpoch, getBeaconProposerIndex} from "../../../chain/stateTransition/util";
import {assembleValidatorDuty} from "../../../chain/factory/duties";
import {BLSPubkey, Epoch, ValidatorDuty} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export async function getValidatorDuties(config: IBeaconConfig, db: IBeaconDb, validatorPublicKeys: BLSPubkey[], epoch: Epoch): Promise<ValidatorDuty[]> {
  const state = await db.state.getLatest();

  const validatorIndexes = await Promise.all(validatorPublicKeys.map(async publicKey => {
    return  await db.getValidatorIndex(publicKey);
  }));

  const startSlot = computeStartSlotOfEpoch(config, epoch);

  const slotProposerMapping = {};

  for(let slot = startSlot; slot < startSlot + config.params.SLOTS_PER_EPOCH; slot ++) {
    const blockProposerIndex = getBeaconProposerIndex(config, {...state, slot});
    slotProposerMapping[blockProposerIndex] = slot;
  }

  return validatorPublicKeys.map(
    (validatorPublicKey, index) => {
      const validatorIndex = validatorIndexes[index];
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
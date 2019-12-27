import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../../../../db/api";
import {BLSPubkey, Epoch, ValidatorDuty} from "@chainsafe/eth2.0-types";
import {assembleValidatorDuty} from "../../../../chain/factory/duties";
import {IBeaconChain} from "../../../../chain";

export async function getAttesterDuties(
  config: IBeaconConfig,
  db: IBeaconDb,
  chain: IBeaconChain,
  epoch: Epoch,
  publicKeys: BLSPubkey[]
): Promise<ValidatorDuty[]> {
  const block = await db.block.get(chain.forkChoice.head());
  const state = await db.state.get(block.stateRoot);

  const validatorIndexes = await Promise.all(publicKeys.map(async publicKey => {
    return  state.validators.findIndex((v) => v.pubkey.equals(publicKey));
  }));

  return validatorIndexes.map((validatorIndex) => {
    return assembleValidatorDuty(
      config,
      {publicKey: state.validators[validatorIndex].pubkey, index: validatorIndex},
      state,
      epoch
    );
  });

}
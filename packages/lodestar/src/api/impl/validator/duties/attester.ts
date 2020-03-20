import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../../../db/api";
import {BLSPubkey, Epoch, ValidatorDuty} from "@chainsafe/lodestar-types";
import {assembleValidatorDuty} from "../../../../chain/factory/duties";
import {IBeaconChain} from "../../../../chain";

export async function getAttesterDuties(
  config: IBeaconConfig,
  db: IBeaconDb,
  chain: IBeaconChain,
  epoch: Epoch,
  publicKeys: BLSPubkey[]
): Promise<ValidatorDuty[]> {
  const state = await db.state.get(chain.forkChoice.headStateRoot());

  const validatorIndexes = await Promise.all(publicKeys.map(async publicKey => {
    return  state.validators.findIndex((v) => config.types.BLSPubkey.equals(v.pubkey, publicKey));
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

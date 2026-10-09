import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {gloas, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";

/**
 * SignedProposerPreferences indexed by proposal slot and dependent root
 *
 * Added via events or api of the beacon node
 * Removed once the proposal slot has passed
 */
export class ProposerPreferencesRepository extends Repository<Uint8Array, gloas.SignedProposerPreferences> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, 0, ssz.gloas.SignedProposerPreferences, "proposerPreferences");
  }

  getId(value: gloas.SignedProposerPreferences): Uint8Array {
    const {proposalSlot, dependentRoot} = value.message;
    return Buffer.concat([intToBytes(proposalSlot, 8, "be"), dependentRoot]);
  }
}

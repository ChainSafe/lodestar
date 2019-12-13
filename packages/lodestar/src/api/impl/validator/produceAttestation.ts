import {assembleAttestation} from "../../../chain/factory/attestation";
import {Attestation, BLSPubkey, CommitteeIndex, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain} from "../../../chain";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {processSlots} from "@chainsafe/eth2.0-state-transition";

export async function produceAttestation(
  {config, db, chain}: {config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain},
  validatorPubKey: BLSPubkey,
  index: CommitteeIndex,
  slot: Slot
): Promise<Attestation|null> {
  try {
    const [headBlock, validatorIndex] = await Promise.all([
      db.block.get(chain.forkChoice.head()),
      db.getValidatorIndex(validatorPubKey)
    ]);
    const headState = await db.state.get(headBlock.stateRoot);
    await processSlots(config, headState, slot);
    return await assembleAttestation({config, db}, headState, headBlock, validatorIndex, index, slot);
  } catch (e) {
    throw e;
  }
}
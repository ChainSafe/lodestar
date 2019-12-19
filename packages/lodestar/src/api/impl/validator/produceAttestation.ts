import {assembleAttestation} from "../../../chain/factory/attestation";
import {Attestation, BeaconState, BLSPubkey, Shard, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain} from "../../../chain";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {clone} from "@chainsafe/ssz";

export async function produceAttestation(
  {config, db, chain}: {config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain},
  validatorPubKey: BLSPubkey,
  shard: Shard,
  slot: Slot
): Promise<Attestation|null> {
  const [headState, headBlock, validatorIndex] = await Promise.all([
    clone(config.types.BeaconState, chain.latestState) as BeaconState,
    db.block.get(chain.forkChoice.head()),
    db.getValidatorIndex(validatorPubKey)
  ]);
  return await assembleAttestation({config, db}, headState, headBlock, validatorIndex, shard, slot);
}

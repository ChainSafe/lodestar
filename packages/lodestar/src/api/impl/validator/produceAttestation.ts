import {assembleAttestation} from "../../../chain/factory/attestation";
import {Attestation, BLSPubkey, Shard, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain} from "../../../chain";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export async function produceAttestation(
  {config, db, chain}: {config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain},
  validatorPubKey: BLSPubkey,
  shard: Shard,
  slot: Slot
): Promise<Attestation> {
  const [headState, headBlock, validatorIndex] = await Promise.all([
    db.state.getLatest(),
    db.block.get(chain.forkChoice.head()),
    db.getValidatorIndex(validatorPubKey)
  ]);
  return  await assembleAttestation({config, db}, headState, headBlock, validatorIndex, shard, slot);
}
import {assembleAttestation} from "../../../chain/factory/attestation";
import {BLSPubkey, IndexedAttestation, Shard, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain} from "../../../chain";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {getIndexedAttestation} from "../../../chain/stateTransition/util";

export async function produceAttestation(
  {config, db, chain}: {config: IBeaconConfig; db: IBeaconDb; chain: IBeaconChain},
  validatorPubKey: BLSPubkey,
  shard: Shard,
  slot: Slot
): Promise<IndexedAttestation> {
  const [headState, headBlock, validatorIndex] = await Promise.all([
    db.state.getLatest(),
    db.block.get(chain.forkChoice.head()),
    db.getValidatorIndex(validatorPubKey)
  ]);
  const attestation = await assembleAttestation({config, db}, headState, headBlock, validatorIndex, shard, slot);
  return getIndexedAttestation(config, headState, attestation);
}
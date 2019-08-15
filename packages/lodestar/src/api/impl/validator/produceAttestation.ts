import {assembleAttestation} from "../../../chain/factory/attestation";
import {IndexedAttestation, Shard, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain} from "../../../chain";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export async function produceAttestation(config: IBeaconConfig, db: IBeaconDb, chain: IBeaconChain, shard: Shard, slot: Slot): Promise<IndexedAttestation> {
  const [headState, headBlock] = await Promise.all([
    db.state.getLatest(),
    db.block.get(chain.forkChoice.head())
  ]);
  return await assembleAttestation(config, db, headState, headBlock, shard, slot);
}
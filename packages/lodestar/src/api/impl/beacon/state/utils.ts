// this will need async once we wan't to resolve archive slot
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILMDGHOST} from "../../../../chain/forkChoice";
import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../../../db/api";
import {StateId} from "./interface";
import {fromHexString} from "@chainsafe/ssz";

export async function resolveStateId(
  config: IBeaconConfig, db: IBeaconDb, forkChoice: ILMDGHOST, stateId: StateId
): Promise<BeaconState|null> {
  stateId = stateId.toLowerCase();
  if(stateId === "head") {
    return (await db.stateCache.get(forkChoice.headStateRoot()))?.state ?? null;
  }
  if(stateId === "genesis") {
    return db.stateArchive.get(0);
  }
  if(stateId === "finalized") {
    return (await db.stateCache.get(forkChoice.getFinalized()?.root))?.state ?? null;
  }
  if(stateId === "justified") {
    return (await db.stateCache.get(forkChoice.getJustified()?.root))?.state ?? null;
  }
  if(stateId.startsWith("0x")) {
    //TODO: support getting finalized states by root as well
    return (await db.stateCache.get(fromHexString(stateId)))?.state ?? null;
  }
  //block id must be slot
  const slot = parseInt(stateId, 10);
  if(isNaN(slot) && isNaN(slot - 0)) {
    throw new Error("Invalid block id");
  }
  //todo: resolve archive slot -> state
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if(blockSummary) {
    return (await db.stateCache.get(blockSummary.stateRoot))?.state ?? null;
  }

  return null;
}

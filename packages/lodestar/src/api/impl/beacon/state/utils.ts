// this will need async once we wan't to resolve archive slot
import {computeEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {
  Epoch,
  Validator,
  ValidatorIndex,
  BLSPubkey,
  ValidatorStatus,
  ValidatorResponse,
} from "@chainsafe/lodestar-types";
import {fromHexString, readOnlyMap} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db/api";
import {ApiStateContext, StateId} from "./interface";

export async function resolveStateId(
  config: IBeaconConfig,
  db: IBeaconDb,
  forkChoice: IForkChoice,
  stateId: StateId
): Promise<ApiStateContext | null> {
  stateId = stateId.toLowerCase();
  if (stateId === "head") {
    return (await db.stateCache.get(forkChoice.getHead().stateRoot)) ?? null;
  }
  if (stateId === "genesis") {
    const state = await db.stateArchive.get(0);
    if (!state) return null;
    return {
      state,
    };
  }
  if (stateId === "finalized") {
    return (await db.stateCache.get(forkChoice.getFinalizedCheckpoint().root)) ?? null;
  }
  if (stateId === "justified") {
    return (await db.stateCache.get(forkChoice.getJustifiedCheckpoint().root)) ?? null;
  }
  if (stateId.startsWith("0x")) {
    //TODO: support getting finalized states by root as well
    return (await db.stateCache.get(fromHexString(stateId))) ?? null;
  }
  //block id must be slot
  const slot = parseInt(stateId, 10);
  if (isNaN(slot) && isNaN(slot - 0)) {
    throw new Error("Invalid block id");
  }
  //todo: resolve archive slot -> state
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (blockSummary) {
    return (await db.stateCache.get(blockSummary.stateRoot)) ?? null;
  }

  return null;
}

export function toValidatorResponse(index: ValidatorIndex, validator: Validator): ValidatorResponse {
  return {
    index,
    status: ValidatorStatus.ACTIVE,
    pubkey: validator.pubkey,
    validator,
  };
}

/**
 * Returns committees mapped by index -> slot -> validator index
 */
export function getEpochBeaconCommittees(
  config: IBeaconConfig,
  chain: IBeaconChain,
  stateContext: ApiStateContext,
  epoch: Epoch
): ValidatorIndex[][][] {
  let committees: ValidatorIndex[][][] | null = null;
  if (stateContext.epochCtx) {
    switch (epoch) {
      case chain.clock.currentEpoch: {
        committees = stateContext.epochCtx.currentShuffling.committees;
        break;
      }
      case chain.clock.currentEpoch - 1: {
        committees = stateContext.epochCtx.previousShuffling.committees;
        break;
      }
    }
  }
  if (!committees) {
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = readOnlyMap(stateContext.state.validators, (v, i) => [
      i,
      v.activationEpoch,
      v.exitEpoch,
    ]);

    const shuffling = computeEpochShuffling(config, stateContext.state, indicesBounded, epoch);
    committees = shuffling.committees;
  }
  return committees;
}

export function validatorPubkeyToIndex(
  config: IBeaconConfig,
  stateCtx: ApiStateContext,
  pubkey: BLSPubkey
): ValidatorIndex | null {
  if (stateCtx.epochCtx) {
    return stateCtx.epochCtx.pubkey2index.get(pubkey) ?? null;
  }
  for (const [index, validator] of Array.from(stateCtx.state.validators).entries()) {
    if (config.types.BLSPubkey.equals(validator.pubkey, pubkey)) {
      return index;
    }
  }
  return null;
}

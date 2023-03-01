import {BitArray, byteArrayEquals} from "@chainsafe/ssz";
import {FINALIZED_ROOT_DEPTH, NEXT_SYNC_COMMITTEE_DEPTH, ForkSeq, ForkName} from "@lodestar/params";
import {altair, phase0, ssz, allForks, capella, deneb} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";

export const GENESIS_SLOT = 0;
export const ZERO_HASH = new Uint8Array(32);
export const ZERO_PUBKEY = new Uint8Array(48);
export const ZERO_SYNC_COMMITTEE = ssz.altair.SyncCommittee.defaultValue();
export const ZERO_NEXT_SYNC_COMMITTEE_BRANCH = Array.from({length: NEXT_SYNC_COMMITTEE_DEPTH}, () => ZERO_HASH);
export const ZERO_HEADER = ssz.phase0.BeaconBlockHeader.defaultValue();
export const ZERO_FINALITY_BRANCH = Array.from({length: FINALIZED_ROOT_DEPTH}, () => ZERO_HASH);
/** From https://notes.ethereum.org/@vbuterin/extended_light_client_protocol#Optimistic-head-determining-function */
const SAFETY_THRESHOLD_FACTOR = 2;

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}

export function getSafetyThreshold(maxActiveParticipants: number): number {
  return Math.floor(maxActiveParticipants / SAFETY_THRESHOLD_FACTOR);
}

export function isSyncCommitteeUpdate(update: allForks.LightClientUpdate): boolean {
  return (
    // Fast return for when constructing full LightClientUpdate from partial updates
    update.nextSyncCommitteeBranch !== ZERO_NEXT_SYNC_COMMITTEE_BRANCH &&
    update.nextSyncCommitteeBranch.some((branch) => !byteArrayEquals(branch, ZERO_HASH))
  );
}

export function isFinalityUpdate(update: allForks.LightClientUpdate): boolean {
  return (
    // Fast return for when constructing full LightClientUpdate from partial updates
    update.finalityBranch !== ZERO_FINALITY_BRANCH &&
    update.finalityBranch.some((branch) => !byteArrayEquals(branch, ZERO_HASH))
  );
}

export function isZeroedHeader(header: phase0.BeaconBlockHeader): boolean {
  // Fast return for when constructing full LightClientUpdate from partial updates
  return header === ZERO_HEADER || byteArrayEquals(header.bodyRoot, ZERO_HASH);
}

export function isZeroedSyncCommittee(syncCommittee: altair.SyncCommittee): boolean {
  // Fast return for when constructing full LightClientUpdate from partial updates
  return syncCommittee === ZERO_SYNC_COMMITTEE || byteArrayEquals(syncCommittee.pubkeys[0], ZERO_PUBKEY);
}

export function upgradeLightClientHeader(
  config: ChainForkConfig,
  targetFork: ForkName,
  header: altair.LightClientHeader
): allForks.LightClientHeader {
  const headerFork = config.getForkName(header.beacon.slot);
  if (ForkSeq[headerFork] >= ForkSeq[targetFork]) {
    throw Error(`Invalid upgrade request from headerFork=${headerFork} to targetFork=${targetFork}`);
  }

  // We are modifying the same header object, may be we could create a copy, but its
  // not required as of now
  const upgradedHeader = header as allForks.LightClientHeader;
  const startUpgradeFromFork = Object.values(ForkName)[ForkSeq[headerFork] + 1];

  switch (startUpgradeFromFork) {
    default:
      throw Error(
        `Invalid startUpgradeFromFork=${startUpgradeFromFork} for headerFork=${headerFork} in upgradeLightClientHeader to targetFork=${targetFork}`
      );

    case ForkName.altair:
    case ForkName.bellatrix:
      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.bellatrix) break;
    // eslint-disable-next-line no-fallthrough

    case ForkName.capella:
      (upgradedHeader as capella.LightClientHeader).execution = ssz.capella.LightClientHeader.fields.execution.defaultValue();
      (upgradedHeader as capella.LightClientHeader).executionBranch = ssz.capella.LightClientHeader.fields.executionBranch.defaultValue();

      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.capella) break;
    // eslint-disable-next-line no-fallthrough

    case ForkName.deneb:
      (upgradedHeader as deneb.LightClientHeader).execution.excessDataGas = ssz.deneb.LightClientHeader.fields.execution.fields.excessDataGas.defaultValue();

      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.deneb) break;
    // eslint-disable-next-line no-fallthrough
  }
  return upgradedHeader;
}

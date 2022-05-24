import {allForks, altair} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, ISignatureSet} from "../../util/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../../types.js";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings.js";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings.js";
import {getAttestationsSignatureSets} from "./indexedAttestation.js";
import {getProposerSignatureSet} from "./proposer.js";
import {getRandaoRevealSignatureSet} from "./randao.js";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits.js";
import {getSyncCommitteeSignatureSet} from "../../altair/block/processSyncCommittee.js";

export * from "./attesterSlashings.js";
export * from "./indexedAttestation.js";
export * from "./proposer.js";
export * from "./proposerSlashings.js";
export * from "./randao.js";
export * from "./voluntaryExits.js";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getAllBlockSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return [getProposerSignatureSet(state, signedBlock), ...getAllBlockSignatureSetsExceptProposer(state, signedBlock)];
}

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Useful since block proposer signature is verified beforehand on gossip validation
 */
export function getAllBlockSignatureSetsExceptProposer(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  const signatureSets = [
    getRandaoRevealSignatureSet(state, signedBlock.message),
    ...getProposerSlashingsSignatureSets(state, signedBlock),
    ...getAttesterSlashingsSignatureSets(state, signedBlock),
    ...getAttestationsSignatureSets(state, signedBlock),
    ...getVoluntaryExitsSignatureSets(state, signedBlock),
  ];

  // Only after altair fork, validate tSyncCommitteeSignature
  if (computeEpochAtSlot(signedBlock.message.slot) >= state.config.ALTAIR_FORK_EPOCH) {
    const syncCommitteeSignatureSet = getSyncCommitteeSignatureSet(
      state as CachedBeaconStateAltair,
      (signedBlock as altair.SignedBeaconBlock).message
    );
    // There may be no participants in this syncCommitteeSignature, so it must not be validated
    if (syncCommitteeSignatureSet) {
      signatureSets.push(syncCommitteeSignatureSet);
    }
  }

  return signatureSets;
}

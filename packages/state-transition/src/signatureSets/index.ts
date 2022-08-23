import {allForks, altair} from "@lodestar/types";
import {computeEpochAtSlot, ISignatureSet} from "../util/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../types.js";
import {getSyncCommitteeSignatureSet} from "../block/processSyncCommittee.js";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings.js";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings.js";
import {getAttestationsSignatureSets} from "./indexedAttestation.js";
import {getProposerSignatureSet} from "./proposer.js";
import {getRandaoRevealSignatureSet} from "./randao.js";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits.js";

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
export function getBlockSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock,
  opts?: {
    /** Useful since block proposer signature is verified beforehand on gossip validation */
    skipProposerSignature?: boolean;
  }
): ISignatureSet[] {
  const signatureSets = [
    getRandaoRevealSignatureSet(state, signedBlock.message),
    ...getProposerSlashingsSignatureSets(state, signedBlock),
    ...getAttesterSlashingsSignatureSets(state, signedBlock),
    ...getAttestationsSignatureSets(state, signedBlock),
    ...getVoluntaryExitsSignatureSets(state, signedBlock),
  ];

  if (!opts?.skipProposerSignature) {
    signatureSets.push(getProposerSignatureSet(state, signedBlock));
  }

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

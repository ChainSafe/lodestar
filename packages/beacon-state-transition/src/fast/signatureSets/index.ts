import {allForks} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../util";
import {CachedBeaconState} from "../util";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings";
import {getAttestationsSignatureSets} from "./indexedAttestation";
import {getProposerSignatureSet} from "./proposer";
import {getRandaoRevealSignatureSet} from "./randao";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits";

export * from "./attesterSlashings";
export * from "./indexedAttestation";
export * from "./proposer";
export * from "./proposerSlashings";
export * from "./randao";
export * from "./voluntaryExits";
export * from "./syncCommittee";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getAllBlockSignatureSets(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return [getProposerSignatureSet(state, signedBlock), ...getAllBlockSignatureSetsExceptProposer(state, signedBlock)];
}

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Useful since block proposer signature is verified beforehand on gossip validation
 */
export function getAllBlockSignatureSetsExceptProposer(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return [
    getRandaoRevealSignatureSet(state, signedBlock.message),
    ...getProposerSlashingsSignatureSets(state, signedBlock),
    ...getAttesterSlashingsSignatureSets(state, signedBlock),
    ...getAttestationsSignatureSets(state, signedBlock),
    ...getVoluntaryExitsSignatureSets(state, signedBlock),
  ];
}

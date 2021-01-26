import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {getRandaoRevealSignatureSet} from "../block/processRandao";
import {getBlockSignatureSet} from "../util/block";
import {ISignatureSet} from "./types";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings";
import {getAttestationsSignatureSets} from "./attestations";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits";
import {CachedBeaconState} from "../util/cachedBeaconState";

export * from "./types";
export * from "./verify";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getAllBlockSignatureSets(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return [
    getBlockSignatureSet(cachedState, signedBlock),
    ...getAllBlockSignatureSetsExceptProposer(cachedState, signedBlock),
  ];
}

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Useful since block proposer signature is verified beforehand on gossip validation
 */
export function getAllBlockSignatureSetsExceptProposer(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return [
    getRandaoRevealSignatureSet(cachedState, signedBlock.message),
    ...getProposerSlashingsSignatureSets(cachedState, signedBlock),
    ...getAttesterSlashingsSignatureSets(cachedState, signedBlock),
    ...getAttestationsSignatureSets(cachedState, signedBlock),
    ...getVoluntaryExitsSignatureSets(cachedState, signedBlock),
  ];
}

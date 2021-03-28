import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../../util";
import {getRandaoRevealSignatureSet} from "../block/processRandao";
import {CachedBeaconState, getBlockSignatureSet} from "../util";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings";
import {getAttestationsSignatureSets} from "./attestations";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getAllBlockSignatureSets(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return [getBlockSignatureSet(state, signedBlock), ...getAllBlockSignatureSetsExceptProposer(state, signedBlock)];
}

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Useful since block proposer signature is verified beforehand on gossip validation
 */
export function getAllBlockSignatureSetsExceptProposer(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return [
    getRandaoRevealSignatureSet(state, signedBlock.message),
    ...getProposerSlashingsSignatureSets(state, signedBlock),
    ...getAttesterSlashingsSignatureSets(state, signedBlock),
    ...getAttestationsSignatureSets(state, signedBlock),
    ...getVoluntaryExitsSignatureSets(state, signedBlock),
  ];
}

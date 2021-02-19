import {phase0} from "@chainsafe/lodestar-types";
import {getRandaoRevealSignatureSet} from "../block/processRandao";
import {getBlockSignatureSet} from "../util/block";
import {EpochContext} from "../index";
import {ISignatureSet} from "./types";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings";
import {getAttestationsSignatureSets} from "./attestations";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits";

export * from "./types";
export * from "./verify";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getAllBlockSignatureSets(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return [
    getBlockSignatureSet(epochCtx, state, signedBlock),
    ...getAllBlockSignatureSetsExceptProposer(epochCtx, state, signedBlock),
  ];
}

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Useful since block proposer signature is verified beforehand on gossip validation
 */
export function getAllBlockSignatureSetsExceptProposer(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return [
    getRandaoRevealSignatureSet(epochCtx, state, signedBlock.message),
    ...getProposerSlashingsSignatureSets(epochCtx, state, signedBlock),
    ...getAttesterSlashingsSignatureSets(epochCtx, state, signedBlock),
    ...getAttestationsSignatureSets(epochCtx, state, signedBlock),
    ...getVoluntaryExitsSignatureSets(epochCtx, state, signedBlock),
  ];
}

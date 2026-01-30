import {BeaconConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, altair, capella} from "@lodestar/types";
import {getSyncCommitteeSignatureSet} from "../block/processSyncCommittee.js";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {ISignatureSet} from "../util/index.js";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings.js";
import {getBlsToExecutionChangeSignatureSets} from "./blsToExecutionChange.js";
import {getAttestationsSignatureSets} from "./indexedAttestation.js";
import {getBlockProposerSignatureSet} from "./proposer.js";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings.js";
import {getRandaoRevealSignatureSet} from "./randao.js";
import {getVoluntaryExitsSignatureSets} from "./voluntaryExits.js";

export * from "./attesterSlashings.js";
export * from "./blsToExecutionChange.js";
export * from "./executionPayloadBid.js";
export * from "./executionPayloadEnvelope.js";
export * from "./indexedAttestation.js";
export * from "./indexedPayloadAttestation.js";
export * from "./proposer.js";
export * from "./proposerSlashings.js";
export * from "./randao.js";
export * from "./voluntaryExits.js";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getBlockSignatureSets(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  currentSyncCommitteeIndexed: SyncCommitteeCache,
  signedBlock: SignedBeaconBlock,
  indexedAttestations: IndexedAttestation[],
  opts?: {
    /** Useful since block proposer signature is verified beforehand on gossip validation */
    skipProposerSignature?: boolean;
  }
): ISignatureSet[] {
  // fork based validations
  const fork = config.getForkSeq(signedBlock.message.slot);

  const signatureSets = [
    getRandaoRevealSignatureSet(config, index2pubkey, signedBlock.message),
    ...getProposerSlashingsSignatureSets(config, index2pubkey, signedBlock),
    ...getAttesterSlashingsSignatureSets(config, index2pubkey, signedBlock),
    ...getAttestationsSignatureSets(config, index2pubkey, signedBlock, indexedAttestations),
    ...getVoluntaryExitsSignatureSets(config, index2pubkey, signedBlock),
  ];

  if (!opts?.skipProposerSignature) {
    signatureSets.push(getBlockProposerSignatureSet(config, index2pubkey, signedBlock));
  }

  // Only after altair fork, validate tSyncCommitteeSignature
  if (fork >= ForkSeq.altair) {
    const syncCommitteeSignatureSet = getSyncCommitteeSignatureSet(
      config,
      index2pubkey,
      currentSyncCommitteeIndexed,
      (signedBlock as altair.SignedBeaconBlock).message
    );
    // There may be no participants in this syncCommitteeSignature, so it must not be validated
    if (syncCommitteeSignatureSet) {
      signatureSets.push(syncCommitteeSignatureSet);
    }
  }

  // only after capella fork
  if (fork >= ForkSeq.capella) {
    const blsToExecutionChangeSignatureSets = getBlsToExecutionChangeSignatureSets(
      config,
      signedBlock as capella.SignedBeaconBlock
    );
    if (blsToExecutionChangeSignatureSets.length > 0) {
      signatureSets.push(...blsToExecutionChangeSignatureSets);
    }
  }

  return signatureSets;
}

import {BeaconConfig} from "@lodestar/config";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, altair, capella, gloas} from "@lodestar/types";
import {getSyncCommitteeSignatureSet} from "../block/processSyncCommittee.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {IBeaconStateView, isStatePostGloas} from "../stateView/interface.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {ISignatureSet} from "../util/index.js";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings.js";
import {getBlsToExecutionChangeSignatureSets} from "./blsToExecutionChange.js";
import {getAttestationsSignatureSets} from "./indexedAttestation.js";
import {getIndexedPayloadAttestationSignatureSet} from "./indexedPayloadAttestation.js";
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
export * from "./proposerPreferences.js";
export * from "./proposerSlashings.js";
export * from "./randao.js";
export * from "./voluntaryExits.js";

/**
 * Includes all signatures on the block (except the deposit signatures) for verification.
 * Deposits are not included because they can legally have invalid signatures.
 */
export function getBlockSignatureSets(
  config: BeaconConfig,
  currentSyncCommitteeIndexed: SyncCommitteeCache,
  state: IBeaconStateView,
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
    getRandaoRevealSignatureSet(config, signedBlock.message),
    ...getProposerSlashingsSignatureSets(config, signedBlock),
    ...getAttesterSlashingsSignatureSets(config, signedBlock),
    ...getAttestationsSignatureSets(config, signedBlock, indexedAttestations),
    ...getVoluntaryExitsSignatureSets(config, state, signedBlock),
  ];

  if (!opts?.skipProposerSignature) {
    signatureSets.push(getBlockProposerSignatureSet(config, signedBlock));
  }

  // Only after altair fork, validate tSyncCommitteeSignature
  if (fork >= ForkSeq.altair) {
    const syncCommitteeSignatureSet = getSyncCommitteeSignatureSet(
      config,
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

  // only after gloas fork
  if (fork >= ForkSeq.gloas) {
    if (!isStatePostGloas(state)) {
      throw Error("Expected gloas state to verify payload attestation signatures");
    }
    for (const payloadAttestation of (signedBlock as gloas.SignedBeaconBlock).message.body.payloadAttestations) {
      // `process_payload_attestation` asserts `data.slot + 1 == state.slot`, so the committee is
      // always for the block's previous slot and therefore in the current or next PTC epoch.
      const {slot} = payloadAttestation.data;
      const ptc = state.getEpochPTCs(computeEpochAtSlot(slot))[slot % SLOTS_PER_EPOCH];
      const attestingIndices = payloadAttestation.aggregationBits.intersectValues(ptc);
      signatureSets.push(
        getIndexedPayloadAttestationSignatureSet(config, {
          attestingIndices: attestingIndices.sort((a, b) => a - b),
          data: payloadAttestation.data,
          signature: payloadAttestation.signature,
        })
      );
    }
  }

  return signatureSets;
}

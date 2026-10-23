import {BeaconConfig} from "@lodestar/config";
import {ForkPreEip8453, ForkSeq} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, Slot, altair, capella, eip8453, gloas} from "@lodestar/types";
import {getSyncCommitteeSignatureSet} from "../block/processSyncCommittee.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {IBeaconStateView, IBeaconStateViewGloas} from "../stateView/interface.js";
import {ISignatureSet, createAggregateSignatureSetFromComponents} from "../util/index.js";
import {
  getAttesterSlashingSignatureSets,
  getAttesterSlashingSignatureSetsEip8453,
  getAttesterSlashingsSignatureSets,
} from "./attesterSlashings.js";
import {getBlsToExecutionChangeSignatureSets} from "./blsToExecutionChange.js";
import {
  getAttestationsSignatureSets,
  getHeadVoteSignatureSet,
  getIndexedAttestationSignatureSetEip8453,
} from "./indexedAttestation.js";
import {getPayloadAttestationDataSigningRoot} from "./indexedPayloadAttestation.js";
import {getBlockProposerSignatureSet} from "./proposer.js";
import {getProposerSlashingsSignatureSets} from "./proposerSlashings.js";
import {getRandaoRevealSignatureSet} from "./randao.js";
import {getVoluntaryExitSignatureSet} from "./voluntaryExits.js";

export * from "./attesterSlashings.js";
export * from "./blsToExecutionChange.js";
export * from "./executionPayloadBid.js";
export * from "./executionPayloadEnvelope.js";
export * from "./inclusionList.js";
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
    /** EIP8453 head votes are signed by the head vote committee of their slot, which the caller resolves */
    getHeadVoteCommittee?: (slot: Slot) => Uint32Array;
  }
): ISignatureSet[] {
  // fork based validations
  const fork = config.getForkSeq(signedBlock.message.slot);
  const blockSlot = signedBlock.message.slot;

  const signatureSets = [
    getRandaoRevealSignatureSet(config, signedBlock.message),
    ...getProposerSlashingsSignatureSets(config, signedBlock),
    ...signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
      getVoluntaryExitSignatureSet(config, state, voluntaryExit)
    ),
  ];

  if (fork >= ForkSeq.eip8453) {
    const body = (signedBlock as eip8453.SignedBeaconBlock).message.body;
    if (indexedAttestations.length !== body.attestations.length) {
      throw Error(
        `Indexed attestations length mismatch: got ${indexedAttestations.length}, expected ${body.attestations.length}`
      );
    }
    for (const attesterSlashing of body.attesterSlashings) {
      signatureSets.push(...getAttesterSlashingSignatureSetsEip8453(config, blockSlot, attesterSlashing));
    }
    for (const attesterSlashing of body.legacyAttesterSlashings) {
      signatureSets.push(...getAttesterSlashingSignatureSets(config, blockSlot, attesterSlashing));
    }
    for (const indexedAttestation of indexedAttestations as eip8453.IndexedAttestation[]) {
      signatureSets.push(getIndexedAttestationSignatureSetEip8453(config, blockSlot, indexedAttestation));
    }
    if (body.headVotes.length > 0) {
      const getHeadVoteCommittee = opts?.getHeadVoteCommittee;
      if (getHeadVoteCommittee === undefined) {
        throw Error("getHeadVoteCommittee is required to verify EIP8453 head votes");
      }
      for (const headVote of body.headVotes) {
        signatureSets.push(
          getHeadVoteSignatureSet(config, blockSlot, headVote, getHeadVoteCommittee(headVote.data.slot))
        );
      }
    }
  } else {
    const signedBlockPre = signedBlock as SignedBeaconBlock<ForkPreEip8453>;
    signatureSets.push(
      ...getAttesterSlashingsSignatureSets(config, signedBlockPre),
      ...getAttestationsSignatureSets(
        config,
        signedBlockPre,
        indexedAttestations as IndexedAttestation<ForkPreEip8453>[]
      )
    );
  }

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

  if (fork >= ForkSeq.gloas) {
    for (const payloadAttestation of (signedBlock as gloas.SignedBeaconBlock).message.body.payloadAttestations) {
      const ptc = (state as IBeaconStateViewGloas).getPayloadTimelinessCommittee(payloadAttestation.data.slot);
      signatureSets.push(
        createAggregateSignatureSetFromComponents(
          payloadAttestation.aggregationBits.intersectValues(ptc),
          getPayloadAttestationDataSigningRoot(config, payloadAttestation.data),
          payloadAttestation.signature
        )
      );
    }
  }

  return signatureSets;
}

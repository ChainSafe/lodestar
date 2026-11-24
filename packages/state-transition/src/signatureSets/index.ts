import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, ForkSeq} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, altair, capella, gloas} from "@lodestar/types";
import {getSyncCommitteeSignatureSet} from "../block/processSyncCommittee.js";
import {SyncCommitteeCache} from "../cache/syncCommitteeCache.js";
import {IBeaconStateView, IBeaconStateViewGloas} from "../stateView/interface.js";
import {
  EpochShuffling,
  ISignatureSet,
  createAggregateSignatureSetFromComponents,
  createSingleSignatureSetFromComponents,
} from "../util/index.js";
import {getAttesterSlashingsSignatureSets} from "./attesterSlashings.js";
import {getBlsToExecutionChangeSignatureSets} from "./blsToExecutionChange.js";
import {getExecutionPayloadBidSigningRoot} from "./executionPayloadBid.js";
import {getAttestationsSignatureSets} from "./indexedAttestation.js";
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
    /** Shuffling of each attestation, see `getAttestationsSignatureSets()` */
    attestationShufflings?: EpochShuffling[];
  }
): ISignatureSet[] {
  // fork based validations
  const fork = config.getForkSeq(signedBlock.message.slot);

  const signatureSets = [
    getRandaoRevealSignatureSet(config, signedBlock.message),
    ...getProposerSlashingsSignatureSets(config, signedBlock),
    ...getAttesterSlashingsSignatureSets(config, signedBlock),
    ...getAttestationsSignatureSets(config, signedBlock, indexedAttestations, opts?.attestationShufflings),
    ...signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
      getVoluntaryExitSignatureSet(config, state, voluntaryExit)
    ),
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

  if (fork >= ForkSeq.gloas) {
    const gloasState = state as IBeaconStateViewGloas;
    const {payloadAttestations, signedExecutionPayloadBid} = (signedBlock as gloas.SignedBeaconBlock).message.body;

    const {builderIndex} = signedExecutionPayloadBid.message;
    // `state` may be the pre-state of an earlier block of the same epoch. That is still the right pubkey:
    // `is_active_builder` requires `deposit_epoch < finalized_checkpoint.epoch`, and a builder index is only
    // assigned or reassigned to a builder deposited in the current epoch, which block processing rejects as
    // inactive. For the same reason a builder missing from `state` needs no signature set.
    if (builderIndex !== BUILDER_INDEX_SELF_BUILD && builderIndex < gloasState.getBuildersLength()) {
      signatureSets.push(
        createSingleSignatureSetFromComponents(
          gloasState.getBuilder(builderIndex).pubkey,
          getExecutionPayloadBidSigningRoot(config, signedExecutionPayloadBid.message),
          signedExecutionPayloadBid.signature
        )
      );
    }

    for (const payloadAttestation of payloadAttestations) {
      const ptc = gloasState.getPayloadTimelinessCommittee(payloadAttestation.data.slot);
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

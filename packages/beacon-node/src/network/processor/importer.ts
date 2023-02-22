import {peerIdFromString} from "@libp2p/peer-id";
import {altair, capella, phase0, ValidatorIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BlockInput} from "../../chain/blocks/types.js";
import {BlockError, BlockErrorCode} from "../../chain/errors/blockError.js";
import {IBeaconChain} from "../../chain/index.js";
import {Metrics} from "../../metrics/index.js";
import {OpSource} from "../../metrics/validatorMonitor.js";
import {GossipHandlerOpts} from "../gossip/handlers/index.js";
import {PeerAction, PeerRpcScoreStore} from "../peers/index.js";
import {AttnetsService} from "../subnets/index.js";

export type NetworkImporterModules = {
  chain: IBeaconChain;
  attnetsService: AttnetsService;
  peerRpcScores: PeerRpcScoreStore;
  logger: Logger;
  metrics: Metrics | null;
};

export class NetworkImporter {
  private readonly chain: IBeaconChain;
  private readonly attnetsService: AttnetsService;
  private readonly peerRpcScores: PeerRpcScoreStore;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;

  constructor(modules: NetworkImporterModules, private readonly opts: GossipHandlerOpts) {
    this.chain = modules.chain;
    this.attnetsService = modules.attnetsService;
    this.peerRpcScores = modules.peerRpcScores;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
  }

  importGossipBlock(blockInput: BlockInput, peerIdStr: string, seenTimestampSec: number): void {
    const signedBlock = blockInput.block;

    // Handler - MUST NOT `await`, to allow validation result to be propagated

    this.metrics?.registerBeaconBlock(OpSource.gossip, seenTimestampSec, signedBlock.message);

    this.chain
      .processBlock(blockInput, {
        // proposer signature already checked in validateBeaconBlock()
        validProposerSignature: true,
        // blobsSidecar already checked in validateGossipBlobsSidecar()
        validBlobsSidecar: true,
        // It's critical to keep a good number of mesh peers.
        // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
        // Gossip Job Wait Time depends on the BLS Job Wait Time
        // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
        // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
        // See https://github.com/ChainSafe/lodestar/issues/3792
        blsVerifyOnMainThread: true,
        // to track block process steps
        seenTimestampSec,
      })
      .then(() => {
        // Returns the delay between the start of `block.slot` and `current time`
        const delaySec = this.chain.clock.secFromSlot(signedBlock.message.slot);
        this.metrics?.gossipBlock.elapsedTimeTillProcessed.observe(delaySec);
      })
      .catch((e) => {
        if (e instanceof BlockError) {
          switch (e.type.code) {
            case BlockErrorCode.ALREADY_KNOWN:
            case BlockErrorCode.PARENT_UNKNOWN:
            case BlockErrorCode.PRESTATE_MISSING:
            case BlockErrorCode.EXECUTION_ENGINE_ERROR:
              break;
            default:
              this.peerRpcScores.applyAction(
                peerIdFromString(peerIdStr),
                PeerAction.LowToleranceError,
                "BadGossipBlock"
              );
          }
        }
        this.logger.error("Error receiving block", {slot: signedBlock.message.slot, peer: peerIdStr}, e as Error);
      });
  }

  importGossipAggregateAttestation(
    indexedAttestation: phase0.IndexedAttestation,
    committeeIndices: ValidatorIndex[],
    signedAggregateAndProof: phase0.SignedAggregateAndProof,
    seenTimestampSec: number
  ): void {
    this.metrics?.registerGossipAggregatedAttestation(seenTimestampSec, signedAggregateAndProof, indexedAttestation);
    const aggregatedAttestation = signedAggregateAndProof.message.aggregate;

    this.chain.aggregatedAttestationPool.add(
      aggregatedAttestation,
      indexedAttestation.attestingIndices.length,
      committeeIndices
    );

    if (!this.opts.dontSendGossipAttestationsToForkchoice) {
      try {
        this.chain.forkChoice.onAttestation(indexedAttestation);
      } catch (e) {
        this.logger.debug(
          "Error adding gossip aggregated attestation to forkchoice",
          {slot: aggregatedAttestation.data.slot},
          e as Error
        );
      }
    }
  }

  importGossipAttestation(
    attestation: phase0.Attestation,
    indexedAttestation: phase0.IndexedAttestation,
    subnet: number,
    seenTimestampSec: number
  ): void {
    this.metrics?.registerGossipUnaggregatedAttestation(seenTimestampSec, indexedAttestation);

    // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
    // but don't import them, to save CPU and RAM
    if (!this.attnetsService.shouldProcess(subnet, attestation.data.slot)) {
      return;
    }

    try {
      const insertOutcome = this.chain.attestationPool.add(attestation);
      this.metrics?.opPool.attestationPoolInsertOutcome.inc({insertOutcome});
    } catch (e) {
      this.logger.error("Error adding unaggregated attestation to pool", {subnet}, e as Error);
    }

    if (!this.opts.dontSendGossipAttestationsToForkchoice) {
      try {
        this.chain.forkChoice.onAttestation(indexedAttestation);
      } catch (e) {
        this.logger.debug("Error adding gossip unaggregated attestation to forkchoice", {subnet}, e as Error);
      }
    }
  }

  importGossipAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): void {
    try {
      this.chain.opPool.insertAttesterSlashing(attesterSlashing);
      this.chain.forkChoice.onAttesterSlashing(attesterSlashing);
    } catch (e) {
      this.logger.error("Error adding attesterSlashing to pool", {}, e as Error);
    }
  }

  importGossipProposerSlashing(proposerSlashing: phase0.ProposerSlashing): void {
    try {
      this.chain.opPool.insertProposerSlashing(proposerSlashing);
    } catch (e) {
      this.logger.error("Error adding attesterSlashing to pool", {}, e as Error);
    }
  }

  importGossipVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): void {
    try {
      this.chain.opPool.insertVoluntaryExit(voluntaryExit);
    } catch (e) {
      this.logger.error("Error adding voluntaryExit to pool", {}, e as Error);
    }
  }

  importGossipSyncCommitteeContributionAndProof(
    contributionAndProof: altair.SignedContributionAndProof,
    syncCommitteeParticipantIndices: number[]
  ): void {
    this.metrics?.registerGossipSyncContributionAndProof(contributionAndProof.message, syncCommitteeParticipantIndices);

    try {
      this.chain.syncContributionAndProofPool.add(contributionAndProof.message, syncCommitteeParticipantIndices.length);
    } catch (e) {
      this.logger.error("Error adding to contributionAndProof pool", {}, e as Error);
    }
  }

  importGossipSyncCommitteeMessage(
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: number,
    indexInSubcommittee: number
  ): void {
    try {
      this.chain.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee);
    } catch (e) {
      this.logger.error("Error adding to syncCommittee pool", {subnet}, e as Error);
    }
  }

  importGossipBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): void {
    try {
      this.chain.opPool.insertBlsToExecutionChange(blsToExecutionChange);
    } catch (e) {
      this.logger.error("Error adding blsToExecutionChange to pool", {}, e as Error);
    }
  }
}

import {BeaconConfig} from "@lodestar/config";
import {IBeaconStateView} from "@lodestar/state-transition";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {
  AggregatedAttestationPool,
  AttestationPool,
  OpPool,
  PayloadAttestationPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "../opPools/index.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenContributionAndProof,
  SeenPayloadAttesters,
  SeenSyncCommitteeMessages,
} from "../seenCache/index.js";
import {SeenAttestationDatas} from "../seenCache/seenAttestationData.js";
import {ShufflingCache} from "../shufflingCache.js";
import {BeaconEngineModules, IBeaconEngine} from "./interface.js";

/**
 * JS implementation of the consensus engine. Transitional in Phase 0: constructed inside
 * `BeaconChain` from the `anchorState` object; construction moves to the CLI in Phase 6.
 *
 * Minimal by design — collaborators, state ownership and flows migrate here in later phases.
 */
export class BeaconEngine implements IBeaconEngine {
  readonly config: BeaconConfig;
  readonly bls: IBlsVerifier;
  readonly shufflingCache: ShufflingCache;

  // Op pools
  readonly attestationPool: AttestationPool;
  readonly aggregatedAttestationPool: AggregatedAttestationPool;
  readonly syncCommitteeMessagePool: SyncCommitteeMessagePool;
  readonly syncContributionAndProofPool: SyncContributionAndProofPool;
  readonly payloadAttestationPool: PayloadAttestationPool;
  readonly opPool: OpPool;

  // Consensus gossip seen-caches
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenPayloadAttesters = new SeenPayloadAttesters();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof: SeenContributionAndProof;
  readonly seenAttestationDatas: SeenAttestationDatas;

  constructor(modules: BeaconEngineModules, anchorState: IBeaconStateView) {
    const {opts, config, logger, metrics, clock, pubkeyCache} = modules;
    this.config = config;

    // by default, verify signatures on both main threads and worker threads
    this.bls = opts.blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics, pubkeyCache})
      : new BlsMultiThreadWorkerPool(opts, {logger, metrics, pubkeyCache});

    this.shufflingCache = new ShufflingCache(metrics, logger, opts, [
      {
        shuffling: anchorState.getPreviousShuffling(),
        decisionRoot: anchorState.previousDecisionRoot,
      },
      {
        shuffling: anchorState.getCurrentShuffling(),
        decisionRoot: anchorState.currentDecisionRoot,
      },
      {
        shuffling: anchorState.getNextShuffling(),
        decisionRoot: anchorState.nextDecisionRoot,
      },
    ]);

    this.attestationPool = new AttestationPool(config, clock, opts?.preaggregateSlotDistance, metrics);
    this.aggregatedAttestationPool = new AggregatedAttestationPool(config, metrics);
    this.syncCommitteeMessagePool = new SyncCommitteeMessagePool(config, clock, opts?.preaggregateSlotDistance);
    this.syncContributionAndProofPool = new SyncContributionAndProofPool(config, clock, metrics, logger);
    this.payloadAttestationPool = new PayloadAttestationPool(config, clock, metrics);
    this.opPool = new OpPool(config);

    this.seenContributionAndProof = new SeenContributionAndProof(metrics);
    this.seenAttestationDatas = new SeenAttestationDatas(metrics, opts?.attDataCacheSlotDistance);
  }
}

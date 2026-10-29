import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {
  AggregatedAttestationPool,
  AttestationPool,
  DeferredVoluntaryExitPool,
  ExecutionPayloadBidPool,
  InclusionListStore,
  OpPool,
  PayloadAttestationPool,
  ProposerPreferencesPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "../opPools/index.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenExecutionPayloadBids,
  SeenPayloadAttesters,
  SeenSyncCommitteeMessages,
} from "../seenCache/index.js";
import {SeenAggregatedAttestations} from "../seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "../seenCache/seenAttestationData.js";
import {SeenBlockAttesters} from "../seenCache/seenBlockAttesters.js";

export type ValidationCachesOpts = {
  preaggregateSlotDistance?: number;
  attDataCacheSlotDistance?: number;
};

/** Every pool and seen cache the JS validation engine writes and serves reads from */
export type ValidationCaches = {
  attestationPool: AttestationPool;
  aggregatedAttestationPool: AggregatedAttestationPool;
  syncCommitteeMessagePool: SyncCommitteeMessagePool;
  syncContributionAndProofPool: SyncContributionAndProofPool;
  executionPayloadBidPool: ExecutionPayloadBidPool;
  payloadAttestationPool: PayloadAttestationPool;
  proposerPreferencesPool: ProposerPreferencesPool;
  inclusionListStore: InclusionListStore;
  opPool: OpPool;
  deferredVoluntaryExitPool: DeferredVoluntaryExitPool;
  seenAttesters: SeenAttesters;
  seenAggregators: SeenAggregators;
  seenPayloadAttesters: SeenPayloadAttesters;
  seenAggregatedAttestations: SeenAggregatedAttestations;
  seenExecutionPayloadBids: SeenExecutionPayloadBids;
  seenBlockProposers: SeenBlockProposers;
  seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
  seenContributionAndProof: SeenContributionAndProof;
  seenAttestationDatas: SeenAttestationDatas;
  seenBlockAttesters: SeenBlockAttesters;
};

export function createValidationCaches(
  opts: ValidationCachesOpts,
  modules: {config: BeaconConfig; clock: IClock; metrics: Metrics | null; logger: Logger}
): ValidationCaches {
  const {config, clock, metrics, logger} = modules;
  const caches: ValidationCaches = {
    attestationPool: new AttestationPool(config, clock, opts.preaggregateSlotDistance, metrics),
    aggregatedAttestationPool: new AggregatedAttestationPool(config, metrics, logger),
    syncCommitteeMessagePool: new SyncCommitteeMessagePool(config, clock, opts.preaggregateSlotDistance),
    syncContributionAndProofPool: new SyncContributionAndProofPool(config, clock, metrics, logger),
    executionPayloadBidPool: new ExecutionPayloadBidPool(),
    payloadAttestationPool: new PayloadAttestationPool(config, clock, metrics),
    proposerPreferencesPool: new ProposerPreferencesPool(),
    inclusionListStore: new InclusionListStore(config),
    opPool: new OpPool(config),
    deferredVoluntaryExitPool: new DeferredVoluntaryExitPool(logger),
    seenAttesters: new SeenAttesters(),
    seenAggregators: new SeenAggregators(),
    seenPayloadAttesters: new SeenPayloadAttesters(),
    seenAggregatedAttestations: new SeenAggregatedAttestations(metrics),
    seenExecutionPayloadBids: new SeenExecutionPayloadBids(),
    seenBlockProposers: new SeenBlockProposers(),
    seenSyncCommitteeMessages: new SeenSyncCommitteeMessages(),
    seenContributionAndProof: new SeenContributionAndProof(metrics),
    seenAttestationDatas: new SeenAttestationDatas(metrics, opts.attDataCacheSlotDistance),
    seenBlockAttesters: new SeenBlockAttesters(),
  };

  if (metrics) {
    // aggregatedAttestationPool and syncContributionAndProofPool track their own sizes
    const {opPool} = metrics;
    opPool.attestationPool.size.addCollect(() =>
      opPool.attestationPool.size.set(caches.attestationPool.getAttestationCount())
    );
    opPool.attesterSlashingPoolSize.addCollect(() =>
      opPool.attesterSlashingPoolSize.set(caches.opPool.attesterSlashingsSize)
    );
    opPool.proposerSlashingPoolSize.addCollect(() =>
      opPool.proposerSlashingPoolSize.set(caches.opPool.proposerSlashingsSize)
    );
    opPool.voluntaryExitPoolSize.addCollect(() => opPool.voluntaryExitPoolSize.set(caches.opPool.voluntaryExitsSize));
    opPool.blsToExecutionChangePoolSize.addCollect(() =>
      opPool.blsToExecutionChangePoolSize.set(caches.opPool.blsToExecutionChangeSize)
    );
    opPool.deferredVoluntaryExitPool.size.addCollect(() =>
      opPool.deferredVoluntaryExitPool.size.set(caches.deferredVoluntaryExitPool.size())
    );
    opPool.syncCommitteeMessagePoolSize.addCollect(() =>
      opPool.syncCommitteeMessagePoolSize.set(caches.syncCommitteeMessagePool.size)
    );
    opPool.payloadAttestationPool.size.addCollect(() =>
      opPool.payloadAttestationPool.size.set(caches.payloadAttestationPool.size)
    );
    opPool.executionPayloadBidPool.size.addCollect(() =>
      opPool.executionPayloadBidPool.size.set(caches.executionPayloadBidPool.size)
    );
    metrics.inclusionListStore.size.addCollect(() =>
      metrics.inclusionListStore.size.set(caches.inclusionListStore.size)
    );
  }

  return caches;
}

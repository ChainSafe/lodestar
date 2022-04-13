export enum MessageSource {
  forward = "forward",
  publish = "publish",
}

type LabelsGeneric = Record<string, string | undefined>;
type CollectFn<Labels extends LabelsGeneric> = (metric: Gauge<Labels>) => void;

interface Gauge<Labels extends LabelsGeneric = never> {
  // Sorry for this mess, `prom-client` API choices are not great
  // If the function signature was `inc(value: number, labels?: Labels)`, this would be simpler
  inc(value?: number): void;
  inc(labels: Labels, value?: number): void;
  inc(arg1?: Labels | number, arg2?: number): void;

  set(value: number): void;
  set(labels: Labels, value: number): void;
  set(arg1?: Labels | number, arg2?: number): void;

  addCollect(collectFn: CollectFn<Labels>): void;
}

interface Histogram<Labels extends LabelsGeneric = never> {
  startTimer(): () => number;

  observe(value: number): void;
  observe(labels: Labels, values: number): void;
  observe(arg1: Labels | number, arg2?: number): void;

  reset(): void;
}

interface AvgMinMax<Labels extends LabelsGeneric = never> {
  set(values: number[]): void;
  set(labels: Labels, values: number[]): void;
  set(arg1?: Labels | number[], arg2?: number[]): void;
}

type GaugeConfig<Labels extends LabelsGeneric> = {
  name: string;
  help: string;
  labelNames?: keyof Labels extends string ? (keyof Labels)[] : undefined;
};

type HistogramConfig<Labels extends LabelsGeneric> = {
  name: string;
  help: string;
  labelNames?: (keyof Labels)[];
  buckets?: number[];
};

type AvgMinMaxConfig<Labels extends LabelsGeneric> = GaugeConfig<Labels>;

export interface MetricsRegister {
  gauge<T extends LabelsGeneric>(config: GaugeConfig<T>): Gauge<T>;
  histogram<T extends LabelsGeneric>(config: HistogramConfig<T>): Histogram<T>;
  avgMinMax<T extends LabelsGeneric>(config: AvgMinMaxConfig<T>): AvgMinMax<T>;
}

export type Metrics = ReturnType<typeof getMetrics>;

export type LodestarGitData = {
  /** "0.16.0" */
  semver: string;
  /** "developer/feature-1" */
  branch: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "0.16.0 developer/feature-1 ac99f2b5" */
  version: string;
  /** "prater" */
  network: string;
};

/**
 * A collection of metrics used throughout the Gossipsub behaviour.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getMetrics(register: MetricsRegister, gitData: LodestarGitData) {
  // Using function style instead of class to prevent having to re-declare all MetricsPrometheus types.

  // Track version, same as https://github.com/ChainSafe/lodestar/blob/6df28de64f12ea90b341b219229a47c8a25c9343/packages/lodestar/src/metrics/metrics/lodestar.ts#L17
  register
    .gauge<LodestarGitData>({
      name: "lodestar_version",
      help: "Lodestar version",
      labelNames: Object.keys(gitData) as (keyof LodestarGitData)[],
    })
    .set(gitData, 1);

  return {
    // Attestation journey:
    // - Wait for block or 1/3, call prepare attestation
    // - Get attestation, sign, call publish
    // - Wait 2/3, call prepare aggregate
    // - Get aggregate, sign, call publish

    attesterStepCallProduceAttestation: register.histogram({
      name: "vc_attester_step_call_produce_attestation_seconds",
      help: "Time between 1/3 of slot and call produce attestation",
      // Attester flow can start early if block is imported before 1/3 of the slot
      // This measure is critical so we need very good resolution around the 0 second mark
      buckets: [-3, -1, 0, 1, 2, 3, 6, 12],
    }),
    attesterStepCallPublishAttestation: register.histogram({
      name: "vc_attester_step_call_publish_attestation_seconds",
      help: "Time between 1/3 of slot and call publish attestation",
      buckets: [-3, -1, 0, 1, 2, 3, 6, 12],
    }),

    attesterStepCallProduceAggregate: register.histogram({
      name: "vc_attester_step_call_produce_aggregate_seconds",
      help: "Time between 2/3 of slot and call produce aggregate",
      // Aggregate production starts at 2/3 the earliest.
      // Track values close to 0 (expected) in greater resolution, values over 12 overflow into the next slot.
      buckets: [0.5, 1, 2, 3, 6, 12],
    }),
    attesterStepCallPublishAggregate: register.histogram({
      name: "vc_attester_step_call_publish_aggregate_seconds",
      help: "Time between 2/3 of slot and call publish aggregate",
      buckets: [0.5, 1, 2, 3, 6, 12],
    }),

    syncCommitteeStepCallProduceMessage: register.histogram({
      name: "vc_sync_committee_step_call_produce_message_seconds",
      help: "Time between 1/3 of slot and call produce message",
      // Max wait time is 1 / 3 of slot
      buckets: [0.5, 1, 2, 3, 6, 12],
    }),
    syncCommitteeStepCallPublishMessage: register.histogram({
      name: "vc_sync_committee_step_call_publish_message_seconds",
      help: "Time between 1/3 of slot and call publish message",
      buckets: [0.5, 1, 2, 3, 6, 12],
    }),

    syncCommitteeStepCallProduceAggregate: register.histogram({
      name: "vc_sync_committee_step_call_produce_aggregate_seconds",
      help: "Time between 2/3 of slot and call produce aggregate",
      // Min wait time is 2 / 3 of slot
      buckets: [0.5, 1, 2, 3, 6, 12],
    }),
    syncCommitteeStepCallPublishAggregate: register.histogram({
      name: "vc_sync_committee_step_call_publish_aggregate_seconds",
      help: "Time between 2/3 of slot and call publish aggregate",
      buckets: [0.5, 1, 2, 3, 6, 12],
    }),

    // Min wait time it 0. CallProduceBlock step is a bit redundant since it must be 0, but let's check
    proposerStepCallProduceBlock: register.histogram({
      name: "vc_proposer_step_call_produce_block_seconds",
      help: "Time between start of slot and call produce block",
      buckets: [0.5, 1, 2, 3, 6, 8],
    }),
    proposerStepCallPublishBlock: register.histogram({
      name: "vc_proposer_step_call_publish_block_seconds",
      help: "Time between start of slot and call publish block",
      buckets: [0.5, 1, 2, 3, 6, 8],
    }),

    // AttestationService

    publishedAttestations: register.gauge({
      name: "vc_published_attestations_total",
      help: "Total published attestations",
    }),

    publishedAggregates: register.gauge({
      name: "vc_published_aggregates_total",
      help: "Total published aggregates",
    }),

    attestaterError: register.gauge<{error: "produce" | "sign" | "publish"}>({
      name: "vc_attestation_service_errors",
      help: "Total errors in AttestationService",
      labelNames: ["error"],
    }),

    // AttestationDutiesService

    attesterDutiesCount: register.gauge({
      name: "vc_attester_duties_count",
      help: "Current count of duties in AttestationDutiesService",
    }),

    attesterDutiesEpochCount: register.gauge({
      name: "vc_attester_duties_epoch_count",
      help: "Current count of epoch duties in AttestationDutiesService",
    }),

    attesterDutiesReorg: register.gauge({
      name: "vc_attestation_duties_reorg_total",
      help: "Total count of instances the attester duties dependant root changed",
    }),

    // BlockProposingService

    blocksProduced: register.gauge({
      name: "vc_block_produced_total",
      help: "Total count of blocks produced",
    }),

    blocksPublished: register.gauge({
      name: "vc_block_published_total",
      help: "Total count of blocks published",
    }),

    blockProposingErrors: register.gauge<{error: "produce" | "publish"}>({
      name: "vc_block_proposing_errors_total",
      help: "Total count of errors producing or publishing a block",
      labelNames: ["error"],
    }),

    // BlockDutiesService

    proposerDutiesEpochCount: register.gauge({
      name: "vc_proposer_duties_epoch_count",
      help: "Current count of epoch duties in BlockDutiesService",
    }),

    proposerDutiesReorg: register.gauge({
      name: "vc_proposer_duties_reorg_total",
      help: "Total count of instances the proposer duties dependant root changed",
    }),

    // IndicesService

    indices: register.gauge({
      name: "vc_indices_count",
      help: "Current count of indices in IndicesService",
    }),

    discoveredIndices: register.gauge({
      name: "vc_discovered_indices_total",
      help: "Total count of validator indices discovered",
    }),

    // SyncCommitteeService

    publishedSyncCommitteeMessage: register.gauge({
      name: "vc_published_sync_committee_message_total",
      help: "Total published SyncCommitteeMessage",
    }),

    publishedSyncCommitteeContribution: register.gauge({
      name: "vc_published_sync_committee_contribution_total",
      help: "Total published SyncCommitteeContribution",
    }),

    // SyncCommitteeDutiesService

    syncCommitteeDutiesCount: register.gauge({
      name: "vc_sync_committee_duties_count",
      help: "Current count of duties in SyncCommitteeDutiesService",
    }),

    syncCommitteeDutiesEpochCount: register.gauge({
      name: "vc_sync_committee_duties_epoch_count",
      help: "Current count of epoch duties in SyncCommitteeDutiesService",
    }),

    syncCommitteeDutiesReorg: register.gauge({
      name: "vc_sync_committee_duties_reorg_total",
      help: "Total count of instances the sync committee duties dependant root changed",
    }),

    // ValidatorStore

    signers: register.gauge({
      name: "vc_signers_count",
      help: "Total count of instances the sync committee duties dependant root changed",
    }),

    localSignTime: register.histogram({
      name: "vc_local_sign_time_seconds",
      help: "Histogram of sign time for any signature with local signer",
      // When using a local keystores, signing time is ~ 1ms
      buckets: [0.0001, 0.001, 0.01, 0.1],
    }),

    remoteSignTime: register.histogram({
      name: "vc_remote_sign_time_seconds",
      help: "Histogram of sign time for any signature with remote signer",
      // When using a remote signer sign time can be ~ 50-500ms
      buckets: [0.01, 0.1, 1, 5],
    }),

    remoteSignErrors: register.gauge({
      name: "vc_remote_sign_errors_total",
      help: "Total count of errors calling a remote signer",
    }),

    signError: register.gauge({
      name: "vc_sign_errors_total",
      help: "Total count of errors calling a signer",
    }),

    slashingProtectionBlockError: register.gauge({
      name: "vc_slashing_protection_block_errors_total",
      help: "Total count of errors on slashingProtection.checkAndInsertBlockProposal",
    }),

    slashingProtectionAttestationError: register.gauge({
      name: "vc_slashing_protection_attestation_errors_total",
      help: "Total count of errors on slashingProtection.checkAndInsertAttestation",
    }),

    // REST API client

    restApiClient: {
      requestTime: register.histogram<{routeId: string}>({
        name: "vc_rest_api_client_request_time_seconds",
        help: "Histogram of REST API client request time by routeId",
        labelNames: ["routeId"],
        // Expected times are ~ 50-500ms, but in an overload NodeJS they can be greater
        buckets: [0.01, 0.1, 1, 5],
      }),

      errors: register.gauge<{routeId: string}>({
        name: "vc_rest_api_client_errors_total",
        help: "Total count of errors calling the REST API client by routeId",
        labelNames: ["routeId"],
      }),
    },
  };
}

import {defaultExecutionEngineHttpOpts} from "@lodestar/beacon-node";
import {MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES, defaultOptions} from "@lodestar/builder";
import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {builderRestApiServerOptsDefault} from "./apiServer.js";

export const builderMetricsDefaultOptions = {
  enabled: false,
  port: 5065,
  address: "127.0.0.1",
};

export type IBuilderCliArgs = LogArgs & {
  beaconNodeUrl: string;
  keystore: string;
  keystorePassword: string;
  builderPubkey?: string;
  assumeBuilderIndex?: number;
  assumeBuilderBalanceGwei?: number;
  executionFeeRecipient: string;
  requestTimeout: number;
  "proposerPreferences.urls"?: string[];
  "proposerPreferences.timeout": number;

  "execution.urls": string[];
  "execution.timeout"?: number;
  "execution.retries": number;
  "execution.retryDelay": number;
  jwtSecret?: string;
  jwtId?: string;

  "payload.transactionsFile"?: string;
  "payload.testingUrl"?: string;
  "payload.constructorUrl"?: string;
  "payload.engineUntilSlot"?: number;
  "payload.beginReservations"?: boolean;
  "payload.alternateOrderGenerations"?: boolean;
  "payload.outputDir"?: string;
  "payload.dryRun"?: boolean;

  "bidding.shareBps": number;
  "bidding.fixedCostGwei": number;
  "bidding.subsidyGwei": number;
  "bidding.subsidyUntilSlot"?: number;
  "bidding.minValueGwei": number;
  "bidding.maxValueGwei"?: number;
  "bidding.deadlineBps": number;
  "bidding.gossipIdentitiesFile"?: string;
  "bidding.getPayloadTimeout": number;
  "bidding.updateIntervalMs": number;
  "bidding.updateCutoffBps": number;
  "bidding.maxRevisionsPerSlot": number;
  "bidding.alternateBranches": boolean;
  "bidding.alternateGossip": boolean;
  "bidding.primaryHandoff": boolean;
  "bidding.alternateBuildDurationMs": number;
  "bidding.alternateRefreshBeforeSlotMs": number;
  "bidding.deferUnusedGossipStages": boolean;
  "bidding.minOperatingBalanceGwei": number;
  "reveal.cutoffBps"?: number;

  "adversarial.withhold.executionPayload": boolean;
  "adversarial.delay.executionPayload": boolean;
  "adversarial.delay.executionPayloadBps": number;

  builderApi?: boolean;
  "builderApi.port"?: number;
  "builderApi.address"?: string;
  "builderApi.publicUrl"?: string;
  "builderApi.authData"?: string;
  "builderApi.orderExposureTokenFile"?: string;
  "builderApi.bidStream"?: boolean;
  "builderApi.bidStreamAdaptiveTiming"?: boolean;
  "builderApi.httpReturnReserveCapMs"?: number;
  "builderApi.httpResponseMarginMs"?: number;

  metrics?: boolean;
  "metrics.port"?: number;
  "metrics.address"?: string;
};

export const builderOptions: CliCommandOptions<IBuilderCliArgs> = {
  ...logOptions,

  beaconNodeUrl: {
    description: "Url to a trusted beacon node started with --emitPayloadAttributes",
    type: "string",
    default: defaultOptions.beaconNodeUrl,
  },

  keystore: {
    description: "Path to a keystore file",
    type: "string",
    demandOption: true,
  },

  keystorePassword: {
    description: "Path to a file with password to decrypt the keystore from 'keystore' option",
    type: "string",
    demandOption: true,
  },

  builderPubkey: {
    description: "Builder's expected public key based on the keystore from 'keystore' option",
    type: "string",
  },

  assumeBuilderIndex: {
    description:
      "Before the Gloas fork, assume this builder index for the deposit the fork onboards, to bid for the first Gloas slot. " +
      "Verified against the beacon node after the first Gloas block, bidding stops if the registry disagrees",
    type: "number",
    implies: ["assumeBuilderBalanceGwei"],
  },

  assumeBuilderBalanceGwei: {
    description:
      "Balance in gwei assumed with 'assumeBuilderIndex' until the beacon node reports the builder, the deposit amount",
    type: "number",
    implies: ["assumeBuilderIndex"],
  },

  executionFeeRecipient: {
    description: "Execution address for receiving the payload rewards",
    type: "string",
    demandOption: true,
  },

  requestTimeout: {
    description: "Timeout in milliseconds for HTTP requests to the beacon node",
    type: "number",
    default: defaultOptions.requestTimeout,
  },

  // Proposer preferences

  "proposerPreferences.urls": {
    description: `Urls to additional trusted beacon nodes on the same network, polled once per slot for signed proposer preferences the beacon node missed. At most ${MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES} urls`,
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.flatMap((item) => item.split(",")),
    group: "proposerPreferences",
  },

  "proposerPreferences.timeout": {
    description: "Timeout in milliseconds for polling proposer preferences from beacon nodes",
    type: "number",
    default: defaultOptions.proposerPreferences.timeoutMs,
    group: "proposerPreferences",
  },

  // Execution

  "execution.urls": {
    description:
      "Url to the execution client engine API that builds the payloads. The execution client must be kept in sync by a beacon node",
    default: defaultExecutionEngineHttpOpts.urls.join(","),
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.flatMap((item) => item.split(",")),
    group: "execution",
  },

  "execution.timeout": {
    description: "Timeout in milliseconds for execution engine API HTTP client",
    type: "number",
    defaultDescription: String(defaultExecutionEngineHttpOpts.timeout),
    group: "execution",
  },

  "execution.retries": {
    description: "Number of retries when calling execution engine API",
    type: "number",
    default: defaultExecutionEngineHttpOpts.retries,
    group: "execution",
  },

  "execution.retryDelay": {
    description: "Delay time in milliseconds between retries when retrying calls to the execution engine API",
    type: "number",
    default: defaultExecutionEngineHttpOpts.retryDelay,
    group: "execution",
  },

  jwtSecret: {
    description:
      "File path to a shared hex-encoded jwt secret which will be used to generate and bundle HS256 encoded jwt tokens for authentication with the EL client's rpc server hosting engine apis. Secret to be exactly same as the one used by the corresponding EL client.",
    type: "string",
    group: "execution",
  },

  jwtId: {
    description:
      "An optional identifier to be set in the id field of the claims included in jwt tokens used for authentication with EL client's rpc server hosting engine apis",
    type: "string",
    group: "execution",
  },

  // Controlled payloads

  "payload.constructorUrl": {
    description: "Private zbuilder session RPC URL for incrementally constructed, validated payloads",
    type: "string",
    group: "payload",
  },

  "payload.engineUntilSlot": {
    description:
      "Use the execution client instead of the session constructor through this proposal slot (inclusive), for the fork transition. Later slots use the constructor exclusively",
    type: "number",
    implies: ["payload.constructorUrl"],
    group: "payload",
  },

  "payload.beginReservations": {
    description: "Use server-issued constructor reservations to recover safely from lost session-begin replies",
    type: "boolean",
    default: false,
    group: "payload",
  },

  "payload.alternateOrderGenerations": {
    description: "Opt in to exact retained alternate offers with a compatible generation-aware constructor",
    type: "boolean",
    default: false,
    group: "payload",
  },

  "payload.transactionsFile": {
    description: "Devnet testing: JSON file containing the exact ordered signed transactions to build",
    type: "string",
    group: "payload",
  },

  "payload.testingUrl": {
    description: "Private execution RPC URL exposing the eth and testing namespaces for controlled payload builds",
    type: "string",
    group: "payload",
  },

  "payload.outputDir": {
    description: "Directory in which to save controlled payload build requests and responses",
    type: "string",
    group: "payload",
  },

  "payload.dryRun": {
    description: "Build and capture controlled payloads without publishing bids",
    type: "boolean",
    default: false,
    group: "payload",
  },

  // Bidding

  "bidding.updateIntervalMs": {
    description: "Poll session payload snapshots at this interval in milliseconds; zero disables API bid updates",
    type: "number",
    default: defaultOptions.bidding.updateIntervalMs,
    group: "bidding",
  },

  "bidding.updateCutoffBps": {
    description: "Stop session updates at this point within the proposal slot, in basis points",
    type: "number",
    default: defaultOptions.bidding.updateCutoffBps,
    group: "bidding",
  },

  "bidding.maxRevisionsPerSlot": {
    description: "Maximum new signed revisions per slot across all parents; existing commitments remain recoverable",
    type: "number",
    default: defaultOptions.bidding.maxRevisionsPerSlot,
    group: "bidding",
  },
  "bidding.primaryHandoff": {
    description:
      "Retain an exact durable primary bid on a validated same-slot alternate branch (requires constructor capability)",
    type: "boolean",
    default: defaultOptions.bidding.primaryHandoff,
    group: "bidding",
  },
  "bidding.alternateBranches": {
    type: "boolean",
    description: "Build bounded alternate parent snapshots for API and streaming bids",
    default: defaultOptions.bidding.alternateBranches,
    group: "bidding",
  },
  "bidding.alternateGossip": {
    type: "boolean",
    description: "Gossip durable alternate bids at the primary deadline (requires retained order generations)",
    default: defaultOptions.bidding.alternateGossip,
    group: "bidding",
  },
  "bidding.alternateBuildDurationMs": {
    type: "number",
    description: "Maximum construction time per alternate parent snapshot, in milliseconds",
    default: defaultOptions.bidding.alternateBuildDurationMs,
    group: "bidding",
  },
  "bidding.alternateRefreshBeforeSlotMs": {
    type: "number",
    description:
      "Target one alternate refresh this many ms before the slot, after primary gossip plus 100 ms; zero disables",
    default: defaultOptions.bidding.alternateRefreshBeforeSlotMs,
    group: "bidding",
  },

  "bidding.deferUnusedGossipStages": {
    description: "Let an unsigned gossip stage wait for a higher bid within its existing window",
    type: "boolean",
    default: defaultOptions.bidding.deferUnusedGossipStages,
    group: "bidding",
  },

  "bidding.shareBps": {
    description: "Share of the payload value offered to the proposer, in basis points",
    type: "number",
    default: defaultOptions.bidding.shareBps,
    group: "bidding",
  },

  "bidding.fixedCostGwei": {
    description: "Fixed amount in gwei deducted from the proposer share of every bid",
    type: "number",
    default: defaultOptions.bidding.fixedCostGwei,
    group: "bidding",
  },

  "bidding.subsidyGwei": {
    description: "Fixed amount in gwei added on top of the proposer share of every bid, paid from the builder balance",
    type: "number",
    default: defaultOptions.bidding.subsidyGwei,
    group: "bidding",
  },

  "bidding.subsidyUntilSlot": {
    description:
      "Only add the subsidy to bids for proposal slots up to and including this slot, e.g. the first slot of a fork, the subsidy applies to every bid if unset",
    type: "number",
    group: "bidding",
  },

  "bidding.minValueGwei": {
    description: "Never bid below this value in gwei",
    type: "number",
    default: defaultOptions.bidding.minValueGwei,
    group: "bidding",
  },

  "bidding.maxValueGwei": {
    description: "Never bid above this value in gwei",
    type: "number",
    group: "bidding",
  },

  "bidding.gossipIdentitiesFile": {
    description:
      "JSON file listing additional registered builder keystores, password files and deadlineBps for staged P2P bids from the same payload session",
    type: "string",
    group: "bidding",
  },

  "bidding.deadlineBps": {
    description:
      "Point within the slot before the proposal slot at which the payload is retrieved and the bid is published, in basis points",
    type: "number",
    default: defaultOptions.bidding.deadlineBps,
    group: "bidding",
  },

  "bidding.getPayloadTimeout": {
    description: "Timeout in milliseconds for retrieving the payload from the execution client at the bid deadline",
    type: "number",
    default: defaultOptions.bidding.getPayloadTimeout,
    group: "bidding",
  },

  "bidding.minOperatingBalanceGwei": {
    description: "Do not bid while the builder balance is below this value in gwei",
    type: "number",
    default: defaultOptions.bidding.minOperatingBalanceGwei,
    group: "bidding",
  },

  "reveal.cutoffBps": {
    description:
      "Do not reveal the payload if the block committing to our bid arrives after this point within its slot, in basis points. Defaults to PAYLOAD_ATTESTATION_DUE_BPS of the network",
    type: "number",
    group: "reveal",
  },

  // Adversarial

  "adversarial.withhold.executionPayload": {
    hidden: true,
    type: "boolean",
    description: "ADVERSARIAL (devnet test only): never reveal the execution payload of a selected bid",
    default: false,
    group: "adversarial",
  },

  "adversarial.delay.executionPayload": {
    hidden: true,
    type: "boolean",
    description:
      "ADVERSARIAL (devnet test only): delay revealing the execution payload of a selected bid until the configured point in the slot",
    default: false,
    group: "adversarial",
  },

  "adversarial.delay.executionPayloadBps": {
    hidden: true,
    type: "number",
    description:
      "ADVERSARIAL (devnet test only): target time within the slot for the delayed execution payload reveal, in basis points of the slot duration",
    default: defaultOptions.reveal.adversarialDelayExecutionPayloadBps,
    group: "adversarial",
  },

  // Builder API

  builderApi: {
    type: "boolean",
    description: "Enable builder API server, proposers can request the published bids from it directly",
    default: false,
    group: "builderApi",
  },

  "builderApi.port": {
    type: "number",
    description: "Set port for builder API",
    defaultDescription: String(builderRestApiServerOptsDefault.port),
    group: "builderApi",
  },

  "builderApi.address": {
    type: "string",
    description: "Set host for builder API",
    defaultDescription: builderRestApiServerOptsDefault.address,
    group: "builderApi",
  },

  "builderApi.publicUrl": {
    type: "string",
    description:
      "URL proposers reach the builder API at. Proposers must sign their requests with its hostname as auth data unless `--builderApi.authData` is set",
    group: "builderApi",
  },

  "builderApi.bidStream": {
    description: "Enable the experimental authenticated Gloas WebSocket bid stream alongside the HTTP builder API",
    type: "boolean",
    default: false,
    group: "builderApi",
  },

  "builderApi.orderExposureTokenFile": {
    description: "File containing a shared 32-byte lowercase hex token for the private order exposure endpoint",
    type: "string",
    implies: ["builderApi"],
    group: "builderApi",
  },

  "builderApi.bidStreamAdaptiveTiming": {
    description:
      "Adapt bid-stream send deadlines to measured RTT; requires bid streaming and verified end-to-end pong forwarding",
    type: "boolean",
    default: false,
    group: "builderApi",
  },

  "builderApi.authData": {
    type: "string",
    description:
      "Auth data agreed with proposers out of band as a hex string, proposers must sign their requests with it. Takes precedence over the hostname of `--builderApi.publicUrl`",
    group: "builderApi",
  },

  "builderApi.httpReturnReserveCapMs": {
    description:
      "Experimental HTTP reply allowance cap in ms (0-10000). Defaults to request age; a lower cap can improve bids but risks late responses on slower return paths",
    type: "number",
    group: "builderApi",
  },

  "builderApi.httpResponseMarginMs": {
    description: "HTTP scheduling and serialization allowance in ms (20-1000). Tune independently of the return cap",
    type: "number",
    defaultDescription: "50",
    group: "builderApi",
  },

  // Metrics

  metrics: {
    description: "Enable the Prometheus metrics HTTP server",
    type: "boolean",
    defaultDescription: String(builderMetricsDefaultOptions.enabled),
    group: "metrics",
  },

  "metrics.port": {
    description: "Listen TCP port for the Prometheus metrics HTTP server",
    type: "number",
    defaultDescription: String(builderMetricsDefaultOptions.port),
    group: "metrics",
  },

  "metrics.address": {
    description: "Listen address for the Prometheus metrics HTTP server",
    type: "string",
    defaultDescription: String(builderMetricsDefaultOptions.address),
    group: "metrics",
  },
};

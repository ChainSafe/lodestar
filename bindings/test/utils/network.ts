import assert from "node:assert/strict";
import {type SpawnSyncReturns, spawnSync} from "node:child_process";
import {basename} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {publicKeyFromProtobuf} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {testChain} from "../../../test/interop/network_chain.mjs";
import type {NetworkTestRuntime} from "./network-runtime.js";
import {initializeNativeNetworkRuntime} from "./network-runtime.js";

export {testChain};

import {type ChainConfig, createBeaconConfig} from "@lodestar/config";
import bindings, {type BeaconConfig} from "../../src/index.js";
import type {
  HostCapacity,
  IpEndpoint,
  NativeApplicationConfig,
  NativeDiscoveryConfig,
  NativeForkEntry,
  NativeGossipStartupPolicy,
  NativeLocalIntent,
  NativeNetwork,
  NativePeerAction,
  NativePeerObservation,
  NativePeerReportContext,
  NativeRuntimeConfig,
  NativeTopicKind,
} from "../../src/network.js";
import type {
  NativeExchange,
  NativeGossipHandle,
  NativeGossipVerdict,
  NativeIncomingRequest,
} from "../../src/network-types.js";

const MIB = 1024 * 1024;

export const settleOnly = null;
export const capacity = {gossipValidation: "ready"} as const;
export const gossipAll = capacity;
export const gossipUrgent = {...capacity, gossipValidation: "backpressured"} as const;

export type Feedback =
  | {type: "verdict"; handle: NativeGossipHandle; verdict: NativeGossipVerdict}
  | {type: "classify"; handle: NativeGossipHandle; available: boolean}
  | {type: "block"; root: Uint8Array}
  | {type: "dropQueued"}
  | {type: "reportPeer"; peerId: string; action: NativePeerAction; count: number; context?: NativePeerReportContext};

type ExchangeRuntime = Pick<NetworkTestRuntime, "exchange" | "setCapacity">;
type FeedbackRuntime = ExchangeRuntime &
  Pick<NetworkTestRuntime, "reportGossip" | "classifyGossip" | "notifyBlock" | "dropQueuedGossip" | "reportPeer">;

export function exchange(runtime: ExchangeRuntime, capacity: HostCapacity | null): NativeExchange;
export function exchange(
  runtime: FeedbackRuntime,
  capacity: HostCapacity | null,
  feedback: readonly Feedback[]
): NativeExchange;
export function exchange(
  runtime: ExchangeRuntime | FeedbackRuntime,
  capacity: HostCapacity | null,
  feedback: readonly Feedback[] = []
): NativeExchange {
  if ("reportGossip" in runtime)
    for (const item of feedback) {
      switch (item.type) {
        case "verdict":
          runtime.reportGossip(item.handle, item.verdict);
          break;
        case "classify":
          runtime.classifyGossip(item.handle, item.available);
          break;
        case "block":
          runtime.notifyBlock(item.root);
          break;
        case "dropQueued":
          runtime.dropQueuedGossip();
          break;
        case "reportPeer":
          for (let i = 0; i < item.count; i++) runtime.reportPeer(item.peerId, item.action, item.context);
          break;
      }
    }
  runtime.setCapacity(capacity);
  const result = runtime.exchange();
  runtime.setCapacity(null);
  return result;
}

const incomingStarts = new WeakMap<ExchangeRuntime, NativeIncomingRequest[]>();

/** For request-only fixtures; unrelated payload delivery fails instead of losing its obligations. */
export function nextIncoming(runtime: ExchangeRuntime): NativeIncomingRequest | null {
  const queued = incomingStarts.get(runtime);
  if (queued?.length) return queued.shift() ?? null;
  const result = exchange(runtime, gossipAll);
  assert.equal(result.gossip, null, "Unexpected gossip while taking an incoming request");
  assert.equal(result.checks.length, 0, "Unexpected dependency checks while taking an incoming request");
  incomingStarts.set(runtime, result.serving.slice(1));
  return result.serving[0] ?? null;
}

export function networkConfig(): NativeRuntimeConfig & {
  gossipPolicy: NativeGossipStartupPolicy & {activeSendItems: Record<NativeTopicKind, number>};
} {
  const key = new Uint8Array(32);
  key[31] = 1;
  return {
    activeValidatorCount: 16,
    bind: {address: Uint8Array.of(127, 0, 0, 1), family: 4, port: 0},
    discovery: null,
    genesisTime: BigInt(Math.floor(Date.now() / 1000)) - 1200n,
    gossipPolicy: {
      activeSendItems: Object.fromEntries(
        topicKinds.map((kind) => [kind, kind === "data_column_sidecar" ? 256 : kind === "blob_sidecar" ? 32 : 8])
      ) as Record<NativeTopicKind, number>,
      activeSendTimeoutMs: 6000n,
      largeFrameTimeoutMs: 6000n,
      receiveBufferBytes: 16 * 1024 * 1024,
    },
    identitySecretKey: key,
    local: {
      metadata: {attnets: new Uint8Array(8), custodyGroupCount: 1n, sequenceNumber: 1n, syncnets: 0},
      status: {
        earliestAvailableSlot: 0n,
        finalizedEpoch: 0n,
        finalizedRoot: new Uint8Array(32),
        headRoot: new Uint8Array(32),
        headSlot: 100n,
      },
    },
  };
}

export function discoveryConfig(): NativeApplicationConfig & {
  discovery: NativeDiscoveryConfig & {advertisement: NonNullable<NativeDiscoveryConfig["advertisement"]>};
} {
  return {
    ...applicationConfig(),
    discovery: {
      advertisement: {ip4: Uint8Array.of(127, 0, 0, 1), udp: 40404},
      bind: {address: Uint8Array.of(127, 0, 0, 1), family: 4, port: 0},
      bootstrapEnrs: [],
      fixed: {ip4: Uint8Array.of(127, 0, 0, 1), quic: 443, udp: 40404},
      sequenceNumber: 7n,
    },
  };
}

const configuredChains = new WeakMap<BeaconConfig, ReturnType<typeof createBeaconConfig>>();

export function configuredChain(config: NativeApplicationConfig) {
  const chain = configuredChains.get(config.beaconConfig);
  if (!chain) throw new Error("Network test config has no chain fixture");
  return {
    ...Object.fromEntries(Object.entries(chain).filter(([key]) => key.toUpperCase() === key)),
    genesisValidatorsRoot: chain.genesisValidatorsRoot,
  };
}

export function configureChain(config: NativeApplicationConfig, overrides: Partial<ChainConfig> = {}) {
  const chain = createBeaconConfig({...testChain, ...overrides}, testChain.genesisValidatorsRoot);
  config.beaconConfig = new bindings.BeaconConfig(chain, chain.genesisValidatorsRoot);
  configuredChains.set(config.beaconConfig, chain);
  return chain;
}

export const requestForks: NativeForkEntry[] = testChain.forkBoundariesAscendingEpochOrder
  .filter((boundary, index, all) => boundary.epoch !== Infinity && boundary.epoch !== all[index + 1]?.epoch)
  .map((boundary) => {
    assert(boundary.fork !== "heze");
    return {digest: testChain.forkBoundary2ForkDigest(boundary), fork: boundary.fork};
  });

export function topicName(kind = "beacon_block", boundary = 0): string {
  return `/eth2/${Buffer.from(requestForks[boundary].digest).toString("hex")}/${kind}/ssz_snappy`;
}

export function applicationConfig(): NativeApplicationConfig & ReturnType<typeof networkConfig> {
  const config: NativeApplicationConfig & ReturnType<typeof networkConfig> = {
    ...networkConfig(),
    beaconConfig: new bindings.BeaconConfig(testChain, testChain.genesisValidatorsRoot),
    identify: {agentVersion: "lodestar-z/application-test", protocolVersion: "eth2/1.0.0"},
    logLevel: "info",
    resources: {
      bridgeBudgetBytes: 512 * MIB,
      maxPeers: 12,
      nativeBudgetBytes: 1024 * MIB,
      receiveBudgetBytes: 64 * 1024 * 1024,
      targetPeers: 8,
    },
    serveLightClients: false,
  };
  configuredChains.set(config.beaconConfig, testChain);
  return config;
}

export function localIntent(config: NativeApplicationConfig): NativeLocalIntent {
  return {status: structuredClone(config.local.status)};
}

export function setSlot(config: NativeApplicationConfig, slot: bigint, slotDurationMs = 12000): void {
  config.genesisTime = BigInt(Math.floor(Date.now() / 1000)) - slot * BigInt(slotDurationMs / 1000);
}

/**
 * The least a host does: each notification schedules settle-only exchanges in later macrotasks while they report
 * pending completions and observations. Serving starts and gossip stay
 * with the test, which can also hold the host to take every exchange's results itself.
 */
function settlingHost(onWorkAvailable: () => void = () => undefined) {
  let runtime: ExchangeRuntime | undefined;
  let scheduled = false;
  let held = false;
  const drain = () => {
    scheduled = false;
    if (held) return;
    if (runtime?.exchange().needsAnotherExchange) schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(drain);
  };
  return {
    attach(value: ExchangeRuntime & Pick<NetworkTestRuntime, "closed">) {
      runtime = value;
      void value.closed.then(() => {
        runtime = undefined;
      });
    },
    hold(value: boolean) {
      held = value;
      // A notification the held host skipped leaves its work queued.
      if (!held) schedule();
    },
    onWorkAvailable() {
      schedule();
      onWorkAvailable();
    },
  };
}

const settlingHosts = new WeakMap<object, ReturnType<typeof settlingHost>>();

export function startRuntime(
  config: NativeApplicationConfig,
  onWorkAvailable: () => void = () => undefined,
  onPeers?: (events: readonly NativePeerObservation[]) => void
) {
  const host = settlingHost(onWorkAvailable);
  const runtime = initializeNativeNetworkRuntime(config, host.onWorkAvailable, onPeers);
  host.attach(runtime);
  settlingHosts.set(runtime, host);
  return runtime;
}

/** While held, a started runtime's settling host exchanges nothing, so the test's own exchanges take every result. */
export function holdSettling(runtime: object, held: boolean): void {
  const host = settlingHosts.get(runtime);
  if (!host) throw Error("Not a started runtime");
  host.hold(held);
}

/** Collects released runtimes until the process may initialize another one. */
export async function runtimeReleased(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    global.gc?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      startRuntime({} as NativeApplicationConfig);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("NetworkAlreadyInitialized")) return;
    }
  }
  throw Error("A native network runtime is still live");
}

export const topicKinds: readonly NativeTopicKind[] = [
  "beacon_block",
  "beacon_aggregate_and_proof",
  "beacon_attestation",
  "proposer_slashing",
  "attester_slashing",
  "voluntary_exit",
  "sync_committee_contribution_and_proof",
  "sync_committee",
  "light_client_finality_update",
  "light_client_optimistic_update",
  "bls_to_execution_change",
  "blob_sidecar",
  "data_column_sidecar",
];

export function peerIdFromHex(hex: string): string {
  return peerIdFromPublicKey(publicKeyFromProtobuf(Buffer.from(hex, "hex").subarray(2))).toString();
}

/** A connect target that never answers, so the command stays pending until close. */
export function unreachableConnect(): [string, IpEndpoint[], bigint] {
  return [
    peerIdFromHex("00250802122102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"),
    [{address: Uint8Array.of(127, 0, 0, 1), family: 4, port: 9}],
    60000n,
  ];
}

/** Counts each watched operation's settlements and records its outcome; a synchronous throw is its settlement. */
export class Settlements {
  readonly counts: number[] = [];
  readonly outcomes: string[] = [];
  private readonly pending: Promise<void>[] = [];

  watch(start: () => Promise<unknown>): void {
    const index = this.counts.push(0) - 1;
    const record = (outcome: string) => {
      this.counts[index]++;
      this.outcomes[index] = outcome;
    };
    const failed = (error: unknown) => record(String((error as {code?: unknown}).code ?? error));
    try {
      this.pending.push(start().then(() => record("resolved"), failed));
    } catch (error) {
      failed(error);
    }
  }

  /** Rejects if a watched operation is still pending after `timeoutMs`. */
  async settled(timeoutMs = 10000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error(`Unsettled operations: ${this.unsettled(this.counts.length)}`)), timeoutMs);
    });
    try {
      await Promise.race([Promise.all(this.pending), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The operations started before `closed` settled that are still pending once the microtasks its settlement
   * enabled have run. Call before starting any operation.
   */
  unsettledAtClose(closed: Promise<unknown>): Promise<number[]> {
    return closed.then(async () => {
      const started = this.counts.length;
      for (let i = 0; i < 8; i++) await undefined;
      return this.unsettled(started);
    });
  }

  private unsettled(started: number): number[] {
    return this.counts.slice(0, started).flatMap((count, index) => (count === 0 ? [index] : []));
  }
}

/**
 * The watchdog on each child process a test runs. The children check teardown, not speed, so the bound leaves room
 * for a loaded machine.
 */
export const CHILD_TIMEOUT_MS = 30_000;
/** How much of each output stream a failed child's error keeps, from the end. */
const CHILD_OUTPUT_TAIL = 4096;

/** The options of a test that runs `children` children one after another, with `marginMs` for its own work. */
export function childTestTimeout(children = 1, marginMs = 5000): {timeout: number} {
  return {timeout: children * CHILD_TIMEOUT_MS + marginMs};
}

/**
 * Runs `command` with `args` and returns how it exited. A child still running at `CHILD_TIMEOUT_MS` gets SIGKILL,
 * because this synchronous wait also holds off Vitest's own timeout. A timeout or a failed spawn throws with the end of
 * the child's output and the last `phase` line it wrote to stderr.
 */
export function spawnCommand(
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv
): SpawnSyncReturns<string> {
  const child = spawnSync(command, args, {
    cwd: new URL("../../../", import.meta.url),
    encoding: "utf8",
    env,
    killSignal: "SIGKILL",
    timeout: CHILD_TIMEOUT_MS,
  });
  if (child.error) {
    const timedOut = (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    throw Error(
      childFailure(command, args, child, timedOut ? `timed out after ${CHILD_TIMEOUT_MS} ms` : String(child.error))
    );
  }
  return child;
}

/** Runs Node with `args` under the same watchdog and returns how it exited. */
export function spawnChild(args: readonly string[], env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnCommand(process.execPath, args, env);
}

/** Runs Node with `args` under the same watchdog and returns its stdout. Throws unless it exits 0. */
export function runChild(args: readonly string[]): string {
  const child = spawnChild(args);
  if (child.status !== 0)
    throw Error(
      childFailure(
        process.execPath,
        args,
        child,
        child.signal ? `was killed by ${child.signal}` : `exited with status ${child.status}`
      )
    );
  return child.stdout;
}

function childFailure(
  command: string,
  args: readonly string[],
  child: SpawnSyncReturns<string>,
  outcome: string
): string {
  const tail = (output: string | null) =>
    !output ? "(none)" : output.length > CHILD_OUTPUT_TAIL ? `...${output.slice(-CHILD_OUTPUT_TAIL)}` : output;
  const phase = [...(child.stderr ?? "").matchAll(/^phase (.*)$/gm)].at(-1)?.[1];
  return [
    `child ${outcome}: ${basename(command)} ${args.join(" ")}`,
    ...(phase === undefined ? [] : [`last phase: ${phase}`]),
    `stdout (last ${CHILD_OUTPUT_TAIL} characters):`,
    tail(child.stdout),
    `stderr (last ${CHILD_OUTPUT_TAIL} characters):`,
    tail(child.stderr),
  ].join("\n");
}

export function metricValue(text: string, series: string): number | undefined {
  const line = text.split("\n").find((line) => line.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

export async function waitForGossipReady(
  runtime: Pick<NativeNetwork, "getGossipDiagnostics">,
  peerIds: readonly string[],
  topics: readonly string[],
  readMetrics: () => string | Promise<string>
): Promise<void> {
  const deadline = performance.now() + 5000;
  let waiting = "";
  for (let attempt = 0; attempt < 500 && performance.now() < deadline; attempt++) {
    const ready = new Set<string>();
    let cursor = 0;
    for (let page = 0; page < 64; page++) {
      const snapshot = await runtime.getGossipDiagnostics(cursor);
      for (const peer of snapshot.peers) if (peer.connected && peer.outboundReady) ready.add(peer.identity);
      if (snapshot.nextCursor === null) break;
      cursor = snapshot.nextCursor;
    }
    const metrics = await readMetrics();
    const missingPeers = peerIds.filter((peer) => !ready.has(peer));
    const missingTopics = topics.filter(
      (topic) => (metricValue(metrics, `gossipsub_topic_peer_count{topicStr="${topic}"}`) ?? 0) < peerIds.length
    );
    if (missingPeers.length === 0 && missingTopics.length === 0) return;
    waiting = `peers=${missingPeers.join(",")} topics=${missingTopics.join(",")}`;
    await delay(10);
  }
  throw new Error(`Gossip readiness deadline: ${waiting}`);
}

export function ownerStopped(runtime: Pick<NetworkTestRuntime, "drainLogs">): boolean {
  return runtime
    .drainLogs()
    .records.some((record) => record.scope === "network_runtime" && record.message.startsWith("owner_stopped "));
}

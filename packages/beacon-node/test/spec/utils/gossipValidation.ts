import {EventEmitter} from "node:events";
import fs from "node:fs";
import path from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import jsyaml from "js-yaml";
import snappy from "snappy";
import tmp from "tmp";
import {expect} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {chainConfigFromJson, chainConfigTypes, createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ExecutionStatus, ForkChoice} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, isForkPostBellatrix} from "@lodestar/params";
import {
  BeaconStateAllForks,
  BeaconStateView,
  computeEpochAtSlot,
  createCachedBeaconState,
  isExecutionStateType,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {RootHex, phase0, ssz, sszTypesFor} from "@lodestar/types";
import {fromHex, loadYaml, toHex, toRootHex} from "@lodestar/utils";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/index.js";
import {AttestationImportOpt} from "../../../src/chain/blocks/types.js";
import {IChainEvents} from "../../../src/chain/emitter.js";
import {GossipAction, GossipActionError} from "../../../src/chain/errors/gossipValidation.js";
import {
  AttestationError,
  AttestationErrorCode,
  BlockErrorCode,
  BlockGossipError,
} from "../../../src/chain/errors/index.js";
import {ForkchoiceCaller} from "../../../src/chain/forkChoice/index.js";
import {BeaconChain, ChainEvent} from "../../../src/chain/index.js";
import {defaultChainOptions} from "../../../src/chain/options.js";
import {validateGossipAggregateAndProof} from "../../../src/chain/validation/aggregateAndProof.js";
import {GossipAttestation, validateGossipAttestationsSameAttData} from "../../../src/chain/validation/attestation.js";
import {validateGossipBlock} from "../../../src/chain/validation/block.js";
import {validateGossipSyncCommittee} from "../../../src/chain/validation/syncCommittee.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../src/chain/validation/syncCommitteeContributionAndProof.js";
import {validateGossipVoluntaryExit} from "../../../src/chain/validation/voluntaryExit.js";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";
import {BeaconDb} from "../../../src/db/index.js";
import {ExecutionPayloadStatus as EnginePayloadStatus} from "../../../src/execution/engine/interface.js";
import {ExecutionEngineMockBackend} from "../../../src/execution/engine/mock.js";
import {getExecutionEngineFromBackend} from "../../../src/execution/index.js";
import {NetworkEventBus} from "../../../src/network/events.js";
import {GossipHandlers, GossipType, SequentialGossipHandler} from "../../../src/network/gossip/interface.js";
import {sszDeserialize, sszDeserializeSingleAttestation} from "../../../src/network/gossip/topic.js";
import {AggregatorTracker} from "../../../src/network/processor/aggregatorTracker.js";
import {getGossipHandlers} from "../../../src/network/processor/gossipHandlers.js";
import type {IClock} from "../../../src/util/clock.js";
import {nextEventLoop} from "../../../src/util/eventLoop.js";
import {getBeaconAttestationGossipIndex, getSlotFromBeaconAttestationSerialized} from "../../../src/util/sszBytes.js";
import {assertCorrectProgressiveBalances} from "../config.js";

const gossipLogger = testLogger("spec-gossip");

/** Deterministic millisecond clock for gossip boundary vectors. */
export class GossipTestClock extends EventEmitter implements IClock {
  genesisTime: number;
  private currentTimeMs: number;
  private secondsPerSlot: number;
  private maxDisparityMs: number;

  constructor(genesisTimeSec: number, secondsPerSlot: number, maxDisparityMs: number) {
    super();
    this.genesisTime = genesisTimeSec;
    this.currentTimeMs = genesisTimeSec * 1000;
    this.secondsPerSlot = secondsPerSlot;
    this.maxDisparityMs = maxDisparityMs;
  }

  get currentSlot(): number {
    return Math.floor((this.currentTimeMs / 1000 - this.genesisTime) / this.secondsPerSlot);
  }

  get currentSlotWithGossipDisparity(): number {
    const slot = this.currentSlot;
    const nextSlotTimeMs = (this.genesisTime + (slot + 1) * this.secondsPerSlot) * 1000;
    if (nextSlotTimeMs - this.currentTimeMs <= this.maxDisparityMs) {
      return slot + 1;
    }
    return slot;
  }

  get currentEpoch(): number {
    return computeEpochAtSlot(this.currentSlot);
  }

  slotWithFutureTolerance(toleranceSec: number): number {
    return Math.floor((this.currentTimeMs / 1000 + toleranceSec - this.genesisTime) / this.secondsPerSlot);
  }

  slotWithPastTolerance(toleranceSec: number): number {
    return Math.floor((this.currentTimeMs / 1000 - toleranceSec - this.genesisTime) / this.secondsPerSlot);
  }

  isCurrentSlotGivenGossipDisparity(slot: number): boolean {
    const current = this.currentSlot;
    if (slot === current) return true;
    const nextSlotTimeMs = (this.genesisTime + (current + 1) * this.secondsPerSlot) * 1000;
    if (nextSlotTimeMs - this.currentTimeMs <= this.maxDisparityMs) {
      return slot === current + 1;
    }
    const currentSlotTimeMs = (this.genesisTime + current * this.secondsPerSlot) * 1000;
    if (this.currentTimeMs - currentSlotTimeMs <= this.maxDisparityMs) {
      return slot === current - 1;
    }
    return false;
  }

  async waitForSlot(): Promise<void> {
    throw Error("Gossip fixture clock does not support waiting for slots");
  }

  secFromSlot(slot: number, toSec?: number): number {
    const slotTimeSec = this.genesisTime + slot * this.secondsPerSlot;
    return (toSec ?? this.currentTimeMs / 1000) - slotTimeSec;
  }

  msFromSlot(slot: number, toMs?: number): number {
    const slotTimeMs = (this.genesisTime + slot * this.secondsPerSlot) * 1000;
    return (toMs ?? this.currentTimeMs) - slotTimeMs;
  }

  /** Set the current time in milliseconds since genesis */
  setCurrentTimeMs(ms: number): void {
    this.currentTimeMs = this.genesisTime * 1000 + ms;
  }

  setSlot(slot: number): void {
    this.currentTimeMs = (this.genesisTime + slot * this.secondsPerSlot) * 1000;
  }
}

type MetaPayloadStatus = "VALID" | "NOT_VALIDATED" | "INVALIDATED";

interface MetaYaml {
  topic: GossipType;
  blocks: {block: string; failed?: boolean; pending?: boolean; payload_status?: MetaPayloadStatus}[];
  finalized_checkpoint?: {epoch: bigint; root?: string; block?: string};
  current_time_ms?: bigint;
  messages: {
    offset_ms?: bigint;
    subnet_id?: bigint;
    message: string;
    expected: "valid" | "ignore" | "reject";
    reason?: string;
  }[];
}

const gossipTopicByHandler = {
  gossip_beacon_block: GossipType.beacon_block,
  gossip_beacon_aggregate_and_proof: GossipType.beacon_aggregate_and_proof,
  gossip_beacon_attestation: GossipType.beacon_attestation,
  gossip_proposer_slashing: GossipType.proposer_slashing,
  gossip_attester_slashing: GossipType.attester_slashing,
  gossip_voluntary_exit: GossipType.voluntary_exit,
  gossip_sync_committee_message: GossipType.sync_committee,
  gossip_sync_committee_contribution_and_proof: GossipType.sync_committee_contribution_and_proof,
  gossip_bls_to_execution_change: GossipType.bls_to_execution_change,
} as const satisfies Record<string, GossipType>;

export function isGossipValidationHandler(topicHandler: string): topicHandler is keyof typeof gossipTopicByHandler {
  return topicHandler in gossipTopicByHandler;
}

function getGossipTopic(topicHandler: string): GossipType {
  if (!isGossipValidationHandler(topicHandler)) {
    throw Error(`Unsupported gossip test handler ${topicHandler}`);
  }
  return gossipTopicByHandler[topicHandler];
}

function loadMeta(testCaseDir: string): MetaYaml {
  const raw = fs.readFileSync(path.join(testCaseDir, "meta.yaml"), "utf8");
  return loadYaml<MetaYaml>(raw);
}

function loadTestCaseChainConfig(testCaseDir: string, fork: ForkName) {
  const configPath = path.join(testCaseDir, "config.yaml");
  if (!fs.existsSync(configPath)) return getConfig(fork);

  // Parse config scalars as raw strings so byte values such as `0x00000001`
  // keep their leading zeros before passing through `chainConfigFromJson()`.
  // FAILSAFE_SCHEMA produces strings for scalars and preserves arrays/objects
  // (e.g. `BLOB_SCHEDULE`) as-is for `chainConfigFromJson` to deserialize.
  const parsed = jsyaml.load(fs.readFileSync(configPath, "utf8"), {
    schema: jsyaml.FAILSAFE_SCHEMA,
  }) as Record<string, unknown>;
  const configJson: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (key in chainConfigTypes) {
      configJson[key] = value;
    }
  }

  return {...getConfig(fork), ...chainConfigFromJson(configJson)};
}

function loadSszSnappy(testCaseDir: string, name: string): Uint8Array {
  const compressed = fs.readFileSync(path.join(testCaseDir, `${name}.ssz_snappy`));
  const decompressed = snappy.uncompressSync(compressed);
  return typeof decompressed === "string" ? Buffer.from(decompressed) : decompressed;
}

function loadState(testCaseDir: string, fork: ForkName): BeaconStateAllForks {
  const bytes = loadSszSnappy(testCaseDir, "state");
  return sszTypesFor(fork).BeaconState.deserializeToViewDU(bytes);
}

type FinalizedCheckpoint = {epoch: number; rootHex: RootHex};

function loadBlockRootHex(testCaseDir: string, fork: ForkName, name: string): RootHex {
  const signedBlock = sszTypesFor(fork).SignedBeaconBlock.deserialize(loadSszSnappy(testCaseDir, name));
  return toHex(sszTypesFor(fork).BeaconBlock.hashTreeRoot(signedBlock.message));
}

function resolveFinalizedCheckpoint(
  meta: MetaYaml,
  testCaseDir: string,
  fork: ForkName,
  blockRootsByName: Map<string, RootHex>
): FinalizedCheckpoint | null {
  const cp = meta.finalized_checkpoint;
  if (!cp) return null;

  let rootHex: RootHex | null = null;
  if (cp.root) {
    rootHex = toRootHex(fromHex(cp.root));
  }
  if (cp.block) {
    const blockRootHex = blockRootsByName.get(cp.block) ?? loadBlockRootHex(testCaseDir, fork, cp.block);
    blockRootsByName.set(cp.block, blockRootHex);
    if (rootHex !== null && rootHex !== blockRootHex) {
      throw new Error(`finalized_checkpoint.root does not match root of ${cp.block}`);
    }
    rootHex = blockRootHex;
  }

  if (rootHex === null) {
    throw new Error("finalized_checkpoint must include either root or block");
  }

  if (cp.epoch == null) {
    throw new Error("finalized_checkpoint must include an epoch");
  }
  return {epoch: Number(cp.epoch), rootHex};
}

// Pyspec anchors can be synthetic blocks whose header is not state.latestBlockHeader.
// Only initialization metadata differs; the fixture state and its root stay unchanged.
class GossipAnchorState extends BeaconStateView {
  constructor(
    state: ConstructorParameters<typeof BeaconStateView>[0],
    private readonly anchorHeader: phase0.BeaconBlockHeader
  ) {
    super(state);
  }

  override computeAnchorCheckpoint() {
    return {
      blockHeader: this.anchorHeader,
      checkpoint: {
        epoch: computeEpochAtSlot(this.slot),
        root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(this.anchorHeader),
      },
    };
  }
}

class GossipForkChoice extends ForkChoice {
  private readonly fixtureStore: ConstructorParameters<typeof ForkChoice>[1];
  private readonly fixtureProtoArray: ConstructorParameters<typeof ForkChoice>[2];

  constructor(...args: ConstructorParameters<typeof ForkChoice>) {
    // The checkpoint-sync justified-epoch safety bump is not part of get_forkchoice_store.
    const [, store, protoArray] = args;
    store.justified = {...store.justified, checkpoint: store.finalizedCheckpoint};
    store.unrealizedJustified = store.justified;
    protoArray.justifiedEpoch = store.finalizedCheckpoint.epoch;
    protoArray.nodes[0].justifiedEpoch = store.finalizedCheckpoint.epoch;
    protoArray.nodes[0].unrealizedJustifiedEpoch = store.finalizedCheckpoint.epoch;
    super(...args);
    this.fixtureStore = args[1];
    this.fixtureProtoArray = args[2];
  }

  setFinalizedCheckpoint(checkpoint: FinalizedCheckpoint): void {
    const checkpointWithHex = {
      epoch: checkpoint.epoch,
      root: fromHex(checkpoint.rootHex),
      rootHex: checkpoint.rootHex,
    };
    this.fixtureStore.finalizedCheckpoint = checkpointWithHex;
    this.fixtureStore.unrealizedFinalizedCheckpoint = checkpointWithHex;
    this.fixtureProtoArray.finalizedEpoch = checkpoint.epoch;
    this.fixtureProtoArray.finalizedRoot = checkpoint.rootHex;
  }

  pruneFinalizedCheckpoint(): void {
    const {epoch, rootHex} = this.getFinalizedCheckpoint();
    expect(epoch, "Pruning requires a finalized checkpoint after genesis").toBeGreaterThan(0);
    expect(this.getBlockHexDefaultStatus(rootHex)).not.toBeNull();
    this.fixtureProtoArray.pruneThreshold = 0;
    expect(this.prune(rootHex).length, "Pruning must remove ancestors of the finalized block").toBeGreaterThan(0);
  }

  getEquivocatingIndices(): ReadonlySet<number> {
    return this.fixtureStore.equivocatingIndices;
  }
}

function invalidateImportedBlock(chain: BeaconChain, blockRootHex: RootHex, parentRootHex: RootHex): void {
  const parentBlock = chain.forkChoice.getBlockHexDefaultStatus(parentRootHex);
  if (!parentBlock?.executionPayloadBlockHash) {
    throw new Error(`Cannot invalidate ${blockRootHex}: parent ${parentRootHex} has no latest valid execution hash`);
  }
  const block = chain.forkChoice.getBlockHexDefaultStatus(blockRootHex);
  if (!block?.executionPayloadBlockHash) {
    throw new Error(`Cannot invalidate ${blockRootHex}: block has no execution payload hash`);
  }

  chain.forkChoice.validateLatestHash({
    executionStatus: ExecutionStatus.Invalid,
    latestValidExecHash: parentBlock.executionPayloadBlockHash,
    invalidateFromParentBlockRoot: blockRootHex,
    invalidateFromParentBlockHash: block.executionPayloadBlockHash,
  });
}

export function gossipValidationResult(
  e: unknown,
  fork: ForkName,
  unimportedBlocks: Map<RootHex, MetaYaml["blocks"][number]>
): "ignore" | "reject" {
  // Lodestar drops consensus-invalid blocks before fork choice and keeps pending
  // blocks outside it. Translate only a production unknown-block result for these
  // explicitly known fixtures; all other validation decisions stay in production.
  if (e instanceof BlockGossipError && e.type.code === BlockErrorCode.PARENT_BLOCK_UNKNOWN) {
    const block = unimportedBlocks.get(e.type.parentRoot);
    if (block) {
      return isForkPostBellatrix(fork) && block.payload_status && block.payload_status !== "NOT_VALIDATED"
        ? "ignore"
        : "reject";
    }
  }
  if (
    e instanceof AttestationError &&
    e.type.code === AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT &&
    unimportedBlocks.has(e.type.root)
  )
    return "reject";

  if (e instanceof GossipActionError) {
    return e.action === GossipAction.IGNORE ? "ignore" : "reject";
  }
  throw e;
}

export async function runGossipValidationTest(
  fork: ForkName,
  topicHandler: string,
  testCaseDir: string,
  opts?: {pruneFinalized?: boolean}
): Promise<void> {
  const meta = loadMeta(testCaseDir);
  const logger = gossipLogger.child({module: `${fork}/${path.basename(testCaseDir)}`});
  const topic = getGossipTopic(topicHandler);
  if (meta.topic !== topic) {
    throw Error(`Gossip test topic mismatch for ${topicHandler}: expected ${topic}, got ${meta.topic}`);
  }

  const anchorState = loadState(testCaseDir, fork);
  const testCaseConfig = loadTestCaseChainConfig(testCaseDir, fork);
  const beaconConfig = createBeaconConfig(testCaseConfig, anchorState.genesisValidatorsRoot);

  const genesisTimeSec = Number(anchorState.genesisTime);
  const clock = new GossipTestClock(
    genesisTimeSec,
    beaconConfig.SLOT_DURATION_MS / 1000,
    beaconConfig.MAXIMUM_GOSSIP_CLOCK_DISPARITY
  );

  const controller = new AbortController();
  const executionEngineBackend = new ExecutionEngineMockBackend({
    onlyPredefinedResponses: false,
    genesisBlockHash: isExecutionStateType(anchorState)
      ? toHex(anchorState.latestExecutionPayloadHeader.blockHash)
      : ZERO_HASH_HEX,
  });
  const executionEngine = getExecutionEngineFromBackend(executionEngineBackend, {
    signal: controller.signal,
    logger: logger.child({module: "executionEngine"}),
  });
  pubkeyCache.syncPubkeys(anchorState.validators.getAllReadonlyValues());
  const cachedState = createCachedBeaconState(
    anchorState,
    {config: beaconConfig, pubkeyCache},
    {skipSyncPubkeys: true}
  );
  const anchorEntry = meta.blocks[0];
  if (!anchorEntry || anchorEntry.failed || anchorEntry.pending) {
    throw Error("First blocks entry must be the anchor");
  }
  const anchorBlock = sszTypesFor(fork).SignedBeaconBlock.deserialize(loadSszSnappy(testCaseDir, anchorEntry.block));
  expect(toRootHex(anchorBlock.message.stateRoot)).toBe(toRootHex(anchorState.hashTreeRoot()));
  expect(anchorBlock.message.slot).toBe(anchorState.slot);
  const anchorStateView = new GossipAnchorState(
    cachedState,
    signedBlockToSignedHeader(beaconConfig, anchorBlock).message
  );
  clock.setSlot(anchorState.slot);

  const dbDir = tmp.dirSync({unsafeCleanup: true});
  const db = new BeaconDb(beaconConfig, await LevelDbController.create({name: dbDir.name}, {logger}));
  const finalizationTasks: Promise<PromiseSettledResult<void>[]>[] = [];
  async function drainFinalizationTasks(): Promise<void> {
    for (const results of await Promise.all(finalizationTasks.splice(0))) {
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    }
  }
  let chain: BeaconChain | undefined;
  try {
    await db.blockArchive.add(anchorBlock);
    chain = new BeaconChain(
      {
        ...defaultChainOptions,
        // Disable non-spec maxSkipSlots check for conformance tests
        maxSkipSlots: undefined,
        blsVerifyAllMainThread: true,
        disableArchiveOnCheckpoint: true,
        disableLightClientServerOnImportBlockHead: true,
        disableOnBlockError: true,
        disablePrepareNextSlot: true,
        assertCorrectProgressiveBalances,
        forkchoiceConstructor: GossipForkChoice,
        proposerBoost: true,
        proposerBoostReorg: true,
      },
      {
        privateKey: await generateKeyPair("secp256k1"),
        config: beaconConfig,
        pubkeyCache,
        db,
        dataDir: dbDir.name,
        dbName: "gossip-spec",
        logger,
        processShutdownCallback: () => {},
        clock,
        metrics: null,
        validatorMonitor: null,
        anchorState: anchorStateView,
        isAnchorStateFinalized: true,
        executionEngine,
        executionBuilder: undefined,
      }
    );

    // Run the real listeners, but await their work before validating messages or closing the fixture database.
    const finalizedListeners = chain.emitter.listeners(
      ChainEvent.forkChoiceFinalized
    ) as IChainEvents[ChainEvent.forkChoiceFinalized][];
    for (const listener of finalizedListeners) {
      chain.emitter.off(ChainEvent.forkChoiceFinalized, listener);
      chain.emitter.on(ChainEvent.forkChoiceFinalized, (checkpoint) => {
        finalizationTasks.push(Promise.allSettled([listener(checkpoint)]));
      });
    }

    const blockRootsByName = new Map<string, RootHex>();
    const unimportedBlocks = new Map<RootHex, MetaYaml["blocks"][number]>();

    const anchorRootHex = toRootHex(anchorStateView.computeAnchorCheckpoint().checkpoint.root);
    blockRootsByName.set(anchorEntry.block, anchorRootHex);

    // Setup blocks use the normal import path, including its seen-cache and fork-choice updates.
    for (const blockEntry of meta.blocks.slice(1)) {
      const signedBlock = sszTypesFor(fork).SignedBeaconBlock.deserialize(loadSszSnappy(testCaseDir, blockEntry.block));
      const slot = signedBlock.message.slot;
      const blockRootHex = toRootHex(sszTypesFor(fork).BeaconBlock.hashTreeRoot(signedBlock.message));
      blockRootsByName.set(blockEntry.block, blockRootHex);
      if (blockEntry.pending) {
        unimportedBlocks.set(blockRootHex, blockEntry);
        continue;
      }

      const parentRootHex = toRootHex(signedBlock.message.parentRoot);
      clock.setSlot(slot);
      chain.forkChoice.updateTime(slot);
      if ("executionPayload" in signedBlock.message.body) {
        const blockHash = toRootHex(signedBlock.message.body.executionPayload.blockHash);
        const optimistic = blockEntry.payload_status === "INVALIDATED" || blockEntry.payload_status === "NOT_VALIDATED";
        executionEngineBackend.addPredefinedPayloadStatus(blockHash, {
          status: optimistic ? EnginePayloadStatus.SYNCING : EnginePayloadStatus.VALID,
          latestValidHash: optimistic ? null : blockHash,
          validationError: null,
        });
      }

      if ("blobKzgCommitments" in signedBlock.message.body) {
        expect(signedBlock.message.body.blobKzgCommitments).toHaveLength(0);
      }
      const blockInput = chain.seenBlockInputCache.getByBlock({
        block: signedBlock,
        blockRootHex,
        source: BlockInputSource.byRange,
        seenTimestampSec: genesisTimeSec + (slot * beaconConfig.SLOT_DURATION_MS) / 1000,
      });
      const importResult = chain.processBlock(blockInput, {
        importAttestations: AttestationImportOpt.Force,
        validSignatures: false,
      });
      if (blockEntry.failed) {
        // Failed fixtures deliberately use incorrect state roots, not arbitrary import errors.
        await expect(
          importResult,
          `Failed fixture ${blockEntry.block} must fail production import`
        ).rejects.toMatchObject({
          type: {code: BlockErrorCode.INVALID_STATE_ROOT},
        });
        expect(chain.forkChoice.getBlockHexDefaultStatus(blockRootHex)).toBeNull();
        unimportedBlocks.set(blockRootHex, blockEntry);
        continue;
      }
      await importResult;
      await drainFinalizationTasks();
      if (blockEntry.payload_status === "INVALIDATED") {
        invalidateImportedBlock(chain, blockRootHex, parentRootHex);
        chain.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
      }
    }

    const finalizedCheckpoint = resolveFinalizedCheckpoint(meta, testCaseDir, fork, blockRootsByName);
    if (finalizedCheckpoint) {
      if (!(chain.forkChoice instanceof GossipForkChoice)) throw Error("Unexpected fork choice");
      chain.forkChoice.setFinalizedCheckpoint(finalizedCheckpoint);
      chain.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    }
    await drainFinalizationTasks();

    if (opts?.pruneFinalized) {
      expect(meta.finalized_checkpoint, "Pruning coverage must use finalization from imported blocks").toBeUndefined();
      if (!(chain.forkChoice instanceof GossipForkChoice)) throw Error("Unexpected fork choice");
      chain.forkChoice.pruneFinalizedCheckpoint();
      chain.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    }

    const gossipHandlers = getGossipHandlers(
      {
        chain,
        config: beaconConfig,
        logger,
        metrics: null,
        events: new NetworkEventBus(),
        aggregatorTracker: new AggregatorTracker(),
        core: {
          reportPeer: () => {
            throw Error("Operation gossip fixtures must not report peers");
          },
        },
      },
      {}
    );

    const baseCurrentTimeMs = Number(meta.current_time_ms ?? 0);
    for (const message of meta.messages) {
      const messageTimeMs = baseCurrentTimeMs + Number(message.offset_ms ?? 0);
      clock.setCurrentTimeMs(messageTimeMs);

      let result: "valid" | "ignore" | "reject";
      let validationError: unknown;
      try {
        await validateMessageForTopic(chain, fork, topic, testCaseDir, message, gossipHandlers);
        result = "valid";
      } catch (e) {
        validationError = e;
        result = gossipValidationResult(e, fork, unimportedBlocks);
      }

      expect(result).toEqualWithMessage(
        message.expected,
        `Unexpected gossip result for ${topicHandler}/${path.basename(testCaseDir)}/${message.message}: ${String(validationError ?? "accepted")}`
      );
    }
  } finally {
    try {
      await drainFinalizationTasks();
    } finally {
      controller.abort();
      await chain?.close();
      await db.close();
      dbDir.removeCallback();
    }
  }
}

async function validateMessageForTopic(
  chain: BeaconChain,
  fork: ForkName,
  topic: GossipType,
  testCaseDir: string,
  message: MetaYaml["messages"][number],
  gossipHandlers: GossipHandlers
): Promise<void> {
  const bytes = loadSszSnappy(testCaseDir, message.message);
  const boundary = {fork, epoch: chain.config.forks[fork].epoch};
  const subnet = Number(message.subnet_id ?? 0);

  switch (topic) {
    case GossipType.beacon_block: {
      const signedBlock = sszDeserialize({type: topic, boundary}, bytes);

      await validateGossipBlock(chain.config, chain, signedBlock, fork);
      break;
    }

    case GossipType.beacon_aggregate_and_proof: {
      const aggregate = sszDeserialize({type: topic, boundary}, bytes);

      await validateGossipAggregateAndProof(fork, chain, aggregate, bytes);
      break;
    }

    case GossipType.beacon_attestation: {
      const attDataBase64 = getBeaconAttestationGossipIndex(fork, bytes);
      const attSlot = getSlotFromBeaconAttestationSerialized(fork, bytes);
      if (attDataBase64 == null || attSlot == null) {
        sszDeserializeSingleAttestation(fork, bytes);
        throw Error("Could not index a structurally valid gossip attestation");
      }

      const gossipAttestation: GossipAttestation = {
        attestation: null,
        serializedData: bytes,
        attSlot,
        attDataBase64,
        subnet,
      };

      const batchResult = await validateGossipAttestationsSameAttData(fork, chain, [gossipAttestation]);
      expect(batchResult.results).toHaveLength(1);
      const first = batchResult.results[0];
      if (first.err) throw first.err;
      expect(first.result).toBeDefined();
      break;
    }

    case GossipType.proposer_slashing:
    case GossipType.attester_slashing:
    case GossipType.bls_to_execution_change: {
      const event = {
        [GossipType.proposer_slashing]: routes.events.EventType.proposerSlashing,
        [GossipType.attester_slashing]: routes.events.EventType.attesterSlashing,
        [GossipType.bls_to_execution_change]: routes.events.EventType.blsToExecutionChange,
      }[topic];
      let handled = false;
      const onHandled = (): void => {
        handled = true;
      };
      chain.emitter.once(event, onHandled);
      try {
        const handler = gossipHandlers[topic] as SequentialGossipHandler<typeof topic>;
        await handler({
          gossipData: {serializedData: bytes},
          topic: {type: topic, boundary},
          peerIdStr: "spec-test",
          seenTimestampSec: chain.clock.genesisTime + chain.clock.secFromSlot(0),
        });
        // Handler updates are deferred until after the validation result is returned.
        await nextEventLoop();
        expect(handled, `Accepted ${topic} did not complete its production handler`).toBe(true);
        if (topic === GossipType.attester_slashing) {
          const slashing = sszDeserialize({type: topic, boundary}, bytes);
          if (!(chain.forkChoice instanceof GossipForkChoice)) throw Error("Unexpected fork choice");
          const equivocatingIndices = chain.forkChoice.getEquivocatingIndices();
          const secondIndices = new Set(slashing.attestation2.attestingIndices);
          for (const index of slashing.attestation1.attestingIndices) {
            if (secondIndices.has(index)) {
              expect(
                equivocatingIndices.has(index),
                `Slashed validator ${index} must be excluded from fork choice`
              ).toBe(true);
            }
          }
        }
      } finally {
        chain.emitter.off(event, onHandled);
      }
      break;
    }

    case GossipType.voluntary_exit: {
      const exit = sszDeserialize({type: topic, boundary}, bytes);
      await validateGossipVoluntaryExit(chain, exit);
      // Mirror gossip handler: insert into opPool so duplicate detection works
      chain.opPool.insertVoluntaryExit(exit);
      break;
    }

    case GossipType.sync_committee: {
      const syncCommitteeMessage = sszDeserialize({type: topic, boundary, subnet}, bytes);
      await validateGossipSyncCommittee(chain, syncCommitteeMessage, subnet);
      break;
    }

    case GossipType.sync_committee_contribution_and_proof: {
      const signedContributionAndProof = sszDeserialize({type: topic, boundary}, bytes);
      await validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof);
      break;
    }

    default:
      throw new Error(`Unknown gossip topic: ${topic}`);
  }
}

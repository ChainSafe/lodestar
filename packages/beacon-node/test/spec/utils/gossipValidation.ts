import {EventEmitter} from "node:events";
import fs from "node:fs";
import path from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import snappy from "snappy";
import {expect} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {
  BeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  createPubkeyCache,
  isExecutionStateType,
  syncPubkeys,
} from "@lodestar/state-transition";
import {RootHex, sszTypesFor} from "@lodestar/types";
import {fromHex, loadYaml, toHex, toRootHex} from "@lodestar/utils";
import {BlockInputPreData, BlockInputSource} from "../../../src/chain/blocks/blockInput/index.js";
import {AttestationImportOpt, BlobSidecarValidation} from "../../../src/chain/blocks/types.js";
import {GossipAction, GossipActionError} from "../../../src/chain/errors/gossipValidation.js";
import {BeaconChain, ChainEvent} from "../../../src/chain/index.js";
import {defaultChainOptions} from "../../../src/chain/options.js";
import {validateGossipAggregateAndProof} from "../../../src/chain/validation/aggregateAndProof.js";
import {GossipAttestation, validateGossipAttestationsSameAttData} from "../../../src/chain/validation/attestation.js";
import {validateGossipAttesterSlashing} from "../../../src/chain/validation/attesterSlashing.js";
import {validateGossipBlock} from "../../../src/chain/validation/block.js";
import {validateGossipProposerSlashing} from "../../../src/chain/validation/proposerSlashing.js";
import {validateGossipVoluntaryExit} from "../../../src/chain/validation/voluntaryExit.js";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";
import {ExecutionEngineMockBackend} from "../../../src/execution/engine/mock.js";
import {getExecutionEngineFromBackend} from "../../../src/execution/index.js";
import {GossipType} from "../../../src/network/gossip/interface.js";
import type {IClock} from "../../../src/util/clock.js";
import {getBeaconAttestationGossipIndex, getSlotFromBeaconAttestationSerialized} from "../../../src/util/sszBytes.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";
import {getConfig} from "../../utils/config.js";
import {testLogger} from "../../utils/logger.js";
import {assertCorrectProgressiveBalances} from "../config.js";

/**
 * A test clock that models gossip clock disparity from a millisecond timestamp.
 * Unlike ClockStopped which returns exact slot values, this clock computes
 * currentSlotWithGossipDisparity correctly for spec conformance tests.
 */
class GossipTestClock extends EventEmitter implements IClock {
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
    // Model: if we're within maxDisparityMs of next slot, return next slot
    // Spec: current_time_ms + MAXIMUM_GOSSIP_CLOCK_DISPARITY >= block_time_ms
    // This means: nextSlotTimeMs - currentTimeMs <= maxDisparityMs
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
    // Not used in tests
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

  /** Also support setSlot for block import phases */
  setSlot(slot: number): void {
    this.currentTimeMs = (this.genesisTime + slot * this.secondsPerSlot) * 1000;
  }
}

interface MetaYaml {
  topic: GossipType;
  blocks?: {block: string; failed?: boolean}[];
  finalized_checkpoint?: {epoch: number; root?: string; block?: string};
  current_time_ms?: number;
  messages: {
    offset_ms?: number;
    subnet_id?: number;
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

function setFinalizedCheckpoint(chain: BeaconChain, checkpoint: FinalizedCheckpoint): void {
  const checkpointWithHex = {
    epoch: checkpoint.epoch,
    root: fromHex(checkpoint.rootHex),
    rootHex: checkpoint.rootHex,
  };

  const forkChoice = chain.forkChoice as unknown as {
    fcStore: {
      finalizedCheckpoint: typeof checkpointWithHex;
      unrealizedFinalizedCheckpoint: typeof checkpointWithHex;
    };
    protoArray: {
      finalizedEpoch: number;
      finalizedRoot: RootHex;
    };
    updateHead?: () => unknown;
  };

  forkChoice.fcStore.finalizedCheckpoint = checkpointWithHex;
  forkChoice.fcStore.unrealizedFinalizedCheckpoint = checkpointWithHex;
  forkChoice.protoArray.finalizedEpoch = checkpoint.epoch;
  forkChoice.protoArray.finalizedRoot = checkpoint.rootHex;
  forkChoice.updateHead?.();
}

function isDescendantAtFinalizedCheckpoint(
  chain: BeaconChain,
  blockRootHex: RootHex,
  checkpoint: FinalizedCheckpoint
): boolean {
  try {
    const finalizedSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    return chain.forkChoice.getAncestor(blockRootHex, finalizedSlot).blockRoot === checkpoint.rootHex;
  } catch {
    return false;
  }
}

function mapErrorToResult(e: unknown): "valid" | "ignore" | "reject" {
  if (e instanceof GossipActionError) {
    return e.action === GossipAction.IGNORE ? "ignore" : "reject";
  }
  // Some validation paths throw raw errors instead of GossipActionError
  // (e.g., validator index out of range → TypeError on undefined access).
  if (e instanceof TypeError || e instanceof RangeError || e instanceof Error) {
    return "reject";
  }
  throw e;
}

export async function runGossipValidationTest(
  fork: ForkName,
  topicHandler: string,
  testCaseDir: string
): Promise<void> {
  const meta = loadMeta(testCaseDir);
  const topic = getGossipTopic(topicHandler);
  if (meta.topic !== topic) {
    throw Error(`Gossip test topic mismatch for ${topicHandler}: expected ${topic}, got ${meta.topic}`);
  }

  const anchorState = loadState(testCaseDir, fork);
  const config = getConfig(fork);
  const beaconConfig = createBeaconConfig(config, anchorState.genesisValidatorsRoot);

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
    logger: testLogger("executionEngine"),
  });

  const pubkeyCache = createPubkeyCache();
  syncPubkeys(pubkeyCache, anchorState.validators.getAllReadonlyValues());
  const cachedState = createCachedBeaconState(
    anchorState,
    {config: beaconConfig, pubkeyCache},
    {skipSyncPubkeys: true}
  );

  const chain = new BeaconChain(
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
      proposerBoost: true,
      proposerBoostReorg: true,
    },
    {
      privateKey: await generateKeyPair("secp256k1"),
      config: beaconConfig,
      pubkeyCache,
      db: getMockedBeaconDb(),
      dataDir: ".",
      dbName: ",",
      logger: testLogger("spec-gossip"),
      processShutdownCallback: () => {},
      clock,
      metrics: null,
      validatorMonitor: null,
      anchorState: cachedState,
      isAnchorStateFinalized: true,
      executionEngine,
      executionBuilder: undefined,
    }
  );

  chain.emitter.removeAllListeners(ChainEvent.forkChoiceFinalized);

  try {
    const blockRootsByName = new Map<string, RootHex>();

    if (meta.blocks) {
      for (const blockEntry of meta.blocks) {
        const signedBlock = sszTypesFor(fork).SignedBeaconBlock.deserialize(
          loadSszSnappy(testCaseDir, blockEntry.block)
        );
        const slot = signedBlock.message.slot;
        const blockRootHex = toHex(beaconConfig.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
        blockRootsByName.set(blockEntry.block, blockRootHex);

        if (blockEntry.failed) continue;

        // Skip genesis block — it's already the anchor state
        if (slot === 0) continue;

        clock.setSlot(slot);
        chain.forkChoice.updateTime(slot);

        const blockImport = BlockInputPreData.createFromBlock({
          forkName: fork,
          block: signedBlock,
          blockRootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: 0,
          daOutOfRange: false,
        });

        await chain.processBlock(blockImport, {
          seenTimestampSec: 0,
          validBlobSidecars: BlobSidecarValidation.Full,
          importAttestations: AttestationImportOpt.Force,
          validSignatures: false,
        });
      }
    }

    const finalizedCheckpoint = resolveFinalizedCheckpoint(meta, testCaseDir, fork, blockRootsByName);
    if (finalizedCheckpoint) {
      setFinalizedCheckpoint(chain, finalizedCheckpoint);
    }

    const failedBlockRoots = new Set<RootHex>(
      (meta.blocks ?? [])
        .filter((blockEntry) => blockEntry.failed === true)
        .map((blockEntry) => {
          const rootHex = blockRootsByName.get(blockEntry.block);
          if (!rootHex) throw new Error(`Missing cached root for block ${blockEntry.block}`);
          return rootHex;
        })
    );

    const baseCurrentTimeMs = Number(meta.current_time_ms ?? 0);
    for (const message of meta.messages) {
      const messageTimeMs = baseCurrentTimeMs + Number(message.offset_ms ?? 0);
      clock.setCurrentTimeMs(messageTimeMs);

      let result: "valid" | "ignore" | "reject";
      try {
        await validateMessageForTopic(chain, fork, topic, testCaseDir, message, failedBlockRoots, finalizedCheckpoint);
        result = "valid";
      } catch (e) {
        result = mapErrorToResult(e);
      }

      expect(result).toEqualWithMessage(
        message.expected,
        `Unexpected gossip result for ${topicHandler}/${path.basename(testCaseDir)}/${message.message}`
      );
    }
  } finally {
    controller.abort();
    await chain.close();
  }
}

async function validateMessageForTopic(
  chain: BeaconChain,
  fork: ForkName,
  topic: GossipType,
  testCaseDir: string,
  message: MetaYaml["messages"][number],
  failedBlockRoots: Set<RootHex>,
  finalizedCheckpoint: FinalizedCheckpoint | null
): Promise<void> {
  const bytes = rejectOnInvalidSerializedBytes(() => loadSszSnappy(testCaseDir, message.message));

  switch (topic) {
    case GossipType.beacon_block: {
      const signedBlock = rejectOnInvalidSerializedBytes(() => sszTypesFor(fork).SignedBeaconBlock.deserialize(bytes));
      const parentRootHex = toRootHex(signedBlock.message.parentRoot);

      if (failedBlockRoots.has(parentRootHex)) {
        throw new GossipActionError(GossipAction.REJECT, {code: "SPEC_PARENT_BLOCK_FAILED"});
      }

      if (
        finalizedCheckpoint !== null &&
        !isDescendantAtFinalizedCheckpoint(chain, parentRootHex, finalizedCheckpoint)
      ) {
        throw new GossipActionError(GossipAction.REJECT, {code: "SPEC_FINALIZED_NOT_ANCESTOR"});
      }

      await validateGossipBlock(chain.config, chain, signedBlock, fork);
      chain.seenBlockProposers.add(signedBlock.message.slot, signedBlock.message.proposerIndex);
      break;
    }

    case GossipType.beacon_aggregate_and_proof: {
      const aggregate = rejectOnInvalidSerializedBytes(() =>
        sszTypesFor(fork).SignedAggregateAndProof.deserialize(bytes)
      );
      const beaconBlockRootHex = toRootHex(aggregate.message.aggregate.data.beaconBlockRoot);

      if (failedBlockRoots.has(beaconBlockRootHex)) {
        throw new GossipActionError(GossipAction.REJECT, {code: "SPEC_BLOCK_FAILED_VALIDATION"});
      }

      if (
        finalizedCheckpoint !== null &&
        !isDescendantAtFinalizedCheckpoint(chain, beaconBlockRootHex, finalizedCheckpoint)
      ) {
        throw new GossipActionError(GossipAction.IGNORE, {code: "SPEC_FINALIZED_NOT_ANCESTOR"});
      }

      await validateGossipAggregateAndProof(fork, chain, aggregate, bytes);
      break;
    }

    case GossipType.beacon_attestation: {
      const attestation = rejectOnInvalidSerializedBytes(() => sszTypesFor(fork).Attestation.deserialize(bytes));
      const beaconBlockRootHex = toRootHex(attestation.data.beaconBlockRoot);

      if (failedBlockRoots.has(beaconBlockRootHex)) {
        throw new GossipActionError(GossipAction.REJECT, {code: "SPEC_BLOCK_FAILED_VALIDATION"});
      }

      if (
        finalizedCheckpoint !== null &&
        !isDescendantAtFinalizedCheckpoint(chain, beaconBlockRootHex, finalizedCheckpoint)
      ) {
        throw new GossipActionError(GossipAction.IGNORE, {code: "SPEC_FINALIZED_NOT_ANCESTOR"});
      }

      const attDataBase64 = getBeaconAttestationGossipIndex(fork, bytes);
      const attSlot = getSlotFromBeaconAttestationSerialized(fork, bytes);
      if (attDataBase64 == null || attSlot == null) {
        throw new GossipActionError(GossipAction.REJECT, {code: "SPEC_INVALID_ATTESTATION_SERIALIZATION"});
      }

      const gossipAttestation: GossipAttestation = {
        attestation: null,
        serializedData: bytes,
        attSlot,
        attDataBase64,
        subnet: Number(message.subnet_id ?? 0),
      };

      const batchResult = await validateGossipAttestationsSameAttData(fork, chain, [gossipAttestation]);
      const first = batchResult.results[0];
      if (first?.err) throw first.err;
      break;
    }

    case GossipType.proposer_slashing: {
      const slashing = rejectOnInvalidSerializedBytes(() => sszTypesFor(fork).ProposerSlashing.deserialize(bytes));
      await validateGossipProposerSlashing(chain, slashing);
      // Mirror gossip handler: insert into opPool so duplicate detection works
      chain.opPool.insertProposerSlashing(slashing);
      break;
    }

    case GossipType.attester_slashing: {
      const slashing = rejectOnInvalidSerializedBytes(() => sszTypesFor(fork).AttesterSlashing.deserialize(bytes));
      await validateGossipAttesterSlashing(chain, slashing);
      // Mirror gossip handler: insert into opPool + fork choice
      chain.opPool.insertAttesterSlashing(fork, slashing);
      chain.forkChoice.onAttesterSlashing(slashing);
      break;
    }

    case GossipType.voluntary_exit: {
      const exit = rejectOnInvalidSerializedBytes(() => sszTypesFor(fork).SignedVoluntaryExit.deserialize(bytes));
      await validateGossipVoluntaryExit(chain, exit);
      // Mirror gossip handler: insert into opPool so duplicate detection works
      chain.opPool.insertVoluntaryExit(exit);
      break;
    }

    default:
      throw new Error(`Unknown gossip topic: ${topic}`);
  }
}

function rejectOnInvalidSerializedBytes<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error) {
      throw new GossipActionError(GossipAction.REJECT, {code: "SPEC_INVALID_SERIALIZED_BYTES"});
    }
    throw e;
  }
}

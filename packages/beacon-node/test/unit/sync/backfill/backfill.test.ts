import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  BUILDER_INDEX_SELF_BUILD,
  ForkName,
  ForkPostFulu,
  ForkPreGloas,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  getBlockProposerSignatureSet,
  getExecutionPayloadEnvelopeSigningRoot,
  interopSecretKey,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {ensureInteropPubkeyCache} from "@lodestar/state-transition/test-utils";
import {BeaconBlockBody, SignedBeaconBlock, Slot, fulu, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/index.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {decodeArchivedEnvelope} from "../../../../src/db/repositories/index.js";
import {INetwork, PeerAction} from "../../../../src/network/index.js";
import {PeerSyncMeta} from "../../../../src/network/peers/peersData.js";
import {BackfillSync, BackfillSyncModules} from "../../../../src/sync/backfill/index.js";
import {computePostFuluKzgCommitmentsInclusionProof} from "../../../../src/util/dataColumns.js";
import {toSignedHeaderEnvelope} from "../../../../src/util/headerEnvelope.js";
import {kzg} from "../../../../src/util/kzg.js";
import {generateRandomBlob} from "../../../utils/blocksAndData.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";

const VALIDATOR_COUNT = 16;
const GENESIS_VALIDATORS_ROOT = Buffer.alloc(32, 0xaa);
/** RLP encoding of an empty list */
const BLOCK_ACCESS_LIST = Uint8Array.of(0xc0);

type TestPeer = {
  blocks: SignedBeaconBlock[];
  earliestAvailableSlot?: Slot;
  custodyColumns?: number[];
  columnSidecars?: fulu.DataColumnSidecar[];
  envelopes?: gloas.SignedExecutionPayloadEnvelope[];
};

type TestNetwork = {[K in keyof BackfillSyncModules["network"]]: ReturnType<typeof vi.fn<INetwork[K]>>};

function getBeaconConfig(fork: ForkName, overrides?: {MIN_EPOCHS_FOR_BLOCK_REQUESTS: number}): BeaconConfig {
  return createBeaconConfig({...getConfig(fork), ...overrides}, GENESIS_VALIDATORS_ROOT);
}

function getBlockRoot(config: BeaconConfig, block: SignedBeaconBlock): Uint8Array {
  return config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
}

function signBlock(config: BeaconConfig, block: SignedBeaconBlock): void {
  const {signingRoot} = getBlockProposerSignatureSet(config, block);
  block.signature = interopSecretKey(block.message.proposerIndex).sign(signingRoot).toBytes();
}

/** Chain of validly signed blocks at `slots`, the block at slot 0 is the unsigned genesis block */
function buildChain(
  config: BeaconConfig,
  slots: Slot[],
  modify?: (block: SignedBeaconBlock, parent: SignedBeaconBlock | undefined) => void
): SignedBeaconBlock[] {
  const blocks: SignedBeaconBlock[] = [];
  for (const slot of slots) {
    const parent = blocks.at(-1);
    const block = config.getForkTypes(slot).SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = slot % VALIDATOR_COUNT;
    if (parent) block.message.parentRoot = getBlockRoot(config, parent);
    modify?.(block, parent);
    if (slot > 0) signBlock(config, block);
    blocks.push(block);
  }
  return blocks;
}

function range(start: Slot, end: Slot): Slot[] {
  return Array.from({length: end - start}, (_, i) => start + i);
}

function getNetwork(config: BeaconConfig, peers: Map<string, TestPeer>): TestNetwork {
  const getPeer = (peerId: string): TestPeer => {
    const peer = peers.get(peerId);
    if (!peer) throw Error(`Unknown peer ${peerId}`);
    return peer;
  };

  return {
    getConnectedPeers: vi.fn<INetwork["getConnectedPeers"]>(() => Array.from(peers.keys())),
    getConnectedPeerSyncMeta: vi.fn<INetwork["getConnectedPeerSyncMeta"]>((peerId): PeerSyncMeta => {
      const {custodyColumns = [], earliestAvailableSlot} = getPeer(peerId);
      return {peerId, client: "test", custodyColumns, earliestAvailableSlot};
    }),
    reportPeer: vi.fn<INetwork["reportPeer"]>(),
    sendBeaconBlocksByRange: vi.fn<INetwork["sendBeaconBlocksByRange"]>(async (peerId, {startSlot, count}) =>
      getPeer(peerId).blocks.filter(({message}) => message.slot >= startSlot && message.slot < startSlot + count)
    ),
    sendBeaconBlocksByRoot: vi.fn<INetwork["sendBeaconBlocksByRoot"]>(async (peerId, roots) =>
      getPeer(peerId).blocks.filter((block) =>
        roots.some((root) => Buffer.compare(root, getBlockRoot(config, block)) === 0)
      )
    ),
    sendDataColumnSidecarsByRange: vi.fn<INetwork["sendDataColumnSidecarsByRange"]>(
      async (peerId, {startSlot, count, columns}) =>
        (getPeer(peerId).columnSidecars ?? []).filter((sidecar) => {
          const {slot} = sidecar.signedBlockHeader.message;
          return slot >= startSlot && slot < startSlot + count && columns.includes(sidecar.index);
        })
    ),
    sendExecutionPayloadEnvelopesByRange: vi.fn<INetwork["sendExecutionPayloadEnvelopesByRange"]>(
      async (peerId, {startSlot, count}) =>
        (getPeer(peerId).envelopes ?? []).filter(({message}) => {
          const slot = message.payload.slotNumber;
          return slot >= startSlot && slot < startSlot + count;
        })
    ),
  };
}

describe("sync / BackfillSync", () => {
  const closeFns: (() => Promise<void>)[] = [];

  beforeAll(() => {
    ensureInteropPubkeyCache(VALIDATOR_COUNT);
  });

  afterEach(async () => {
    for (const close of closeFns.splice(0)) await close();
  });

  /**
   * Node checkpoint synced at `anchorSlot`: only the blocks above it are archived
   */
  async function setup({
    config,
    blocks,
    anchorSlot,
    peers,
    currentEpoch = 4,
    custodyColumns = [],
    isSynced = true,
    builders = [],
    elPayloadHashes,
  }: {
    config: BeaconConfig;
    blocks: SignedBeaconBlock[];
    anchorSlot: Slot;
    peers: Record<string, TestPeer>;
    currentEpoch?: number;
    custodyColumns?: number[];
    isSynced?: boolean;
    builders?: gloas.Builder[];
    /** Payloads the execution client has the body of, payloads are not deduplicated if not set */
    elPayloadHashes?: Set<string>;
  }): Promise<{
    backfill: BackfillSync;
    db: BeaconDb;
    chain: BackfillSyncModules["chain"];
    network: TestNetwork;
    restart: () => BackfillSync;
  }> {
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    closeFns.push(close);
    await db.blockArchive.batchPut(
      blocks.filter((block) => block.message.slot > anchorSlot).map((value) => ({key: value.message.slot, value}))
    );
    await db.earliestAvailableSlot.set(anchorSlot);

    const chain: BackfillSyncModules["chain"] = {
      bls: new BlsSingleThreadVerifier({metrics: null}),
      clock: {currentEpoch, currentSlot: currentEpoch * SLOTS_PER_EPOCH},
      custodyConfig: {custodyColumns, targetCustodyGroupCount: 4},
      earliestAvailableSlot: anchorSlot,
      executionEngine: {
        getPayloadBodiesByHashV2: async (blockHashes) =>
          blockHashes.map((blockHash) =>
            elPayloadHashes?.has(blockHash)
              ? {
                  transactions: ssz.bellatrix.Transactions.defaultValue(),
                  withdrawals: [],
                  blockAccessList: BLOCK_ACCESS_LIST,
                }
              : null
          ),
      },
      opts: {dedupePayloads: elPayloadHashes !== undefined},
      pubkeyCache,
    };
    const network = getNetwork(config, new Map(Object.entries(peers)));
    const modules: BackfillSyncModules = {
      config,
      chain,
      db,
      network,
      logger: testLogger(),
      metrics: null,
      isSynced: () => isSynced,
      getBuilder: (builderIndex) => builders[builderIndex] ?? null,
    };

    return {
      backfill: new BackfillSync(modules),
      db,
      chain,
      network,
      restart: () => new BackfillSync(modules),
    };
  }

  async function backfillAll(backfill: BackfillSync): Promise<number> {
    let batches = 0;
    while (await backfill.backfillBatch()) batches++;
    return batches;
  }

  async function expectArchived(db: BeaconDb, config: BeaconConfig, blocks: SignedBeaconBlock[]): Promise<void> {
    for (const block of blocks) {
      const slot = block.message.slot;
      const type = config.getForkTypes(slot).SignedBeaconBlock;
      const archived = await db.blockArchive.get(slot);
      expect(archived && type.equals(archived, block), `block at slot ${slot} not archived`).toBe(true);
      expect(await db.blockArchive.getSlotByRoot(getBlockRoot(config, block)), `root index of slot ${slot}`).toBe(slot);
      if (slot > 0) {
        expect(
          await db.blockArchive.getSlotByParentRoot(block.message.parentRoot),
          `parent root index of slot ${slot}`
        ).toBe(slot);
      }
    }
  }

  async function expectUnchanged(
    db: BeaconDb,
    chain: BackfillSyncModules["chain"],
    anchorSlot: Slot,
    archivedSlots: Slot[]
  ): Promise<void> {
    expect(chain.earliestAvailableSlot).toBe(anchorSlot);
    expect(await db.earliestAvailableSlot.get()).toBe(anchorSlot);
    expect(await db.blockArchive.keys()).toEqual(archivedSlots);
  }

  describe("blocks", () => {
    const config = getBeaconConfig(ForkName.electra);
    const anchorSlot = 3 * SLOTS_PER_EPOCH;
    // Skipped slots across an epoch boundary and at the anchor epoch start
    const slots = range(0, anchorSlot + 4).filter(
      (slot) => slot < SLOTS_PER_EPOCH - 2 || (slot > SLOTS_PER_EPOCH + 1 && slot !== 2 * SLOTS_PER_EPOCH)
    );
    const blocks = buildChain(config, slots);
    const archivedSlots = slots.filter((slot) => slot > anchorSlot);

    it("backfills from the anchor to genesis", async () => {
      const {backfill, db, chain, network} = await setup({config, blocks, anchorSlot, peers: {a: {blocks}}});

      expect(await backfillAll(backfill)).toBe(4);

      expect(chain.earliestAvailableSlot).toBe(0);
      expect(await db.earliestAvailableSlot.get()).toBe(0);
      await expectArchived(db, config, blocks);
      expect(network.sendBeaconBlocksByRange.mock.calls.map(([, request]) => request)).toEqual([
        // Each batch ends at the earliest stored block, the first includes the anchor block that checkpoint
        // sync does not store
        {startSlot: 2 * SLOTS_PER_EPOCH + 1, count: SLOTS_PER_EPOCH, step: 1},
        {startSlot: SLOTS_PER_EPOCH + 1, count: SLOTS_PER_EPOCH, step: 1},
        {startSlot: 2, count: SLOTS_PER_EPOCH, step: 1},
        {startSlot: 0, count: 2, step: 1},
      ]);
      expect(network.reportPeer).not.toHaveBeenCalled();
    });

    it("resumes from the persisted floor after a restart", async () => {
      const {backfill, db, chain, restart} = await setup({config, blocks, anchorSlot, peers: {a: {blocks}}});

      expect(await backfill.backfillBatch()).toBe(true);
      expect(await backfill.backfillBatch()).toBe(true);
      const floor = await db.earliestAvailableSlot.get();
      expect(floor).toBe(SLOTS_PER_EPOCH + 2);

      expect(await backfillAll(restart())).toBeGreaterThan(0);
      expect(chain.earliestAvailableSlot).toBe(0);
      await expectArchived(db, config, blocks);
    });

    it("finds the parent by root when a whole batch of slots is skipped", async () => {
      const sparseSlots = [0, 1, 2, anchorSlot - 1, anchorSlot, anchorSlot + 1];
      const sparseBlocks = buildChain(config, sparseSlots);
      const {backfill, db, chain, network} = await setup({
        config,
        blocks: sparseBlocks,
        anchorSlot,
        peers: {a: {blocks: sparseBlocks}},
      });

      await backfillAll(backfill);

      expect(chain.earliestAvailableSlot).toBe(0);
      await expectArchived(db, config, sparseBlocks);
      expect(network.sendBeaconBlocksByRoot).toHaveBeenCalledOnce();
      expect(network.sendBeaconBlocksByRoot.mock.calls[0][1]).toEqual([sparseBlocks[3].message.parentRoot]);
    });

    it("rejects validly signed blocks that do not link to the anchor", async () => {
      // Same slots and proposers, different roots
      const otherBlocks = buildChain(config, slots, (block) => {
        block.message.stateRoot = Buffer.alloc(32, 1);
      });
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        peers: {a: {blocks: otherBlocks}},
      });

      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, archivedSlots);
      const otherAnchorBlock = otherBlocks.find((block) => block.message.slot === anchorSlot);
      expect(otherAnchorBlock).toBeDefined();
      if (otherAnchorBlock) {
        expect(await db.blockArchive.getSlotByRoot(getBlockRoot(config, otherAnchorBlock))).toBeNull();
      }
      expect(network.reportPeer).toHaveBeenCalledWith("a", PeerAction.LowToleranceError, expect.any(String));
    });

    it("rejects a validly signed block returned for a different root", async () => {
      const sparseBlocks = buildChain(config, [0, 1, 2, anchorSlot + 1]);
      const otherBlock = buildChain(config, [2], (block) => {
        block.message.stateRoot = Buffer.alloc(32, 1);
      });
      const {backfill, db, chain, network} = await setup({
        config,
        blocks: sparseBlocks,
        anchorSlot,
        peers: {a: {blocks: []}},
      });
      network.sendBeaconBlocksByRoot.mockResolvedValue(otherBlock);

      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, [anchorSlot + 1]);
      expect(network.reportPeer).toHaveBeenCalledWith("a", PeerAction.LowToleranceError, expect.any(String));
    });

    it("rejects blocks with the expected root and an invalid proposer signature", async () => {
      const type = ssz.electra.SignedBeaconBlock;
      const badSignatureBlocks = blocks.map((block) => {
        const clone = type.clone(block as SignedBeaconBlock<ForkName.electra>);
        // A valid signature of another message
        if (clone.message.slot === anchorSlot) clone.signature = blocks[1].signature;
        return clone;
      });
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        peers: {a: {blocks: badSignatureBlocks}},
      });

      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, archivedSlots);
      expect(network.reportPeer).toHaveBeenCalledWith("a", PeerAction.LowToleranceError, expect.any(String));
    });

    it("does not accept a response ending short of the parent", async () => {
      const truncated = blocks.filter((block) => block.message.slot < anchorSlot);
      const {backfill, db, chain, network} = await setup({config, blocks, anchorSlot, peers: {a: {blocks: truncated}}});

      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, archivedSlots);
      expect(network.reportPeer).toHaveBeenCalledWith("a", PeerAction.LowToleranceError, expect.any(String));
    });

    it("does not penalize or immediately retry a peer that has no blocks", async () => {
      const {backfill, db, chain, network} = await setup({config, blocks, anchorSlot, peers: {a: {blocks: []}}});

      expect(await backfill.backfillBatch()).toBe(false);
      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, archivedSlots);
      expect(network.sendBeaconBlocksByRange).toHaveBeenCalledOnce();
      expect(network.reportPeer).not.toHaveBeenCalled();
    });

    it("only requests from peers advertising the range", async () => {
      const {backfill, network} = await setup({
        config,
        blocks,
        anchorSlot,
        peers: {a: {blocks, earliestAvailableSlot: anchorSlot + 1}},
      });

      expect(await backfill.backfillBatch()).toBe(false);
      expect(network.sendBeaconBlocksByRange).not.toHaveBeenCalled();
    });

    it("waits until the node is synced", async () => {
      const {backfill, network} = await setup({config, blocks, anchorSlot, peers: {a: {blocks}}, isSynced: false});

      expect(await backfill.backfillBatch()).toBe(false);
      expect(network.getConnectedPeers).not.toHaveBeenCalled();
    });

    it("stops at the start of the range blocks must be served for", async () => {
      const shortConfig = getBeaconConfig(ForkName.electra, {MIN_EPOCHS_FOR_BLOCK_REQUESTS: 2});
      const allBlocks = buildChain(shortConfig, range(0, anchorSlot + 2));
      const targetSlot = SLOTS_PER_EPOCH;
      const {backfill, db, chain, network} = await setup({
        config: shortConfig,
        blocks: allBlocks,
        anchorSlot,
        peers: {a: {blocks: allBlocks}},
        currentEpoch: 3,
      });

      await backfillAll(backfill);

      expect(chain.earliestAvailableSlot).toBe(targetSlot);
      expect(await db.earliestAvailableSlot.get()).toBe(targetSlot);
      expect(await db.blockArchive.get(targetSlot - 1)).toBeNull();
      const requestedSlots = network.sendBeaconBlocksByRange.mock.calls.map(([, {startSlot}]) => startSlot);
      expect(Math.min(...requestedSlots)).toBe(targetSlot);
    });
  });

  describe("data column sidecars", () => {
    const config = getBeaconConfig(ForkName.fulu);
    const anchorSlot = 4;
    const custodyColumns = [1, 5, 9];
    const blockSlotsWithBlobs = [2, 3];
    const cellsAndProofsBySlot = new Map<Slot, ReturnType<typeof kzg.computeCellsAndKzgProofs>>();
    let blocks: SignedBeaconBlock[];
    let columnSidecars: fulu.DataColumnSidecar[];

    beforeAll(() => {
      blocks = buildChain(config, range(0, anchorSlot + 2), (block) => {
        if (!blockSlotsWithBlobs.includes(block.message.slot)) return;
        const blob = generateRandomBlob();
        const body = block.message.body as BeaconBlockBody<ForkPostFulu & ForkPreGloas>;
        body.blobKzgCommitments = [kzg.blobToKzgCommitment(blob)];
        cellsAndProofsBySlot.set(block.message.slot, kzg.computeCellsAndKzgProofs(blob));
      });

      columnSidecars = [];
      for (const block of blocks) {
        const cellsAndProofs = cellsAndProofsBySlot.get(block.message.slot);
        if (!cellsAndProofs) continue;
        const body = block.message.body as BeaconBlockBody<ForkPostFulu & ForkPreGloas>;
        for (let index = 0; index < NUMBER_OF_COLUMNS; index++) {
          columnSidecars.push({
            index,
            column: [cellsAndProofs.cells[index]],
            kzgCommitments: body.blobKzgCommitments,
            kzgProofs: [cellsAndProofs.proofs[index]],
            signedBlockHeader: signedBlockToSignedHeader(config, block),
            kzgCommitmentsInclusionProof: computePostFuluKzgCommitmentsInclusionProof(ForkName.fulu, body),
          });
        }
      }
    });

    it("collects custody columns from several peers before archiving the batch", async () => {
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        custodyColumns,
        peers: {
          a: {blocks, columnSidecars, custodyColumns: [1, 5], earliestAvailableSlot: 0},
          b: {blocks: [], columnSidecars, custodyColumns: [9], earliestAvailableSlot: 0},
        },
      });

      await backfillAll(backfill);

      expect(chain.earliestAvailableSlot).toBe(0);
      await expectArchived(db, config, blocks);
      for (const block of blocks) {
        const slot = block.message.slot;
        const stored = await db.dataColumns.getManyBinary(
          {slot, blockRoot: toRootHex(getBlockRoot(config, block))},
          custodyColumns
        );
        expect(
          stored.map((sidecar) => sidecar !== undefined),
          `custody columns of slot ${slot}`
        ).toEqual(custodyColumns.map(() => blockSlotsWithBlobs.includes(slot)));
      }
      expect(network.reportPeer).not.toHaveBeenCalled();
    });

    it("does not archive blocks whose custody columns are unavailable", async () => {
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        custodyColumns,
        peers: {a: {blocks, columnSidecars, custodyColumns: [1, 5], earliestAvailableSlot: 0}},
      });

      expect(await backfill.backfillBatch()).toBe(false);
      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, [anchorSlot + 1]);
      expect(network.reportPeer).not.toHaveBeenCalled();
      // The peer served valid blocks, it is asked again once more columns may be available
      expect(network.sendBeaconBlocksByRange).toHaveBeenCalledTimes(2);
    });

    it("rejects sidecars whose header signature differs from the block", async () => {
      const badSidecars = columnSidecars.map((sidecar) => ({
        ...sidecar,
        signedBlockHeader: {...sidecar.signedBlockHeader, signature: blocks[1].signature},
      }));
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        custodyColumns,
        peers: {a: {blocks, columnSidecars: badSidecars, custodyColumns, earliestAvailableSlot: 0}},
      });

      expect(await backfill.backfillBatch()).toBe(false);

      await expectUnchanged(db, chain, anchorSlot, [anchorSlot + 1]);
      expect(network.reportPeer).toHaveBeenCalledWith("a", PeerAction.LowToleranceError, expect.any(String));
    });
  });

  describe("execution payload envelopes", () => {
    const config = getBeaconConfig(ForkName.gloas);
    const firstSlot = SLOTS_PER_EPOCH + 1;
    const anchorSlot = firstSlot + 5;
    // The payload of this slot is not built upon
    const emptySlot = firstSlot + 2;
    const originalBuilderSlot = firstSlot + 3;
    const reusedBuilderSlot = firstSlot + 4;
    const fullSlots = range(firstSlot, anchorSlot + 1).filter((slot) => slot !== emptySlot);

    const originalBuilderIndex = 0;
    const reusedBuilderIndex = 1;
    const builderSecretKey = interopSecretKey(VALIDATOR_COUNT);
    const builder = (depositEpoch: number): gloas.Builder => ({
      ...ssz.gloas.Builder.defaultValue(),
      pubkey: builderSecretKey.toPublicKey().toBytes(),
      depositEpoch,
    });
    // The second builder got its index in the epoch of the envelopes, an earlier builder may have signed them
    const builders = [builder(0), builder(1)];
    const getBuilderIndex = (slot: Slot): number =>
      slot === originalBuilderSlot
        ? originalBuilderIndex
        : slot === reusedBuilderSlot
          ? reusedBuilderIndex
          : BUILDER_INDEX_SELF_BUILD;

    const blockHash = (slot: Slot): Uint8Array => Buffer.alloc(32, slot + 1);
    const setBid = (block: SignedBeaconBlock, parent: SignedBeaconBlock | undefined): void => {
      const bid = (block as gloas.SignedBeaconBlock).message.body.signedExecutionPayloadBid.message;
      const slot = block.message.slot;
      bid.blockHash = blockHash(slot);
      bid.builderIndex = getBuilderIndex(slot);
      bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue());
      if (parent) {
        bid.parentBlockHash =
          parent.message.slot === emptySlot ? blockHash(emptySlot - 1) : blockHash(parent.message.slot);
      }
    };
    const blocks = buildChain(config, [0, ...range(firstSlot, anchorSlot + 2)], setBid);

    function signEnvelope(envelope: gloas.SignedExecutionPayloadEnvelope, proposerIndex: number): void {
      const secretKey =
        envelope.message.builderIndex === BUILDER_INDEX_SELF_BUILD ? interopSecretKey(proposerIndex) : builderSecretKey;
      envelope.signature = secretKey.sign(getExecutionPayloadEnvelopeSigningRoot(config, envelope.message)).toBytes();
    }

    function getEnvelopes(
      modify?: (envelope: gloas.SignedExecutionPayloadEnvelope) => void,
      chain = blocks,
      slots = fullSlots
    ): gloas.SignedExecutionPayloadEnvelope[] {
      return chain
        .filter((block) => slots.includes(block.message.slot))
        .map((block) => {
          const {slot, proposerIndex, parentRoot, body} = (block as gloas.SignedBeaconBlock).message;
          const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
          envelope.message.beaconBlockRoot = getBlockRoot(config, block);
          envelope.message.parentBeaconBlockRoot = parentRoot;
          envelope.message.builderIndex = getBuilderIndex(slot);
          envelope.message.payload.slotNumber = slot;
          envelope.message.payload.blockHash = blockHash(slot);
          envelope.message.payload.parentHash = body.signedExecutionPayloadBid.message.parentBlockHash;
          signEnvelope(envelope, proposerIndex);
          // Signed by whoever held the index before
          if (slot === reusedBuilderSlot) envelope.signature = Buffer.alloc(96, 1);
          modify?.(envelope);
          return envelope;
        });
    }

    it("archives the envelopes of canonical payloads", async () => {
      const envelopes = getEnvelopes();
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        builders,
        peers: {a: {blocks, envelopes, earliestAvailableSlot: 0}},
      });

      await backfillAll(backfill);

      expect(chain.earliestAvailableSlot).toBe(0);
      await expectArchived(db, config, blocks);
      expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual(fullSlots);
      for (const envelope of envelopes) {
        const slot = envelope.message.payload.slotNumber;
        // Including the envelope of the reused builder index, stored as received
        expect(await db.executionPayloadEnvelopeArchive.getBinary(slot), `envelope of slot ${slot}`).toEqual(
          Buffer.from(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope))
        );
      }
      expect(network.reportPeer).not.toHaveBeenCalled();
    });

    it("does not archive blocks whose canonical payload envelope is unavailable", async () => {
      const envelopes = getEnvelopes().filter((envelope) => envelope.message.payload.slotNumber !== firstSlot + 1);
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        builders,
        peers: {a: {blocks, envelopes, earliestAvailableSlot: 0}},
      });

      await backfillAll(backfill);

      await expectUnchanged(db, chain, anchorSlot, [anchorSlot + 1]);
      expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual([]);
      expect(network.reportPeer).not.toHaveBeenCalled();
    });

    it("requests the envelope of a block found by root from a peer advertising its slot", async () => {
      const sparseAnchorSlot = 3 * SLOTS_PER_EPOCH;
      const sparseSlots = [0, 2, sparseAnchorSlot, sparseAnchorSlot + 1];
      const sparseBlocks = buildChain(config, sparseSlots, setBid);
      const envelopes = getEnvelopes(undefined, sparseBlocks, [2, sparseAnchorSlot]);
      const {backfill, chain, network} = await setup({
        config,
        blocks: sparseBlocks,
        anchorSlot: sparseAnchorSlot,
        peers: {
          a: {blocks: sparseBlocks, envelopes, earliestAvailableSlot: sparseAnchorSlot - 1},
          b: {blocks: sparseBlocks, envelopes, earliestAvailableSlot: 0},
        },
      });

      await backfillAll(backfill);

      expect(chain.earliestAvailableSlot).toBe(0);
      expect(network.sendBeaconBlocksByRoot).toHaveBeenCalledOnce();
      const envelopePeers = network.sendExecutionPayloadEnvelopesByRange.mock.calls
        .filter(([, {startSlot}]) => startSlot === 2)
        .map(([peerId]) => peerId);
      expect(envelopePeers).toEqual(["b"]);
      expect(network.reportPeer).not.toHaveBeenCalled();
    });

    it("archives only the header of envelopes whose payload body the execution client has", async () => {
      const envelopes = getEnvelopes((envelope) => {
        envelope.message.payload.blockAccessList = BLOCK_ACCESS_LIST;
        signEnvelope(envelope, envelope.message.payload.slotNumber % VALIDATOR_COUNT);
      });
      const elPayloadHashes = new Set(fullSlots.slice(1).map((slot) => toRootHex(blockHash(slot))));
      const {backfill, db} = await setup({
        config,
        blocks,
        anchorSlot,
        builders,
        elPayloadHashes,
        peers: {a: {blocks, envelopes, earliestAvailableSlot: 0}},
      });

      await backfillAll(backfill);

      expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual(fullSlots);
      for (const envelope of envelopes) {
        const slot = envelope.message.payload.slotNumber;
        const archivedBytes = await db.executionPayloadEnvelopeArchive.getBinary(slot);
        if (archivedBytes === null) throw Error(`envelope of slot ${slot} not archived`);
        const archived = decodeArchivedEnvelope(archivedBytes);
        if (slot === fullSlots[0]) {
          expect(archived.envelopeBytes, `full envelope of slot ${slot}`).toEqual(
            Buffer.from(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope))
          );
        } else {
          const type = ssz.gloas.SignedExecutionPayloadHeaderEnvelope;
          expect(
            archived.headerEnvelope && type.equals(archived.headerEnvelope, toSignedHeaderEnvelope(envelope)),
            `header envelope of slot ${slot}`
          ).toBe(true);
        }
      }
    });

    const invalidEnvelopes: {
      id: string;
      slot: Slot;
      modify: (envelope: gloas.SignedExecutionPayloadEnvelope) => void;
      invalidSignature?: boolean;
    }[] = [
      {
        id: "block hash differs from the bid",
        slot: firstSlot,
        modify: (envelope) => {
          envelope.message.payload.blockHash = Buffer.alloc(32, 0xff);
        },
      },
      {
        id: "prev randao differs from the bid",
        slot: firstSlot,
        modify: (envelope) => {
          envelope.message.payload.prevRandao = Buffer.alloc(32, 0xff);
        },
      },
      {
        id: "builder index differs from the bid",
        slot: firstSlot,
        modify: (envelope) => {
          envelope.message.builderIndex = originalBuilderIndex;
        },
      },
      {
        id: "parent hash differs from the bid",
        slot: firstSlot,
        modify: (envelope) => {
          envelope.message.payload.parentHash = Buffer.alloc(32, 0xff);
        },
      },
      {
        id: "self build signature is invalid",
        slot: firstSlot,
        invalidSignature: true,
        modify: (envelope) => {
          envelope.signature = builderSecretKey.sign(envelope.message.beaconBlockRoot).toBytes();
        },
      },
      {
        id: "signature of a builder registered before the envelope is invalid",
        slot: originalBuilderSlot,
        invalidSignature: true,
        modify: (envelope) => {
          envelope.signature = builderSecretKey.sign(envelope.message.beaconBlockRoot).toBytes();
        },
      },
    ];

    it.each(invalidEnvelopes)("rejects an envelope whose $id", async ({slot, modify, invalidSignature}) => {
      const envelopes = getEnvelopes((envelope) => {
        if (envelope.message.payload.slotNumber !== slot) return;
        modify(envelope);
        // Only the modified field must be at fault
        if (!invalidSignature) signEnvelope(envelope, slot % VALIDATOR_COUNT);
      });
      const {backfill, db, chain, network} = await setup({
        config,
        blocks,
        anchorSlot,
        builders,
        peers: {a: {blocks, envelopes, earliestAvailableSlot: 0}},
      });

      await backfillAll(backfill);

      await expectUnchanged(db, chain, anchorSlot, [anchorSlot + 1]);
      expect(await db.executionPayloadEnvelopeArchive.keys()).toEqual([]);
      expect(network.reportPeer).toHaveBeenCalledWith("a", PeerAction.LowToleranceError, expect.any(String));
    });
  });
});

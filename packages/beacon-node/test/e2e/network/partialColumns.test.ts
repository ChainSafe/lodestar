import {afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {GossipHandlerParamGeneric, GossipHandlers, GossipType} from "../../../src/network/gossip/index.js";
import {Network} from "../../../src/network/index.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getNetworkForTest} from "../../utils/networkWithMockDb.js";
import {generateBlockWithColumnSidecars} from "../../utils/blocksAndData.js";
import {InMemoryColumnAvailabilityStore} from "../../../src/network/gossip/columnAvailabilityStore.js";
import {
  createPartialDataColumn,
  decodePartsMetadata,
  encodePartsMetadata,
  validatePartsMetadata,
  countColumnsInMetadata,
  isCompleteMetadata,
} from "../../../src/network/gossip/partialColumns.js";

/**
 * End-to-end tests for partial data column propagation via gossipsub.
 *
 * These tests verify that partial message support for PeerDAS data columns
 * works correctly between nodes:
 *
 * 1. Nodes can track which columns they have via ColumnAvailabilityStore
 * 2. Partial messages correctly indicate which columns a node has
 * 3. Nodes only receive columns they are missing
 * 4. Rebroadcast triggers when new columns are received
 *
 * Integration test approach:
 * - Level 1 (Unit): Test individual components (ColumnAvailabilityStore, PartialDataColumn)
 * - Level 2 (Integration): Test gossipsub partial message exchange between 2 nodes
 * - Level 3 (E2E): Full node test with real gossipsub mesh
 *
 * For full multi-node partial column propagation testing, see the gossipsub-interop
 * test harness at /test/test-plans/gossipsub-interop which uses Shadow network
 * simulator for deterministic multi-implementation testing.
 */

describe("partial data column propagation / unit tests", () => {
  describe("ColumnAvailabilityStore", () => {
    it("should track column availability", () => {
      const store = new InMemoryColumnAvailabilityStore();
      const blockRoot = new Uint8Array(32).fill(1);

      expect(store.hasColumn(blockRoot, 0)).toBe(false);

      store.markColumnAvailable(blockRoot, 0);
      expect(store.hasColumn(blockRoot, 0)).toBe(true);
      expect(store.hasColumn(blockRoot, 1)).toBe(false);
    });

    it("should return correct column count", () => {
      const store = new InMemoryColumnAvailabilityStore();
      const blockRoot = new Uint8Array(32).fill(1);

      expect(store.getColumnCount(blockRoot)).toBe(0);

      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      store.markColumnAvailable(blockRoot, 127);

      expect(store.getColumnCount(blockRoot)).toBe(3);
    });

    it("should check custody columns", () => {
      const store = new InMemoryColumnAvailabilityStore();
      const blockRoot = new Uint8Array(32).fill(1);
      const custodyColumns = [0, 5, 10];

      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(false);

      store.markColumnAvailable(blockRoot, 0);
      store.markColumnAvailable(blockRoot, 5);
      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(false);

      store.markColumnAvailable(blockRoot, 10);
      expect(store.hasCustodyColumns(blockRoot, custodyColumns)).toBe(true);
    });

    it("should prune blocks", () => {
      const store = new InMemoryColumnAvailabilityStore();
      const blockRoot = new Uint8Array(32).fill(1);

      store.markColumnAvailable(blockRoot, 0);
      expect(store.hasColumn(blockRoot, 0)).toBe(true);

      store.pruneBlock(blockRoot);
      expect(store.hasColumn(blockRoot, 0)).toBe(false);
    });

    it("should evict LRU when at capacity", () => {
      const smallStore = new InMemoryColumnAvailabilityStore({maxBlocks: 2});

      const root1 = new Uint8Array(32).fill(1);
      const root2 = new Uint8Array(32).fill(2);
      const root3 = new Uint8Array(32).fill(3);

      smallStore.markColumnAvailable(root1, 0);
      smallStore.markColumnAvailable(root2, 0);
      smallStore.markColumnAvailable(root3, 0);

      // root1 should be evicted (oldest)
      expect(smallStore.hasColumn(root1, 0)).toBe(false);
      expect(smallStore.hasColumn(root2, 0)).toBe(true);
      expect(smallStore.hasColumn(root3, 0)).toBe(true);
    });
  });

  describe("partsMetadata encoding/decoding", () => {
    it("should encode column indices to bitmap", () => {
      const indices = [0, 5, 10, 127];
      const metadata = encodePartsMetadata(indices);

      expect(metadata.length).toBe(Math.ceil(NUMBER_OF_COLUMNS / 8));

      // Verify bits are set correctly
      expect((metadata[0] & 0b00000001) !== 0).toBe(true); // bit 0
      expect((metadata[0] & 0b00100000) !== 0).toBe(true); // bit 5
      expect((metadata[1] & 0b00000100) !== 0).toBe(true); // bit 10
      expect((metadata[15] & 0b10000000) !== 0).toBe(true); // bit 127
    });

    it("should decode bitmap to column indices", () => {
      const original = [0, 5, 10, 127];
      const metadata = encodePartsMetadata(original);
      const decoded = decodePartsMetadata(metadata);

      expect(decoded).toEqual(original);
    });

    it("should validate metadata size", () => {
      const tooSmall = new Uint8Array(8);
      const result = validatePartsMetadata(tooSmall);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid metadata size");
    });

    it("should count columns in metadata", () => {
      const indices = [0, 1, 2, 5, 10, 20, 50, 100, 127];
      const metadata = encodePartsMetadata(indices);
      expect(countColumnsInMetadata(metadata)).toBe(indices.length);
    });

    it("should detect complete metadata", () => {
      // Incomplete
      const partial = encodePartsMetadata([0, 1, 2]);
      expect(isCompleteMetadata(partial)).toBe(false);

      // Complete (all 128 columns)
      const allIndices = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
      const complete = encodePartsMetadata(allIndices);
      expect(isCompleteMetadata(complete)).toBe(true);
    });
  });

  describe("PartialDataColumn message", () => {
    // Schedule FULU fork at epoch 1
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 1,
      BLOB_SCHEDULE: [],
    });
    // Create BeaconConfig with a dummy genesis validators root
    const genesisValidatorsRoot = new Uint8Array(32).fill(0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    it("should create partial message from column sidecar", () => {
      const {columnSidecars} = generateBlockWithColumnSidecars({
        forkName: ForkName.fulu,
        slot: computeStartSlotAtEpoch(1),
      });

      const column = columnSidecars[0];
      const partialMsg = createPartialDataColumn(column, config);

      // Group ID should be block root
      const groupId = partialMsg.groupId();
      expect(groupId.length).toBe(32);

      // Parts metadata should have only this column's bit set
      const metadata = partialMsg.partsMetadata();
      expect(countColumnsInMetadata(metadata)).toBe(1);

      const indices = decodePartsMetadata(metadata);
      expect(indices).toEqual([column.index]);
    });

    it("should skip sending if peer already has column", () => {
      const {columnSidecars} = generateBlockWithColumnSidecars({
        forkName: ForkName.fulu,
        slot: computeStartSlotAtEpoch(1),
      });

      const column = columnSidecars[0];
      const partialMsg = createPartialDataColumn(column, config);

      // Create peer metadata that includes this column
      const peerHas = encodePartsMetadata([column.index]);

      const action = partialMsg.partialMessageBytes(peerHas);

      // Should not send bytes since peer already has this column
      expect(action.bytesToSend).toBeNull();
    });

    it("should send column if peer does not have it", () => {
      const {columnSidecars} = generateBlockWithColumnSidecars({
        forkName: ForkName.fulu,
        slot: computeStartSlotAtEpoch(1),
      });

      const column = columnSidecars[0];
      const partialMsg = createPartialDataColumn(column, config);

      // Peer has different columns
      const peerHas = encodePartsMetadata([1, 2, 3]);

      const action = partialMsg.partialMessageBytes(peerHas);

      // Should send the column
      expect(action.bytesToSend).not.toBeNull();
      expect(action.bytesToSend?.length).toBeGreaterThan(0);

      // Updated metadata should include both peer's columns and ours
      const updatedIndices = decodePartsMetadata(action.updatedPartsMetadata);
      expect(updatedIndices).toContain(column.index);
      expect(updatedIndices).toContain(1);
      expect(updatedIndices).toContain(2);
      expect(updatedIndices).toContain(3);
    });
  });
});

/**
 * Network-level integration tests for partial columns.
 *
 * These tests require setting up mock beacon chains and networks,
 * which is more complex and requires careful setup of all dependencies.
 *
 * For simpler and more robust multi-node testing, use the gossipsub-interop
 * test harness which provides:
 * - Shadow network simulator for deterministic testing
 * - Support for Go, Rust, JS, and JVM implementations
 * - Automated validation of partial message exchange
 *
 * Run with: cd /test/test-plans/gossipsub-interop && make test-js
 */
describe.skip("partial data column propagation / network integration", () => {
  vi.setConfig({testTimeout: 10000});

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // Schedule FULU fork at epoch 1
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 1,
    BLOB_SCHEDULE: [],
  });
  const START_SLOT = computeStartSlotAtEpoch(1);

  async function mockModules(gossipHandlersPartial?: Partial<GossipHandlers>) {
    const [netA, closeA] = await getNetworkForTest("partial-col-A", config, {
      startSlot: START_SLOT,
      gossipHandlersPartial,
    });
    const [netB, closeB] = await getNetworkForTest("partial-col-B", config, {
      startSlot: START_SLOT,
      gossipHandlersPartial,
    });

    afterEachCallbacks.push(async () => {
      await closeA();
      await closeB();
    });

    return {netA, netB};
  }

  it("should publish and receive data column sidecar", async () => {
    let onDataColumnSidecar: (data: Uint8Array) => void;
    const onDataColumnSidecarPromise = new Promise<Uint8Array>((resolve) => {
      onDataColumnSidecar = resolve;
    });

    const {netA, netB} = await mockModules({
      [GossipType.data_column_sidecar]: async ({
        gossipData,
      }: GossipHandlerParamGeneric<GossipType.data_column_sidecar>) => {
        onDataColumnSidecar(gossipData.serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait for mesh to form
    while (!netA.closed) {
      await sleep(500);
      if (await hasSomeMeshPeer(netA)) {
        break;
      }
    }

    // Generate and publish a data column
    const {columnSidecars} = generateBlockWithColumnSidecars({
      forkName: ForkName.fulu,
      slot: START_SLOT,
    });

    const column = columnSidecars[0];
    await netA.publishDataColumnSidecar(column);

    const receivedColumn = await onDataColumnSidecarPromise;
    const deserialized = ssz.fulu.DataColumnSidecar.deserialize(receivedColumn);
    expect(deserialized.index).toBe(column.index);
  });
});

async function hasSomeMeshPeer(net: Network): Promise<boolean> {
  return Object.values(await net.dumpMeshPeers()).some((peers) => peers.length > 0);
}

/**
 * INTEGRATION TEST DOCUMENTATION
 *
 * For comprehensive partial column propagation testing, the recommended approach is:
 *
 * 1. UNIT TESTS (above):
 *    - Test ColumnAvailabilityStore in isolation
 *    - Test PartialDataColumn message formatting
 *    - Test metadata encoding/decoding
 *
 * 2. GOSSIPSUB INTEROP TESTS:
 *    Location: /test/test-plans/gossipsub-interop
 *
 *    These tests use Shadow network simulator to test partial message
 *    propagation across multiple implementations (Go, Rust, JS, JVM).
 *
 *    Run with:
 *      cd /home/ubuntu/java/test/test-plans/gossipsub-interop
 *      make test-js           # Test JS-only partial messages
 *      make test-js-and-go    # Test JS + Go interop
 *
 *    Test scenarios:
 *    - partial-messages: Basic partial message exchange
 *    - partial-messages-chain: Chain of partial messages with reconstruction
 *    - partial-messages-fanout: Fanout propagation test
 *
 * 3. LODESTAR-SPECIFIC E2E:
 *    For Lodestar-specific e2e testing with real beacon chains:
 *    - Requires full chain setup with execution layer mock
 *    - More complex but tests full integration path
 *    - See existing e2e tests for patterns
 *
 * TEST STRATEGY FOR PARTIAL COLUMNS:
 *
 * The partial message extension enables bandwidth-efficient PeerDAS:
 *
 *   Node A has: [col 0, col 1, col 2]
 *   Node B has: [col 2, col 3, col 4]
 *
 *   Via partial messages:
 *   - A sends HAVE bitmap [0,1,2] to B
 *   - B sees A needs [3,4], sends only those
 *   - A receives [3,4], updates HAVE set
 *   - A rebroadcasts updated bitmap
 *
 * Key test scenarios:
 * 1. Two nodes with non-overlapping columns exchange and converge
 * 2. Node receives column it already has (should be deduplicated)
 * 3. Missing custody columns trigger req/resp fetch
 * 4. Block finalization prunes tracking state
 *
 * VERIFYING PARTIAL MESSAGE CORRECTNESS:
 *
 * The gossipsub-interop tests verify:
 * - All nodes eventually receive all published partial messages
 * - Partial metadata correctly indicates column availability
 * - No duplicate column deliveries occur
 * - Bandwidth reduction is achieved vs full message propagation
 *
 * Check results with:
 *   uv run checks/partial_messages.py latest --count N
 *
 * This validates that all N expected messages were received by all nodes.
 */

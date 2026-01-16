import {type PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Root, fulu} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {ColumnAvailabilityStore} from "./columnAvailability.js";
import {InMemoryColumnAvailabilityStore} from "./columnAvailabilityStore.js";
import {GossipType} from "./interface.js";
import {PartialColumnBroadcaster, PartialColumnMetrics} from "./partialColumns.js";
import {stringifyGossipTopic} from "./topic.js";
import {NetworkConfig} from "../networkConfig.js";

/**
 * Options for PartialColumnNetwork integration.
 */
export interface PartialColumnNetworkOpts {
  /** Enable partial message support for data columns */
  enabled: boolean;
  /** Columns this node is responsible for (custody columns) */
  custodyColumns: number[];
  /** Maximum number of blocks to track (default: 64) */
  maxBlocks?: number;
  /** TTL for block state in ms (default: 384000 = 32 slots * 12s) */
  blockTTL?: number;
}

/**
 * Interface for req/resp operations needed by PartialColumnNetwork.
 * This allows for dependency injection and testability.
 */
export interface PartialColumnReqResp {
  /**
   * Fetch data column sidecars by root.
   * @param peerId - Peer to request from
   * @param requests - Array of {blockRoot, columns} to request
   * @returns Array of fetched DataColumnSidecars
   */
  sendDataColumnSidecarsByRoot(
    peerId: string,
    requests: Array<{blockRoot: Root; columns: number[]}>
  ): Promise<fulu.DataColumnSidecar[]>;
}

/**
 * Interface for gossipsub operations needed by PartialColumnNetwork.
 */
export interface PartialColumnGossip {
  /**
   * Subscribe to a gossip topic.
   */
  subscribe(topic: string): void;
}

/**
 * Integrates partial column broadcasting with the network layer.
 *
 * This class serves as the main integration point between:
 * - PartialColumnBroadcaster (handles partial message protocol)
 * - ColumnAvailabilityStore (tracks which columns we have)
 * - ReqResp (fetches missing columns from peers)
 * - Gossipsub (subscribes to data column topics)
 *
 * Flow:
 * 1. When a full column is received via gossip, call onGossipColumn()
 * 2. The broadcaster tracks our HAVE set and exchanges with peers
 * 3. When missing custody columns are detected, fetch via req/resp
 * 4. When a block is finalized, call onFinalized() to clean up state
 */
export class PartialColumnNetwork {
  private readonly broadcaster: PartialColumnBroadcaster;
  private readonly columnStore: ColumnAvailabilityStore;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;

  private reqResp: PartialColumnReqResp | null = null;
  private gossip: PartialColumnGossip | null = null;

  constructor(
    config: BeaconConfig,
    networkConfig: NetworkConfig,
    logger: Logger,
    metrics: PartialColumnMetrics | null,
    opts: PartialColumnNetworkOpts
  ) {
    this.config = config;
    this.logger = logger;

    // Create column store with optional custom limits
    this.columnStore = new InMemoryColumnAvailabilityStore({
      maxBlocks: opts.maxBlocks,
      blockTTL: opts.blockTTL,
    });

    // Create broadcaster with column store and custody columns
    this.broadcaster = new PartialColumnBroadcaster(
      config,
      networkConfig,
      logger,
      this.columnStore,
      opts.custodyColumns,
      metrics
    );

    // Wire up req/resp callback for fetching missing columns
    this.broadcaster.setNeedColumnsCallback(this.onNeedColumns.bind(this));
  }

  /**
   * Set the req/resp interface for fetching missing columns.
   * Must be called before the network can fetch missing columns.
   */
  setReqResp(reqResp: PartialColumnReqResp): void {
    this.reqResp = reqResp;
  }

  /**
   * Set the gossipsub interface for subscribing to topics.
   * Must be called before subscribePartialColumns().
   */
  setGossip(gossip: PartialColumnGossip): void {
    this.gossip = gossip;
  }

  /**
   * Get the partial message extension for gossipsub configuration.
   * Pass this to Eth2GossipsubOpts.partialMessageExtension.
   */
  getExtension(): PartialColumnBroadcaster {
    return this.broadcaster;
  }

  /**
   * Get the column availability store for external access.
   */
  getColumnStore(): ColumnAvailabilityStore {
    return this.columnStore;
  }

  /**
   * Subscribe to data column topics with partial message support.
   *
   * Iterates through all data column subnets and subscribes to each topic.
   * Should be called when transitioning to a fork that supports data columns.
   *
   * @param fork - The fork name to use for topic generation
   */
  subscribePartialColumns(fork: ForkName): void {
    if (this.gossip === null) {
      this.logger.warn("Cannot subscribe to partial columns: gossip not set");
      return;
    }

    const subnetCount = this.config.DATA_COLUMN_SIDECAR_SUBNET_COUNT;
    // Get the fork epoch and use it to get the fork boundary
    const forkEpoch = this.config.forks[fork].epoch;
    const boundary = this.config.getForkBoundaryAtEpoch(forkEpoch);

    for (let subnet = 0; subnet < subnetCount; subnet++) {
      const topic = stringifyGossipTopic(this.config, {
        type: GossipType.data_column_sidecar,
        subnet,
        boundary,
      });

      this.gossip.subscribe(topic);

      this.logger.debug("Subscribed to partial column topic", {
        fork,
        subnet,
        topic,
      });
    }
  }

  /**
   * Called when a full column is received via regular gossip.
   *
   * Updates the column availability store to track that we now have this column.
   * This information is used when constructing our HAVE set for partial messages.
   *
   * @param column - The DataColumnSidecar received via gossip
   * @param blockRoot - The block root this column belongs to
   */
  onGossipColumn(column: fulu.DataColumnSidecar, blockRoot: Root): void {
    this.broadcaster.onFullColumnReceived(blockRoot, column.index);

    this.logger.debug("Tracked gossip column in partial network", {
      blockRoot: toRootHex(blockRoot),
      columnIndex: column.index,
      totalColumns: this.broadcaster.getColumnCount(blockRoot),
    });
  }

  /**
   * Called when a block is finalized.
   *
   * Cleans up all state associated with this block:
   * - Column availability tracking
   * - Peer metadata for this block
   * - Pending columns stored in memory
   *
   * @param blockRoot - The root of the finalized block
   */
  onFinalized(blockRoot: Root): void {
    this.broadcaster.onBlockFinalized(blockRoot);

    this.logger.debug("Cleaned up finalized block from partial network", {
      blockRoot: toRootHex(blockRoot),
    });
  }

  /**
   * Check if all custody columns are available for a block.
   *
   * @param blockRoot - The block root to check
   * @returns true if all custody columns are available
   */
  hasCustodyColumns(blockRoot: Root): boolean {
    return this.broadcaster.hasCustodyColumns(blockRoot);
  }

  /**
   * Get count of available columns for a block.
   *
   * @param blockRoot - The block root to check
   * @returns Number of columns available
   */
  getColumnCount(blockRoot: Root): number {
    return this.broadcaster.getColumnCount(blockRoot);
  }

  /**
   * Stop the partial column network and clean up resources.
   */
  stop(): void {
    this.broadcaster.stop();
  }

  /**
   * Callback when we need to fetch columns via req/resp.
   *
   * Called by the broadcaster when partial messages reveal that peers have
   * columns we need but we haven't received them via gossip.
   *
   * @param blockRoot - Block root to fetch columns for
   * @param columns - Column indices to fetch
   * @param peers - Peers who have advertised these columns
   */
  private async onNeedColumns(blockRoot: Root, columns: number[], peers: PeerId[]): Promise<void> {
    if (this.reqResp === null) {
      this.logger.debug("Cannot fetch columns: reqResp not set", {
        blockRoot: toRootHex(blockRoot),
        columns: columns.join(","),
      });
      return;
    }

    if (peers.length === 0) {
      this.logger.debug("No peers available for column fetch", {
        blockRoot: toRootHex(blockRoot),
        columns: columns.join(","),
      });
      return;
    }

    // Select a random peer from those who advertised the columns
    const peer = peers[Math.floor(Math.random() * peers.length)];
    const peerIdStr = peer.toString();

    try {
      this.logger.debug("Fetching missing columns via req/resp", {
        blockRoot: toRootHex(blockRoot),
        columns: columns.join(","),
        peer: peerIdStr,
      });

      // Use existing req/resp to fetch columns
      const result = await this.reqResp.sendDataColumnSidecarsByRoot(peerIdStr, [
        {
          blockRoot,
          columns,
        },
      ]);

      // Mark each fetched column as available
      for (const column of result) {
        this.broadcaster.onFullColumnReceived(blockRoot, column.index);
      }

      this.logger.debug("Fetched missing columns via req/resp", {
        blockRoot: toRootHex(blockRoot),
        fetched: result.length,
        requested: columns.length,
        peer: peerIdStr,
      });
    } catch (e) {
      this.logger.debug("Failed to fetch columns via req/resp", {
        blockRoot: toRootHex(blockRoot),
        columns: columns.join(","),
        peer: peerIdStr,
        error: (e as Error).message,
      });
    }
  }
}

/**
 * Creates a PartialColumnNetwork with default options.
 *
 * @param config - Beacon chain configuration
 * @param networkConfig - Network configuration
 * @param logger - Logger instance
 * @param metrics - Metrics instance (optional)
 * @param custodyColumns - Columns this node is responsible for
 * @returns Configured PartialColumnNetwork instance
 */
export function createPartialColumnNetwork(
  config: BeaconConfig,
  networkConfig: NetworkConfig,
  logger: Logger,
  metrics: PartialColumnMetrics | null,
  custodyColumns: number[]
): PartialColumnNetwork {
  return new PartialColumnNetwork(config, networkConfig, logger, metrics, {
    enabled: true,
    custodyColumns,
  });
}

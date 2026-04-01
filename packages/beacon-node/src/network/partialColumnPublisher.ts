import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, SubnetID, fulu, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {computeSubnetForDataColumnSidecar} from "../chain/validation/dataColumnSidecar.js";
import {Metrics} from "../metrics/index.js";
import {
  buildPartsMetadataBytes,
  computePartialMessageGroupId,
  dataColumnToPartialSidecar,
  getBlockRootHexFromPartialMessageGroupId,
} from "../util/dataColumns.js";
import {PeerIdStr} from "../util/peerId.js";
import type {INetworkCore} from "./core/types.js";
import {GossipType} from "./gossip/interface.js";
import {stringifyGossipTopic} from "./gossip/topic.js";
import {PartialColumnStateCache} from "./partialColumnStateCache.js";

type PartialPublishTrigger =
  | "block_production"
  | "gossip_merge"
  | "post_getblobs"
  | "full_column"
  | "full_gossip"
  | "metadata_request"
  | "recovery";

type PartialColumnPublisherModules = {
  config: BeaconConfig;
  core: INetworkCore;
  metrics: Metrics | null;
  custodySubnets: SubnetID[];
};

export class PartialColumnPublisher {
  private readonly config: BeaconConfig;
  private readonly core: INetworkCore;
  private readonly metrics: Metrics | null;
  private readonly custodySubnets: SubnetID[];
  private readonly stateCache: PartialColumnStateCache;

  constructor({config, core, metrics, custodySubnets}: PartialColumnPublisherModules) {
    this.config = config;
    this.core = core;
    this.metrics = metrics;
    this.custodySubnets = custodySubnets;
    this.stateCache = new PartialColumnStateCache({
      onPrune: (prunedCount) => {
        this.metrics?.partialPublish.stateCachePruned.inc(prunedCount);
      },
    });
  }

  async registerReceivedHeader(
    blockRoot: Uint8Array,
    header: fulu.PartialDataColumnHeader,
    sourcePeerId?: PeerIdStr
  ): Promise<void> {
    const blockRootHex = toRootHex(blockRoot);
    this.stateCache.upsertHeader(blockRootHex, header);
    this.observeStateCache();
    if (sourcePeerId !== undefined) {
      this.stateCache.markPeerHasHeader(blockRootHex, sourcePeerId);
    }

    await this.publishRequestMetadataAcrossCustodySubnets(
      blockRootHex,
      blockRoot,
      header.signedBlockHeader.message.slot
    );
  }

  async handleMetadataOnlyMessage(groupID: Uint8Array, subnet: SubnetID, peerId: PeerIdStr): Promise<void> {
    this.metrics?.partialPublish.metadataOnlyReceived.inc();
    const blockRootHex = getBlockRootHexFromPartialMessageGroupId(groupID);
    if (blockRootHex === null) {
      return;
    }

    const slot = this.stateCache.getSlot(blockRootHex);
    if (slot === null) {
      return;
    }

    this.stateCache.markPeerHasHeader(blockRootHex, peerId);
    await this.publishTrackedPartialToPeer(peerId, subnet, groupID.subarray(1), blockRootHex, slot, "metadata_request");
  }

  async publishAvailableColumn(
    column: fulu.DataColumnSidecar,
    trigger: Exclude<PartialPublishTrigger, "block_production" | "gossip_merge">
  ): Promise<void> {
    this.stateCache.storeFullColumn(column);
    this.observeStateCache();
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(column.signedBlockHeader.message);
    await this.publishTrackedPartialOnSubnet(
      computeSubnetForDataColumnSidecar(this.config, column),
      blockRoot,
      toRootHex(blockRoot),
      column.signedBlockHeader.message.slot,
      new Set(),
      trigger
    );
  }

  async publishBlockProductionColumns(
    columns: fulu.DataColumnSidecars,
    custodySubnets: SubnetID[],
    includeCells: boolean
  ): Promise<void> {
    if (columns.length === 0 || custodySubnets.length === 0) {
      return;
    }

    const firstColumn = columns[0];
    const slot = firstColumn.signedBlockHeader.message.slot;
    const epoch = computeEpochAtSlot(slot);
    const boundary = this.config.getForkBoundaryAtEpoch(epoch);
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(firstColumn.signedBlockHeader.message);
    const headerOnlySidecar = dataColumnToPartialSidecar(firstColumn, {includeHeader: true, includeCells: false});
    const columnsBySubnet = new Map<SubnetID, fulu.DataColumnSidecar>();
    const sentPeers = new Set<PeerIdStr>();

    for (const column of columns) {
      this.stateCache.storeFullColumn(column);
      columnsBySubnet.set(computeSubnetForDataColumnSidecar(this.config, column), column);
    }
    this.observeStateCache();
    const blockRootHex = toRootHex(blockRoot);

    for (const subnet of custodySubnets) {
      const topic = stringifyGossipTopic(this.config, {type: GossipType.data_column_sidecar, boundary, subnet});
      const partialPeers = await this.core.getPartialPeers(topic);

      if (partialPeers.length === 0) {
        continue;
      }

      const column = columnsBySubnet.get(subnet);
      const partialSidecar =
        includeCells && column !== undefined
          ? dataColumnToPartialSidecar(column, {includeHeader: true, includeCells: true})
          : headerOnlySidecar;

      for (const peerId of partialPeers) {
        if (sentPeers.has(peerId) || this.stateCache.hasPeerWithHeader(blockRootHex, peerId)) {
          this.metrics?.partialPublish.headerDedup.inc();
          continue;
        }

        await this.publishPartialSidecarToPeer(
          peerId,
          subnet,
          blockRoot,
          blockRootHex,
          slot,
          partialSidecar,
          "block_production"
        );
        sentPeers.add(peerId);
      }
    }
  }

  async broadcastHeaderAcrossCustodySubnets(
    partialSidecar: fulu.PartialDataColumnSidecar,
    arrivingSubnet: SubnetID,
    blockRoot: Uint8Array,
    slot: number,
    custodySubnets: SubnetID[]
  ): Promise<Set<PeerIdStr>> {
    if (partialSidecar.header.length === 0 || custodySubnets.length === 0) {
      return new Set();
    }

    const blockRootHex = toRootHex(blockRoot);
    this.stateCache.storePartialSidecar(blockRootHex, arrivingSubnet, partialSidecar);
    this.observeStateCache();
    const sentPeers = new Set<PeerIdStr>();
    const orderedSubnets = [arrivingSubnet, ...custodySubnets.filter((subnet) => subnet !== arrivingSubnet)];

    for (const subnet of orderedSubnets) {
      const partialToPublish =
        subnet === arrivingSubnet
          ? (this.stateCache.buildPartialSidecar(blockRootHex, subnet, {includeHeader: true}) ?? partialSidecar)
          : this.stateCache.buildHeaderOnlySidecar(blockRootHex);
      if (partialToPublish === null) {
        continue;
      }
      const peers = await this.getPartialPeersForSubnet(subnet, slot);

      for (const peerId of peers) {
        if (sentPeers.has(peerId) || this.stateCache.hasPeerWithHeader(blockRootHex, peerId)) {
          this.metrics?.partialPublish.headerDedup.inc();
          continue;
        }

        await this.publishPartialSidecarToPeer(
          peerId,
          subnet,
          blockRoot,
          blockRootHex,
          slot,
          partialToPublish,
          "gossip_merge"
        );
        sentPeers.add(peerId);
      }
    }

    return sentPeers;
  }

  async publishFilteredPartialOnSubnet(
    partialSidecar: fulu.PartialDataColumnSidecar,
    subnet: SubnetID,
    blockRoot: Uint8Array,
    slot: number,
    trigger: PartialPublishTrigger,
    skipPeers: ReadonlySet<PeerIdStr> = new Set()
  ): Promise<void> {
    const blockRootHex = toRootHex(blockRoot);
    this.stateCache.storePartialSidecar(blockRootHex, subnet, partialSidecar);
    this.observeStateCache();
    await this.publishTrackedPartialOnSubnet(subnet, blockRoot, blockRootHex, slot, skipPeers, trigger);
  }

  async publishPartialSidecarToPeer(
    peerId: PeerIdStr,
    subnet: SubnetID,
    blockRoot: Uint8Array,
    blockRootHex: RootHex,
    slot: number,
    partialSidecar: fulu.PartialDataColumnSidecar,
    trigger?: PartialPublishTrigger
  ): Promise<void> {
    const {topic} = this.getTopicForSubnet(subnet, slot);
    const partsMetadata =
      this.stateCache.buildPartsMetadataBytes(blockRootHex, subnet) ??
      buildPartsMetadataBytes(partialSidecar.cellsPresentBitmap);

    await this.core.publishPartialMessageToPeer(peerId, {
      topic,
      groupID: computePartialMessageGroupId(blockRoot),
      partialMessage: ssz.fulu.PartialDataColumnSidecar.serialize(partialSidecar),
      partsMetadata,
    });

    if (partialSidecar.header.length > 0) {
      this.stateCache.markPeerHasHeader(blockRootHex, peerId);
    }
    this.metrics?.partialColumns.headersPublished.inc(partialSidecar.header.length);
    this.metrics?.partialColumns.cellsPublished.inc(partialSidecar.partialColumn.length);
    if (trigger !== undefined && partialSidecar.header.length > 0) {
      this.metrics?.partialPublish.headerBroadcast.inc({trigger}, partialSidecar.header.length);
    }
    if (trigger !== undefined && partialSidecar.partialColumn.length > 0) {
      this.metrics?.partialPublish.cellsSent.inc({trigger}, partialSidecar.partialColumn.length);
    }
  }

  private async getPartialPeersForSubnet(subnet: SubnetID, slot: number): Promise<PeerIdStr[]> {
    const {topic} = this.getTopicForSubnet(subnet, slot);
    return this.core.getPartialPeers(topic);
  }

  private getTopicForSubnet(
    subnet: SubnetID,
    slot: number
  ): {boundary: ReturnType<BeaconConfig["getForkBoundaryAtEpoch"]>; topic: string} {
    const epoch = computeEpochAtSlot(slot);
    const boundary = this.config.getForkBoundaryAtEpoch(epoch);
    const topic = stringifyGossipTopic(this.config, {type: GossipType.data_column_sidecar, boundary, subnet});
    return {boundary, topic};
  }

  private filterCellsForPeer(
    partialSidecar: fulu.PartialDataColumnSidecar,
    metadataBytes: Uint8Array | undefined
  ): {partialSidecar: fulu.PartialDataColumnSidecar | null; hadMetadata: boolean; filteredCellCount: number} {
    if (metadataBytes === undefined) {
      return {partialSidecar, hadMetadata: false, filteredCellCount: 0};
    }

    let metadata: fulu.PartialDataColumnPartsMetadata;
    try {
      metadata = ssz.fulu.PartialDataColumnPartsMetadata.deserialize(metadataBytes);
    } catch {
      return {partialSidecar, hadMetadata: false, filteredCellCount: 0};
    }
    const bitLen = partialSidecar.cellsPresentBitmap.bitLen;
    const filteredBitmap = Array.from({length: bitLen}, () => false);
    const filteredCells: Uint8Array[] = [];
    const filteredProofs: Uint8Array[] = [];

    let cellIndex = 0;
    for (let i = 0; i < bitLen; i++) {
      if (!partialSidecar.cellsPresentBitmap.get(i)) {
        continue;
      }

      const shouldSend = metadata.requests.get(i) && !metadata.available.get(i);
      if (shouldSend) {
        filteredBitmap[i] = true;
        filteredCells.push(partialSidecar.partialColumn[cellIndex]);
        filteredProofs.push(partialSidecar.kzgProofs[cellIndex]);
      }
      cellIndex++;
    }

    if (filteredCells.length === 0) {
      return {partialSidecar: null, hadMetadata: true, filteredCellCount: partialSidecar.partialColumn.length};
    }

    return {
      partialSidecar: {
        cellsPresentBitmap: BitArray.fromBoolArray(filteredBitmap),
        partialColumn: filteredCells,
        kzgProofs: filteredProofs,
        header: partialSidecar.header,
      },
      hadMetadata: true,
      filteredCellCount: partialSidecar.partialColumn.length - filteredCells.length,
    };
  }

  private async publishTrackedPartialOnSubnet(
    subnet: SubnetID,
    blockRoot: Uint8Array,
    blockRootHex: RootHex,
    slot: number,
    skipPeers: ReadonlySet<PeerIdStr>,
    trigger: PartialPublishTrigger
  ): Promise<void> {
    const {topic} = this.getTopicForSubnet(subnet, slot);
    const peers = await this.core.getPartialPeers(topic);

    for (const peerId of peers) {
      if (skipPeers.has(peerId)) {
        continue;
      }

      await this.publishTrackedPartialToPeer(peerId, subnet, blockRoot, blockRootHex, slot, trigger);
    }
  }

  private async publishTrackedPartialToPeer(
    peerId: PeerIdStr,
    subnet: SubnetID,
    blockRoot: Uint8Array,
    blockRootHex: RootHex,
    slot: number,
    trigger: PartialPublishTrigger
  ): Promise<void> {
    const {topic} = this.getTopicForSubnet(subnet, slot);
    const metadataBytes = await this.core.getPeerPartialMetadata(
      topic,
      computePartialMessageGroupId(blockRoot),
      peerId
    );

    if (metadataBytes === undefined) {
      this.metrics?.partialPublish.peerNoMetadata.inc();
      if (this.stateCache.hasPeerWithHeader(blockRootHex, peerId)) {
        this.metrics?.partialPublish.peerSkip.inc();
        return;
      }

      const headerOnlySidecar = this.stateCache.buildHeaderOnlySidecar(blockRootHex);
      if (headerOnlySidecar === null) {
        this.metrics?.partialPublish.peerSkip.inc();
        return;
      }

      await this.publishPartialSidecarToPeer(peerId, subnet, blockRoot, blockRootHex, slot, headerOnlySidecar, trigger);
      return;
    }

    this.stateCache.markPeerHasHeader(blockRootHex, peerId);

    const trackedSidecar = this.stateCache.buildPartialSidecar(blockRootHex, subnet, {includeHeader: false});
    if (trackedSidecar === null) {
      this.metrics?.partialPublish.peerSkip.inc();
      return;
    }

    const filteredResult = this.filterCellsForPeer(trackedSidecar, metadataBytes);

    if (filteredResult.filteredCellCount > 0) {
      this.metrics?.partialPublish.cellsFiltered.inc(filteredResult.filteredCellCount);
    }
    if (filteredResult.partialSidecar === null) {
      this.metrics?.partialPublish.peerSkip.inc();
      return;
    }

    await this.publishPartialSidecarToPeer(
      peerId,
      subnet,
      blockRoot,
      blockRootHex,
      slot,
      filteredResult.partialSidecar,
      trigger
    );
  }

  private async publishRequestMetadataAcrossCustodySubnets(
    blockRootHex: RootHex,
    blockRoot: Uint8Array,
    slot: number
  ): Promise<void[]> {
    return Promise.all(
      this.custodySubnets.map(async (subnet) => {
        const {topic} = this.getTopicForSubnet(subnet, slot);
        const partsMetadata = this.stateCache.buildPartsMetadataBytes(blockRootHex, subnet);
        if (partsMetadata === null) {
          return;
        }

        await this.core.publishPartialMessage({
          topic,
          groupID: computePartialMessageGroupId(blockRoot),
          partsMetadata,
        });
        this.metrics?.partialPublish.requestMetadataSent.inc();
      })
    );
  }

  private observeStateCache(): void {
    this.metrics?.partialPublish.stateCacheBlocks.set(this.stateCache.getBlockCount());
  }
}

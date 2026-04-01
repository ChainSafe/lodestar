import {BitArray} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {SubnetID, fulu, ssz} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import type {INetworkCore} from "./core/types.js";
import {PeerIdStr} from "../util/peerId.js";
import {
  buildPartsMetadataBytes,
  computePartialMessageGroupId,
  dataColumnToPartialSidecar,
} from "../util/dataColumns.js";
import {Metrics} from "../metrics/index.js";
import {computeSubnetForDataColumnSidecar} from "../chain/validation/dataColumnSidecar.js";
import {GossipType} from "./gossip/interface.js";
import {stringifyGossipTopic} from "./gossip/topic.js";

export type PublishPartialColumnsOpts = {
  includeHeader: boolean;
  includeCells: boolean;
};

type PartialColumnPublisherModules = {
  config: BeaconConfig;
  core: INetworkCore;
  metrics: Metrics | null;
};

export class PartialColumnPublisher {
  private readonly config: BeaconConfig;
  private readonly core: INetworkCore;
  private readonly metrics: Metrics | null;

  constructor({config, core, metrics}: PartialColumnPublisherModules) {
    this.config = config;
    this.core = core;
    this.metrics = metrics;
  }

  async publishUniformColumns(columns: fulu.DataColumnSidecars, opts: PublishPartialColumnsOpts): Promise<void[]> {
    return Promise.all(columns.map((column) => this.publishUniformColumn(column, opts)));
  }

  async publishUniformColumn(column: fulu.DataColumnSidecar, opts: PublishPartialColumnsOpts): Promise<void> {
    const slot = column.signedBlockHeader.message.slot;
    const epoch = computeEpochAtSlot(slot);
    const boundary = this.config.getForkBoundaryAtEpoch(epoch);
    const subnet = computeSubnetForDataColumnSidecar(this.config, column);
    const partialSidecar = dataColumnToPartialSidecar(column, opts);
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(column.signedBlockHeader.message);

    await this.publishPartialSidecar(boundary, subnet, blockRoot, partialSidecar);
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
      columnsBySubnet.set(computeSubnetForDataColumnSidecar(this.config, column), column);
    }

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
        if (sentPeers.has(peerId)) {
          continue;
        }

        await this.publishPartialSidecarToPeer(peerId, subnet, blockRoot, slot, partialSidecar);
        sentPeers.add(peerId);
      }
    }
  }

  async publishPostGetBlobsColumns(columns: fulu.DataColumnSidecars): Promise<void[]> {
    return Promise.all(
      columns.map(async (column) => {
        const partialSidecar = dataColumnToPartialSidecar(column, {includeHeader: false, includeCells: true});
        const subnet = computeSubnetForDataColumnSidecar(this.config, column);
        const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(column.signedBlockHeader.message);

        await this.publishFilteredPartialOnSubnet(
          partialSidecar,
          subnet,
          blockRoot,
          column.signedBlockHeader.message.slot
        );
      })
    );
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

    const sentPeers = new Set<PeerIdStr>();
    const headerOnlySidecar: fulu.PartialDataColumnSidecar = {
      cellsPresentBitmap: BitArray.fromBoolArray([]),
      partialColumn: [],
      kzgProofs: [],
      header: partialSidecar.header,
    };
    const orderedSubnets = [arrivingSubnet, ...custodySubnets.filter((subnet) => subnet !== arrivingSubnet)];

    for (const subnet of orderedSubnets) {
      const partialToPublish = subnet === arrivingSubnet ? partialSidecar : headerOnlySidecar;
      const peers = await this.getPartialPeersForSubnet(subnet, slot);

      for (const peerId of peers) {
        if (sentPeers.has(peerId)) {
          continue;
        }

        await this.publishPartialSidecarToPeer(peerId, subnet, blockRoot, slot, partialToPublish);
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
    skipPeers: ReadonlySet<PeerIdStr> = new Set()
  ): Promise<void> {
    const groupID = computePartialMessageGroupId(blockRoot);
    const {topic} = this.getTopicForSubnet(subnet, slot);
    const peers = await this.core.getPartialPeers(topic);

    for (const peerId of peers) {
      if (skipPeers.has(peerId)) {
        continue;
      }

      const metadataBytes = await this.core.getPeerPartialMetadata(topic, groupID, peerId);
      const filteredSidecar = this.filterCellsForPeer(partialSidecar, metadataBytes);

      if (filteredSidecar === null) {
        continue;
      }

      await this.publishPartialSidecarToPeer(peerId, subnet, blockRoot, slot, filteredSidecar);
    }
  }

  async publishPartialSidecarToPeer(
    peerId: PeerIdStr,
    subnet: SubnetID,
    blockRoot: Uint8Array,
    slot: number,
    partialSidecar: fulu.PartialDataColumnSidecar
  ): Promise<void> {
    const {topic} = this.getTopicForSubnet(subnet, slot);

    await this.core.publishPartialMessageToPeer(peerId, {
      topic,
      groupID: computePartialMessageGroupId(blockRoot),
      partialMessage: ssz.fulu.PartialDataColumnSidecar.serialize(partialSidecar),
      partsMetadata: buildPartsMetadataBytes(partialSidecar.cellsPresentBitmap),
    });

    this.metrics?.partialColumns.headersPublished.inc(partialSidecar.header.length);
    this.metrics?.partialColumns.cellsPublished.inc(partialSidecar.partialColumn.length);
  }

  private async publishPartialSidecar(
    boundary: ReturnType<BeaconConfig["getForkBoundaryAtEpoch"]>,
    subnet: SubnetID,
    blockRoot: Uint8Array,
    partialSidecar: fulu.PartialDataColumnSidecar
  ): Promise<void> {
    const topic = stringifyGossipTopic(this.config, {type: GossipType.data_column_sidecar, boundary, subnet});

    await this.core.publishPartialMessage({
      topic,
      groupID: computePartialMessageGroupId(blockRoot),
      partialMessage: ssz.fulu.PartialDataColumnSidecar.serialize(partialSidecar),
      partsMetadata: buildPartsMetadataBytes(partialSidecar.cellsPresentBitmap),
    });

    this.metrics?.partialColumns.headersPublished.inc(partialSidecar.header.length);
    this.metrics?.partialColumns.cellsPublished.inc(partialSidecar.partialColumn.length);
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
  ): fulu.PartialDataColumnSidecar | null {
    if (metadataBytes === undefined) {
      return partialSidecar;
    }

    const metadata = ssz.fulu.PartialDataColumnPartsMetadata.deserialize(metadataBytes);
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
      return null;
    }

    return {
      cellsPresentBitmap: BitArray.fromBoolArray(filteredBitmap),
      partialColumn: filteredCells,
      kzgProofs: filteredProofs,
      header: partialSidecar.header,
    };
  }
}

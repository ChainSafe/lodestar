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

  async publishPartialSidecarToPeer(
    peerId: PeerIdStr,
    subnet: SubnetID,
    blockRoot: Uint8Array,
    slot: number,
    partialSidecar: fulu.PartialDataColumnSidecar
  ): Promise<void> {
    const epoch = computeEpochAtSlot(slot);
    const boundary = this.config.getForkBoundaryAtEpoch(epoch);
    const topic = stringifyGossipTopic(this.config, {type: GossipType.data_column_sidecar, boundary, subnet});

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
}

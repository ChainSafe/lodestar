import {computeEpochAtSlot} from "@lodestar/state-transition";
import {SubnetID, fulu, ssz} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import {PeerIdStr} from "../util/peerId.js";
import {
  buildPartsMetadataBytes,
  computePartialMessageGroupId,
  dataColumnToPartialSidecar,
} from "../util/dataColumns.js";
import {Metrics} from "../metrics/index.js";
import {computeSubnetForDataColumnSidecar} from "../chain/validation/dataColumnSidecar.js";
import {INetworkCore} from "./core/index.js";
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

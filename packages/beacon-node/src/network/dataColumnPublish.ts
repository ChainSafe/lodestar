import type {PublishOpts} from "@libp2p/gossipsub/types";
import type {BeaconConfig} from "@lodestar/config";
import type {DataColumnSidecar} from "@lodestar/types";
import type {INetworkCore} from "./core/types.js";
import {type GossipTopicMap, GossipType} from "./gossip/interface.js";
import {stringifyGossipTopic} from "./gossip/topic.js";

export async function getFullDataColumnPublishOpts(
  config: BeaconConfig,
  core: Pick<INetworkCore, "getPartialPeers">,
  topic: GossipTopicMap[GossipType.data_column_sidecar],
  dataColumnSidecar: DataColumnSidecar,
  enablePartialColumns: boolean
): Promise<Partial<Pick<PublishOpts, "excludePeerIds">>> {
  if (!enablePartialColumns) {
    return {};
  }

  return {
    excludePeerIds: await core.getPartialPeers(stringifyGossipTopic(config, topic)),
  };
}

export function shouldPublishPartialDataColumn(
  enablePartialColumns: boolean,
  publishPartial: boolean
): boolean {
  return publishPartial && enablePartialColumns;
}

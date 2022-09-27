import {peerIdFromString} from "@libp2p/peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {routes} from "@lodestar/api";
import {Bucket, Repository} from "@lodestar/db";
import {toHex} from "@lodestar/utils";
import {getLatestWeakSubjectivityCheckpointEpoch} from "@lodestar/state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {BeaconChain} from "../../../chain/index.js";
import {QueuedStateRegenerator, RegenRequest} from "../../../chain/regen/index.js";
import {GossipType} from "../../../network/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {ApiModules} from "../types.js";
import {formatNodePeer} from "../node/utils.js";

export function getLodestarApi({
  chain,
  config,
  db,
  network,
  sync,
}: Pick<ApiModules, "chain" | "config" | "db" | "network" | "sync">): routes.lodestar.Api {
  let writingHeapdump = false;

  return {
    async writeHeapdump(dirpath = ".") {
      if (writingHeapdump) {
        throw Error("Already writing heapdump");
      }
      // Lazily import NodeJS only modules
      const fs = await import("node:fs");
      const v8 = await import("v8");
      const snapshotStream = v8.getHeapSnapshot();
      // It's important that the filename end with `.heapsnapshot`,
      // otherwise Chrome DevTools won't open it.
      const filepath = `${dirpath}/${new Date().toISOString()}.heapsnapshot`;
      const fileStream = fs.createWriteStream(filepath);
      try {
        writingHeapdump = true;
        await new Promise<void>((resolve) => {
          snapshotStream.pipe(fileStream);
          snapshotStream.on("end", () => {
            resolve();
          });
        });
        return {data: {filepath}};
      } finally {
        writingHeapdump = false;
      }
    },

    async getLatestWeakSubjectivityCheckpointEpoch() {
      const state = chain.getHeadState();
      return {data: getLatestWeakSubjectivityCheckpointEpoch(config, state)};
    },

    async getSyncChainsDebugState() {
      return {data: sync.getSyncChainsDebugState()};
    },

    async getGossipQueueItems(gossipType: GossipType) {
      const jobQueue = network.gossip.jobQueues[gossipType];
      if (jobQueue === undefined) {
        throw Error(`Unknown gossipType ${gossipType}, known values: ${Object.keys(jobQueue).join(", ")}`);
      }

      return jobQueue.getItems().map((item) => {
        const [topic, message, propagationSource, seenTimestampSec] = item.args;
        return {
          topic: topic,
          propagationSource,
          data: message.data,
          addedTimeMs: item.addedTimeMs,
          seenTimestampSec,
        };
      });
    },

    async getRegenQueueItems() {
      return (chain.regen as QueuedStateRegenerator).jobQueue.getItems().map((item) => ({
        key: item.args[0].key,
        args: regenRequestToJson(config, item.args[0]),
        addedTimeMs: item.addedTimeMs,
      }));
    },

    async getBlockProcessorQueueItems() {
      return (chain as BeaconChain)["blockProcessor"].jobQueue.getItems().map((item) => {
        const [blocks, opts] = item.args;
        return {
          blockSlots: blocks.map((block) => block.message.slot),
          jobOpts: opts,
          addedTimeMs: item.addedTimeMs,
        };
      });
    },

    async getStateCacheItems() {
      return (chain as BeaconChain)["stateCache"].dumpSummary();
    },

    async getCheckpointStateCacheItems() {
      return (chain as BeaconChain)["checkpointStateCache"].dumpSummary();
    },

    async getGossipPeerScoreStats() {
      return network.gossip.dumpPeerScoreStats();
    },

    async runGC() {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!global.gc) throw Error("You must expose GC running the Node.js process with 'node --expose_gc'");
      global.gc();
    },

    async dropStateCache() {
      chain.stateCache.clear();
      chain.checkpointStateCache.clear();
    },

    async connectPeer(peerIdStr, multiaddrStrs) {
      const peerId = peerIdFromString(peerIdStr);
      const multiaddrs = multiaddrStrs.map((multiaddrStr) => multiaddr(multiaddrStr));
      await network.connectToPeer(peerId, multiaddrs);
    },

    async disconnectPeer(peerIdStr) {
      const peerId = peerIdFromString(peerIdStr);
      await network.disconnectPeer(peerId);
    },

    async getPeers(filters) {
      const {state, direction} = filters || {};
      const peers = Array.from(network.getConnectionsByPeer().entries())
        .map(([peerIdStr, connections]) => ({
          ...formatNodePeer(peerIdStr, connections),
          agentVersion: network.getAgentVersion(peerIdStr),
        }))
        .filter(
          (nodePeer) =>
            (!state || state.length === 0 || state.includes(nodePeer.state)) &&
            (!direction || direction.length === 0 || (nodePeer.direction && direction.includes(nodePeer.direction)))
        );

      return {
        data: peers,
        meta: {count: peers.length},
      };
    },

    async discv5GetKadValues() {
      return {
        data: network.discv5?.kadValues().map((enr) => enr.encodeTxt()) ?? [],
      };
    },

    async dumpDbBucketKeys(bucketReq) {
      for (const repo of Object.values(db) as IBeaconDb[keyof IBeaconDb][]) {
        if (repo instanceof Repository) {
          const bucket = (repo as RepositoryAny)["bucket"];
          if (bucket === bucket || Bucket[bucket] === bucketReq) {
            return stringifyKeys(await repo.keys());
          }
        }
      }

      throw Error(`Unknown Bucket '${bucketReq}' available: ${Object.keys(Bucket).join(", ")}`);
    },

    async dumpDbStateIndex() {
      return db.stateArchive.dumpRootIndexEntries();
    },
  };
}

function regenRequestToJson(config: IChainForkConfig, regenRequest: RegenRequest): unknown {
  switch (regenRequest.key) {
    case "getBlockSlotState":
      return {
        root: regenRequest.args[0],
        slot: regenRequest.args[1],
      };

    case "getCheckpointState":
      return ssz.phase0.Checkpoint.toJson(regenRequest.args[0]);

    case "getPreState": {
      const slot = regenRequest.args[0].slot;
      return {
        root: toHexString(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(regenRequest.args[0])),
        slot,
      };
    }

    case "getState":
      return {
        root: regenRequest.args[0],
      };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RepositoryAny = Repository<any, any>;

function stringifyKeys(keys: (Uint8Array | number | string)[]): string[] {
  return keys.map((key) => {
    if (key instanceof Uint8Array) {
      return toHex(key);
    } else {
      return `${key}`;
    }
  });
}

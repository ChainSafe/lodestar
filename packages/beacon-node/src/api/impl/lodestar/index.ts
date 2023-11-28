import fs from "node:fs";
import path from "node:path";
import {toHexString} from "@chainsafe/ssz";
import {routes, ServerApi} from "@lodestar/api";
import {Repository} from "@lodestar/db";
import {toHex} from "@lodestar/utils";
import {getLatestWeakSubjectivityCheckpointEpoch} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {LodestarThreadType} from "@lodestar/api/lib/beacon/routes/lodestar.js";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconChain} from "../../../chain/index.js";
import {QueuedStateRegenerator, RegenRequest} from "../../../chain/regen/index.js";
import {GossipType} from "../../../network/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {ApiModules} from "../types.js";
import {profileNodeJS, writeHeapSnapshot} from "../../../util/profile.js";

export function getLodestarApi({
  chain,
  config,
  db,
  network,
  sync,
}: Pick<ApiModules, "chain" | "config" | "db" | "network" | "sync">): ServerApi<routes.lodestar.Api> {
  let writingHeapdump = false;
  let writingProfile = false;
  const defaultProfileMs = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;

  return {
    async writeHeapdump(thread = "main", dirpath = ".") {
      if (writingHeapdump) {
        throw Error("Already writing heapdump");
      }

      try {
        writingHeapdump = true;
        let filepath: string;
        switch (thread) {
          case "network":
            filepath = await network.writeNetworkHeapSnapshot("network_thread", dirpath);
            break;
          case "discv5":
            filepath = await network.writeDiscv5HeapSnapshot("discv5_thread", dirpath);
            break;
          default:
            // main thread
            filepath = await writeHeapSnapshot("main_thread", dirpath);
            break;
        }
        return {data: {filepath}};
      } finally {
        writingHeapdump = false;
      }
    },

    async writeProfile(thread: LodestarThreadType = "network", durationMs = defaultProfileMs, dirpath = ".") {
      if (writingProfile) {
        throw Error("Already writing network profile");
      }
      writingProfile = true;

      try {
        let filepath: string;
        let profile: string;
        switch (thread) {
          case "network":
            filepath = await network.writeNetworkThreadProfile(durationMs, dirpath);
            break;
          case "discv5":
            filepath = await network.writeDiscv5Profile(durationMs, dirpath);
            break;
          default:
            // main thread
            profile = await profileNodeJS(durationMs);
            filepath = path.join(dirpath, `main_thread_${new Date().toISOString()}.cpuprofile`);
            fs.writeFileSync(filepath, profile);
            break;
        }
        return {data: {filepath}};
      } finally {
        writingProfile = false;
      }
    },

    async getLatestWeakSubjectivityCheckpointEpoch() {
      const state = chain.getHeadState();
      return {data: getLatestWeakSubjectivityCheckpointEpoch(config, state)};
    },

    async getSyncChainsDebugState() {
      return {data: sync.getSyncChainsDebugState()};
    },

    async getGossipQueueItems(gossipType: GossipType | string) {
      return {
        data: await network.dumpGossipQueue(gossipType as GossipType),
      };
    },

    async getRegenQueueItems() {
      return {
        data: (chain.regen as QueuedStateRegenerator).jobQueue.getItems().map((item) => ({
          key: item.args[0].key,
          args: regenRequestToJson(config, item.args[0]),
          addedTimeMs: item.addedTimeMs,
        })),
      };
    },

    async getBlockProcessorQueueItems() {
      return {
        data: (chain as BeaconChain)["blockProcessor"].jobQueue.getItems().map((item) => {
          const [blockInputs, opts] = item.args;
          return {
            blockSlots: blockInputs.map((blockInput) => blockInput.block.message.slot),
            jobOpts: opts,
            addedTimeMs: item.addedTimeMs,
          };
        }),
      };
    },

    async getStateCacheItems() {
      return {data: chain.regen.dumpCacheSummary()};
    },

    async getGossipPeerScoreStats() {
      return {
        data: Object.entries(await network.dumpGossipPeerScoreStats()).map(([peerId, stats]) => ({peerId, ...stats})),
      };
    },

    async getLodestarPeerScoreStats() {
      return {data: await network.dumpPeerScoreStats()};
    },

    async runGC() {
      if (!global.gc) throw Error("You must expose GC running the Node.js process with 'node --expose_gc'");
      global.gc();
    },

    async dropStateCache() {
      chain.regen.dropCache();
    },

    async connectPeer(peerIdStr, multiaddrStrs) {
      await network.connectToPeer(peerIdStr, multiaddrStrs);
    },

    async disconnectPeer(peerIdStr) {
      await network.disconnectPeer(peerIdStr);
    },

    async getPeers(filters) {
      const {state, direction} = filters || {};
      const peers = (await network.dumpPeers()).filter(
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
        data: await network.dumpDiscv5KadValues(),
      };
    },

    async dumpDbBucketKeys(bucketReq) {
      for (const repo of Object.values(db) as IBeaconDb[keyof IBeaconDb][]) {
        if (repo instanceof Repository) {
          if (String(repo["bucket"]) === bucketReq || repo["bucketId"] === bucketReq) {
            return {data: stringifyKeys(await repo.keys())};
          }
        }
      }

      throw Error(`Unknown Bucket '${bucketReq}'`);
    },

    async dumpDbStateIndex() {
      return {data: await db.stateArchive.dumpRootIndexEntries()};
    },
  };
}

function regenRequestToJson(config: ChainForkConfig, regenRequest: RegenRequest): unknown {
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

function stringifyKeys(keys: (Uint8Array | number | string)[]): string[] {
  return keys.map((key) => {
    if (key instanceof Uint8Array) {
      return toHex(key);
    } else {
      return `${key}`;
    }
  });
}

import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {routes} from "@chainsafe/lodestar-api";
import {getLatestWeakSubjectivityCheckpointEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {Json, toHexString} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {BeaconChain} from "../../../chain";
import {QueuedStateRegenerator, RegenRequest} from "../../../chain/regen";
import {GossipType} from "../../../network";
import {ApiModules} from "../types";

export function getLodestarApi({
  chain,
  config,
  network,
  sync,
}: Pick<ApiModules, "chain" | "config" | "network" | "sync">): routes.lodestar.Api {
  let writingHeapdump = false;

  return {
    /**
     * Get a wtfnode dump of all active handles
     * Will only load the wtfnode after the first call, and registers async hooks
     * and other listeners to the global process instance
     */
    async getWtfNode() {
      // Browser interop
      if (typeof require !== "function") throw Error("NodeJS only");

      // eslint-disable-next-line
      const wtfnode = require("wtfnode");
      const logs: string[] = [];
      function logger(...args: string[]): void {
        for (const arg of args) logs.push(arg);
      }
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      wtfnode.setLogger("info", logger);
      wtfnode.setLogger("warn", logger);
      wtfnode.setLogger("error", logger);
      wtfnode.dump();
      return {data: logs.join("\n")};
    },

    async writeHeapdump(dirpath = ".") {
      // Browser interop
      if (typeof require !== "function") throw Error("NodeJS only");

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
        const [topic, message] = item.args;
        return {
          topic: topic,
          receivedFrom: message.receivedFrom,
          data: message.data,
          addedTimeMs: item.addedTimeMs,
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
        const [job] = item.args;
        const jobs = Array.isArray(job) ? job : [job];
        return {
          blockSlots: jobs.map((j) => j.block.message.slot),
          jobOpts: {
            skipImportingAttestations: jobs[0].skipImportingAttestations,
            validProposerSignature: jobs[0].validProposerSignature,
            validSignatures: jobs[0].validSignatures,
          },
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
      const peerId = PeerId.createFromB58String(peerIdStr);
      const multiaddrs = multiaddrStrs.map((multiaddrStr) => new Multiaddr(multiaddrStr));
      await network.connectToPeer(peerId, multiaddrs);
    },

    async disconnectPeer(peerIdStr) {
      const peerId = PeerId.createFromB58String(peerIdStr);
      await network.disconnectPeer(peerId);
    },

    async discv5GetKadValues() {
      return {
        data: network.discv5?.kadValues().map((enr) => enr.encodeTxt()) ?? [],
      };
    },
  };
}

function regenRequestToJson(config: IChainForkConfig, regenRequest: RegenRequest): Json {
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

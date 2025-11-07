import {Tree} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ChainForkConfig} from "@lodestar/config";
import {Repository} from "@lodestar/db";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateCapella, getLatestWeakSubjectivityCheckpointEpoch, loadState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../chain/index.js";
import {QueuedStateRegenerator, RegenRequest} from "../../../chain/regen/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {GossipType} from "../../../network/index.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {ProfileThread, profileThread, writeHeapSnapshot} from "../../../util/profile.js";
import {getStateResponseWithRegen} from "../beacon/state/utils.js";
import {ApiError} from "../errors.js";
import {ApiModules} from "../types.js";

export function getLodestarApi({
  chain,
  config,
  db,
  network,
  sync,
}: Pick<ApiModules, "chain" | "config" | "db" | "network" | "sync">): ApplicationMethods<routes.lodestar.Endpoints> {
  let writingHeapdump = false;
  let writingProfile = false;
  // for NodeJS, profile the whole epoch
  // for Bun, profile 1 slot. Otherwise it will either crash the app, and/or inspector cannot render the profile
  const defaultProfileMs = globalThis.Bun ? config.SLOT_DURATION_MS : SLOTS_PER_EPOCH * config.SLOT_DURATION_MS;

  return {
    async writeHeapdump({thread = "main", dirpath = "."}) {
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

    async writeProfile({thread = "network", duration = defaultProfileMs, dirpath = "."}) {
      if (writingProfile) {
        throw Error("Already writing network profile");
      }
      writingProfile = true;

      try {
        let filepath: string;
        switch (thread) {
          case "network":
            filepath = await network.writeNetworkThreadProfile(duration, dirpath);
            break;
          case "discv5":
            filepath = await network.writeDiscv5Profile(duration, dirpath);
            break;
          default:
            // main thread
            filepath = await profileThread(ProfileThread.MAIN, duration, dirpath);
            break;
        }
        return {data: {result: filepath}};
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

    async getGossipQueueItems({gossipType}) {
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
        // biome-ignore lint/complexity/useLiteralKeys: The `blockProcessor` is a protected attribute
        data: (chain as BeaconChain)["blockProcessor"].jobQueue.getItems().map((item) => {
          const [blockInputs, opts] = item.args;
          return {
            blockSlots: blockInputs.map((blockInput) => blockInput.slot),
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

    async connectPeer({peerId, multiaddrs}) {
      await network.connectToPeer(peerId, multiaddrs);
    },

    async disconnectPeer({peerId}) {
      await network.disconnectPeer(peerId);
    },

    async getPeers({state, direction}) {
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

    async getBlacklistedBlocks() {
      return {
        data: Array.from(chain.blacklistedBlocks.entries()).map(([root, slot]) => ({root, slot})),
      };
    },

    async discv5GetKadValues() {
      return {
        data: await network.dumpDiscv5KadValues(),
      };
    },

    async dumpDbBucketKeys({bucket}) {
      for (const repo of Object.values(db) as IBeaconDb[keyof IBeaconDb][]) {
        // biome-ignore lint/complexity/useLiteralKeys: `bucket` is protected and `bucketId` is private
        if (repo instanceof Repository && (String(repo["bucket"]) === bucket || repo["bucketId"] === bucket)) {
          return {data: stringifyKeys(await repo.keys())};
        }
      }

      throw Error(`Unknown Bucket '${bucket}'`);
    },

    async dumpDbStateIndex() {
      return {data: await db.stateArchive.dumpRootIndexEntries()};
    },

    async getHistoricalSummaries({stateId}) {
      const {state, executionOptimistic, finalized} = await getStateResponseWithRegen(chain, stateId);

      const stateView = (
        state instanceof Uint8Array ? loadState(config, chain.getHeadState(), state).state : state.clone()
      ) as BeaconStateCapella;

      const fork = config.getForkName(stateView.slot);
      if (ForkSeq[fork] < ForkSeq.capella) {
        throw new Error("Historical summaries are not supported before Capella");
      }

      const {gindex} = ssz[fork].BeaconState.getPathInfo(["historicalSummaries"]);
      const proof = new Tree(stateView.node).getSingleProof(gindex);

      return {
        data: {
          slot: stateView.slot,
          historicalSummaries: stateView.historicalSummaries.toValue(),
          proof: proof,
        },
        meta: {executionOptimistic, finalized, version: fork},
      };
    },

    // the optional checkpoint is in root:epoch format
    async getPersistedCheckpointState({checkpointId}) {
      const checkpoint = checkpointId ? getCheckpointFromArg(checkpointId) : undefined;
      const stateBytes = await chain.getPersistedCheckpointState(checkpoint);
      if (stateBytes === null) {
        throw new ApiError(
          404,
          checkpointId ? `Checkpoint state not found for id ${checkpointId}` : "Latest safe checkpoint state not found"
        );
      }

      const slot = getStateSlotFromBytes(stateBytes);
      return {
        data: stateBytes,
        meta: {
          version: config.getForkName(slot),
        },
      };
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
        root: toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(regenRequest.args[0])),
        slot,
      };
    }

    case "getState":
      return {
        root: regenRequest.args[0],
      };
  }
}

const CHECKPOINT_REGEX = /^(?:0x)?([0-9a-f]{64}):([0-9]+)$/;
/**
 * Extract a checkpoint from a string in the format `rootHex:epoch`.
 */
export function getCheckpointFromArg(checkpointStr: string): Checkpoint {
  const match = CHECKPOINT_REGEX.exec(checkpointStr.toLowerCase());
  if (!match) {
    throw new ApiError(400, `Could not parse checkpoint string: ${checkpointStr}`);
  }
  return {root: fromHex(match[1]), epoch: parseInt(match[2])};
}

function stringifyKeys(keys: (Uint8Array | number | string)[]): string[] {
  return keys.map((key) => {
    if (key instanceof Uint8Array) {
      return toHex(key);
    }
    return `${key}`;
  });
}

import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ChainForkConfig} from "@lodestar/config";
import {Repository} from "@lodestar/db";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Attestation, Epoch} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../chain/index.js";
import {RegenRequest} from "../../../chain/regen/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {GossipType} from "../../../network/index.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {ProfileThread, profileThread, writeHeapSnapshot} from "../../../util/profile.js";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiError} from "../errors.js";
import {ApiModules} from "../types.js";
import {getAttesterSlashingsFromIndexedAttestations} from "./attesterSlashing.js";

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
      return {data: chain.beaconEngine.getLatestWeakSubjectivityCheckpointEpoch()};
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
        data: chain.beaconEngine.dumpRegenQueueItems().map((item) => ({
          key: item.key,
          args: regenRequestToJson(config, item.args),
          addedTimeMs: item.addedTimeMs,
        })),
      };
    },

    async getBlockProcessorQueueItems() {
      return {
        // biome-ignore lint/complexity/useLiteralKeys: The `blockProcessor` is a protected attribute
        data: (chain as BeaconChain)["blockProcessor"].jobQueue.getItems().map((item) => {
          const [blockInputs, _payloadEnvelopes, opts] = item.args;
          return {
            blockSlots: blockInputs.map((blockInput) => blockInput.slot),
            jobOpts: opts,
            addedTimeMs: item.addedTimeMs,
          };
        }),
      };
    },

    async getStateCacheItems() {
      return {data: chain.beaconEngine.dumpCacheSummary()};
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
      chain.beaconEngine.dropCache();
    },

    async connectPeer({peerId, multiaddrs}) {
      await network.connectToPeer(peerId, multiaddrs);
    },

    async disconnectPeer({peerId}) {
      await network.disconnectPeer(peerId);
    },

    async addDirectPeer({peer}) {
      const peerId = await network.addDirectPeer(peer);
      if (peerId === null) {
        throw new ApiError(400, `Failed to add direct peer: invalid peer address or ENR "${peer}"`);
      }
      return {data: {peerId}};
    },

    async removeDirectPeer({peerId}) {
      const removed = await network.removeDirectPeer(peerId);
      return {data: {removed}};
    },

    async getDirectPeers() {
      return {data: await network.getDirectPeers()};
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
      const id = resolveStateId(chain.beaconEngine, stateId);
      const res = await chain.beaconEngine.getHistoricalSummaries(id);
      if (!res) {
        throw new ApiError(404, `State not found for id '${stateId}'`);
      }

      return {
        data: {
          slot: res.slot,
          historicalSummaries: res.historicalSummaries,
          proof: res.proof,
        },
        meta: {executionOptimistic: res.executionOptimistic, finalized: res.finalized, version: res.fork},
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

    async getMonitoredValidatorIndices() {
      return {
        data: chain.validatorMonitor?.getMonitoredValidatorIndices() ?? [],
      };
    },

    async getCustodyInfo() {
      const {custodyColumns, targetCustodyGroupCount} = chain.custodyConfig;

      return {
        data: {
          earliestCustodiedSlot: chain.earliestAvailableSlot,
          custodyGroupCount: targetCustodyGroupCount,
          custodyColumns,
        },
      };
    },

    async getFastConfirmationInfo() {
      const confirmedRoot = chain.beaconEngine.getConfirmedRoot();
      const confirmedBlock = chain.beaconEngine.getConfirmedBlock();
      const justifiedCheckpoint = chain.beaconEngine.getJustifiedCheckpoint();
      const finalizedCheckpoint = chain.beaconEngine.getFinalizedCheckpoint();
      const headRoot = chain.beaconEngine.getHeadRoot();
      const head = chain.beaconEngine.getHead();

      return {
        data: {
          confirmed: {
            rootHex: confirmedRoot,
            slot: confirmedBlock?.slot ?? null,
          },
          head: {
            rootHex: headRoot,
            slot: head.slot,
          },
          justifiedCheckpoint: {
            rootHex: justifiedCheckpoint.rootHex,
            epoch: justifiedCheckpoint.epoch,
          },
          finalizedCheckpoint: {
            rootHex: finalizedCheckpoint.rootHex,
            epoch: finalizedCheckpoint.epoch,
          },
        },
      };
    },

    async getAttesterSlashingsFromBlocks({signedBlocks}) {
      const attestations = new Map<Epoch, Attestation[]>();

      for (const block of signedBlocks) {
        const attestationsOfABlock = block.message.body.attestations;
        for (const attestation of attestationsOfABlock) {
          const epoch = computeEpochAtSlot(attestation.data.slot);
          let attestationsPerEpoch = attestations.get(epoch);
          if (!attestationsPerEpoch) {
            attestationsPerEpoch = [];
            attestations.set(epoch, attestationsPerEpoch);
          }
          attestationsPerEpoch.push(attestation);
        }
      }

      // Assume all blocks are from the same fork
      const forkSeq = config.getForkSeq(signedBlocks[0].message.slot);

      const requests = Array.from(attestations, ([epoch, attestationsPerEpoch]) => ({
        slot: computeStartSlotAtEpoch(epoch),
        epoch,
        attestations: attestationsPerEpoch,
      }));
      const indexedAttestations = await chain.beaconEngine.getIndexedAttestationsForSlashing(requests, forkSeq);

      const result = getAttesterSlashingsFromIndexedAttestations(forkSeq, indexedAttestations);

      return {
        data: result,
        meta: {
          version: config.getForkName(signedBlocks[0].message.slot),
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

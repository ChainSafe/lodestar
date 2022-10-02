import {promisify} from "node:util";
import {Api, getClient, routes} from "@lodestar/api/beacon";
import {SLOTS_PER_EPOCH, ForkSeq} from "@lodestar/params";
import {altair, Epoch, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {getStateTypeFromBytes} from "@lodestar/beacon-node";
import {IChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {getLocalAddress} from "./utils/address.js";
import {
  computeAltairEpochParticipation,
  getBlockAttestationInclusionScore,
  getBlockAttestationParticipantCount,
  getBlockSyncCommitteeParticipation,
} from "./participation.js";
import {TableRender} from "./utils/tableRender.js";
import {ErrorCode, ErrorType, HeadSummary, NodeId, renderError} from "./errors.js";
import {formatEpochSlotTime} from "./utils/timeLogGenesis.js";

const sleep = promisify(setTimeout);

const genesisHead: HeadSummary = {slot: 0, block: "0x0"};

export interface NetworkData {
  validatorCount: number;
  genesisTime: number;
  genesisState: BeaconStateAllForks;
  config: IChainForkConfig;
  beaconNodes: {restPort: number; nodeIndex: number}[];
}

interface BeaconParticipant {
  api: Api;
  nodeIndex: number;
}

export type ParticipationFlag = "source" | "target" | "head";
const participationFlags: ParticipationFlag[] = ["source", "target", "head"];

interface SuccessOpts {
  /** Fraction 0-1 of min sync participation per block */
  minSyncParticipation: number;
  /** Max allowed count on individual blocks with < minSyncParticipation */
  maxBlocksWithLowMinSyncParticipation: number;
  /** Fraction 0-1 of min epoch participation for source, target, head */
  minEpochParticipation: Record<ParticipationFlag, number>;
  /** Max block inclusion score computed as `Sum(block.slot - attestation.data.slot - 1)` */
  maxAttestationInclusionScore: number;
}

/* eslint-disable no-console */

export class SimulationTracker {
  // Chain tracking
  private readonly headPerSlot = new MapDef<Slot, Map<NodeId, HeadSummary>>(() => new Map());
  private readonly headPerNode = new Map<NodeId, HeadSummary>();
  private readonly seenHeadBlockRoots = new Set<RootHex>();
  private readonly seenHeadBlockSlots = new Set<Slot>();
  private readonly seenHeadBlockEpochs = new Set<Epoch>();
  private readonly loggedMissedSlots = new Set<Slot>();
  private readonly peerCountByNode = new Map<NodeId, number>();

  // Assertions data
  private readonly lowSyncParticipation: {slot: Slot; syncP: number}[] = [];

  private readonly controller = new AbortController();
  private readonly config: IChainForkConfig;
  private readonly genesisTime: number;
  private readonly beaconNodes: BeaconParticipant[];

  readonly errors: ErrorType[] = [];

  private readonly onHeadTable = new TableRender({
    time: {width: 9}, // See `formatEpochSlotTime()` for rationale on why 9
    slot: {width: 3},
    block: {width: 8},
    proposer: {width: 4},
    attnPCount: {width: 5, header: "attnP"},
    attnIncScore: {width: 4, header: "incS"},
    syncP: {width: 5, header: "syncP"},
    peerCounts: {width: 4 * 2, header: "peers", widthFlexible: true},
  });

  constructor(networkData: NetworkData, private readonly successOpts: SuccessOpts) {
    const {config, beaconNodes} = networkData;
    this.config = config;
    this.genesisTime = networkData.genesisTime;

    this.beaconNodes = beaconNodes.map((beacon) => ({
      api: getClient({baseUrl: getLocalAddress(beacon.restPort)}, {config}),
      nodeIndex: beacon.nodeIndex,
    }));

    // const cachedBeaconState = createCachedBeaconState(networkData.genesisState, {
    //   config: createIBeaconConfig(config, networkData.genesisState.genesisValidatorsRoot),
    //   pubkey2index: new PubkeyIndexMap(),
    //   index2pubkey: [],
    // });

    this.runClock().catch((e) => {
      console.error("Error on runClock", e);
    });

    for (const beacon of this.beaconNodes) {
      beacon.api.events.eventstream(
        [routes.events.EventType.block, routes.events.EventType.head, routes.events.EventType.finalizedCheckpoint],
        this.controller.signal,
        async (event) => {
          switch (event.type) {
            case routes.events.EventType.block:
              // await this.onBlock(event.message, beacon);
              return;

            case routes.events.EventType.head:
              await this.onHead(event.message, beacon);
              return;

            case routes.events.EventType.finalizedCheckpoint:
              this.onFinalizedCheckpoint(event.message, beacon);
              return;
          }
        }
      );
    }
  }

  async stop(): Promise<void> {
    this.controller.abort();
  }

  /**
   * Post-process errors and throw if any failure condition
   */
  assertNoErrors(): void {
    // Only add lowSyncParticipation errors if they exceed the max count of instances
    if (this.lowSyncParticipation.length > this.successOpts.maxBlocksWithLowMinSyncParticipation) {
      for (const item of this.lowSyncParticipation) {
        this.errors.push({
          code: ErrorCode.lowSyncParticipation,
          slot: item.slot,
          syncP: item.syncP,
          minSyncP: this.successOpts.minSyncParticipation,
        });
      }
    }

    if (this.errors.length > 0) {
      throw Error("Some assertions failed\n" + this.errors.map((error) => renderError(error)).join("\n"));
    }
  }

  async assertHealthyGenesis(): Promise<void> {
    const peerCountByNode = await this.fetchNodesPeerCount();
    if (peerCountByNode.some((peerCount) => peerCount === 0)) {
      throw Error(`Some node peer count is zero ${JSON.stringify(peerCountByNode)}`);
    }
  }

  private async runClock(): Promise<void> {
    let slot = 0;

    while (!this.controller.signal.aborted) {
      await this.waitForSlot(slot);

      this.onClockSlot(slot);
      if (slot % SLOTS_PER_EPOCH === 0) {
        this.onClockEpoch(Math.floor(slot / SLOTS_PER_EPOCH));
      }

      await this.waitForSlot(slot + 2 / 3);
      this.onClockSlot2rd(slot);

      slot++;
    }
  }

  private waitForSlot(slot: Slot): Promise<void> {
    const unixsecAtNextSlot = slot * this.config.SECONDS_PER_SLOT + this.genesisTime;
    return sleep(unixsecAtNextSlot * 1000 - Date.now());
  }

  private onClockSlot(slot: Slot): void {
    this.logPrevMissedSlots(slot);

    this.checkPeerCount(slot).catch((e) => {
      console.error("Error on assertPeerCount", e);
    });
  }

  private onClockEpoch(epoch: Epoch): void {
    const newFork = this.config.forksAscendingEpochOrder.find((fork) => fork.epoch === epoch);
    if (newFork && epoch > 0) {
      console.log(`Forked into ${newFork.name}`);
    }
  }

  private onClockSlot2rd(_slot: Slot): void {
    this.assertAllNodesHaveSameHead();
  }

  private async checkPeerCount(slot: Slot): Promise<void> {
    const minPeerCount = this.beaconNodes.length - 1;
    const peerCountByNode = await this.fetchNodesPeerCount();

    for (const [i, peerCount] of peerCountByNode.entries()) {
      if (peerCount < minPeerCount) {
        this.errors.push({code: ErrorCode.lowPeerCount, slot, node: i, peerCount, minPeerCount});
      }
    }
  }

  private async onHead(
    event: routes.events.EventData[routes.events.EventType.head],
    node: BeaconParticipant
  ): Promise<void> {
    const onHeadTime = this.formatEpochSlotTime();
    const {slot, block, state} = event;

    this.headPerNode.set(node.nodeIndex, {slot, block});

    const blocksPerNode = this.headPerSlot.getOrDefault(slot);
    blocksPerNode.set(node.nodeIndex, {slot, block});

    // Log previous missed slots if any. NOTE: This does not cover re-orgs
    this.logPrevMissedSlots(slot);

    // First time seeing this block, track warnings + log
    if (!this.seenHeadBlockRoots.has(event.block)) {
      this.seenHeadBlockRoots.add(event.block);
      this.seenHeadBlockSlots.add(event.slot);

      // Retrieve by root to get exactly this head
      const {data: block} = await node.api.beacon.getBlockV2(event.block);

      const attnPCount = getBlockAttestationParticipantCount(block.message);
      const attnIncScore = getBlockAttestationInclusionScore(block.message);
      const attnIncScoreBad = attnIncScore > this.successOpts.maxAttestationInclusionScore;

      // Don't count sync participation for the first slot of altair fork, see https://github.com/ethereum/consensus-specs/pull/3023
      const isFirstAltairSlot = slot === computeStartSlotAtEpoch(this.config.ALTAIR_FORK_EPOCH);
      const syncPMin = this.successOpts.minSyncParticipation;
      const syncP = getBlockSyncCommitteeParticipation(this.config, block.message);
      const syncPBad = syncP !== null && !isFirstAltairSlot && syncP < syncPMin;

      if (attnIncScoreBad) {
        this.errors.push({code: ErrorCode.inclusionScore, slot, attnIncScore});
      }
      if (syncPBad) {
        this.lowSyncParticipation.push({slot, syncP});
      }

      this.onHeadTable.printRow({
        time: onHeadTime,
        slot: block.message.slot,
        block: event.block,
        proposer: block.message.proposerIndex,
        attnPCount,
        attnIncScore: {value: attnIncScore, bad: attnIncScoreBad},
        syncP: syncP === null ? "-" : {value: toPercent(syncP), bad: syncPBad},
        peerCounts: this.getPeerCountAvgRow(),
      });

      // If this is the first seen block in an epoch, count participation on the epoch before
      const epoch = computeEpochAtSlot(slot);
      if (!this.seenHeadBlockEpochs.has(epoch) && epoch > 0) {
        this.seenHeadBlockEpochs.add(epoch);
        this.assertEpochParticipation(epoch - 1, node.nodeIndex, state).catch((e) => {
          console.error("Error on runEndOfEpochAssertions", e);
        });
      }
    }

    if (blocksPerNode.size >= this.beaconNodes.length) {
      // All nodes have seen this head
      // TODO: track time it took
    }
  }

  private async assertEpochParticipation(epoch: Epoch, nodeId: NodeId, stateRoot: RootHex): Promise<void> {
    const stateBytes = await this.beaconNodes[nodeId].api.debug.getStateV2(stateRoot, "ssz");
    const state = getStateTypeFromBytes(this.config, stateBytes).deserialize(stateBytes);

    const stateSlot = state.slot;
    const forkSeq = this.config.getForkSeq(stateSlot);
    if (forkSeq >= ForkSeq.altair) {
      // Attestation to be computed at the end of epoch. At that time the "currentEpochParticipation" is all set to zero
      // and we have to use "previousEpochParticipation" instead.
      const participation = computeAltairEpochParticipation(state as altair.BeaconState, epoch);

      console.log(
        [
          "Epoch participation",
          `stateSlot: ${stateSlot}`,
          `source: ${toPercent(participation.source)}`,
          `target: ${toPercent(participation.target)}`,
          `head: ${toPercent(participation.head)}`,
        ].join(" ")
      );

      for (const flag of participationFlags) {
        if (participation[flag] < this.successOpts.minEpochParticipation[flag]) {
          this.errors.push({
            code: ErrorCode.lowEpochParticipation,
            stateSlot,
            epoch,
            flag,
            participation: participation[flag],
          });
        }
      }
    }
  }

  private assertAllNodesHaveSameHead(): void {
    const {highestHead, highestHeadNode, heads} = this.getHighestHead();

    for (let i = 0; i < heads.length; i++) {
      if (heads[i].block !== highestHead.block) {
        this.errors.push({
          code: ErrorCode.notSameHead,
          time: this.formatEpochSlotTime(),
          nodeA: highestHeadNode,
          headA: highestHead,
          nodeB: i,
          headB: heads[i],
        });
      }
    }
  }

  private getHighestHead(): {highestHead: HeadSummary; highestHeadNode: NodeId; heads: HeadSummary[]} {
    const heads: HeadSummary[] = [];
    let highestHeadNode = 0;
    let highestHead = genesisHead;

    for (let i = 0; i < this.beaconNodes.length; i++) {
      const head = this.headPerNode.get(i) ?? genesisHead;
      heads.push(head);

      if (head.slot > highestHead.slot) {
        highestHeadNode = i;
        highestHead = head;
      }
    }

    return {highestHead, highestHeadNode, heads};
  }

  private logPrevMissedSlots(slot: Slot): void {
    for (let prevSlot = slot - 1; prevSlot > 0; prevSlot--) {
      if (this.seenHeadBlockSlots.has(prevSlot)) {
        break;
      } else if (!this.loggedMissedSlots.has(prevSlot)) {
        this.errors.push({code: ErrorCode.missedSlot, slot: prevSlot});
        this.onHeadTable.printRow({
          time: this.formatEpochSlotTime(),
          slot: prevSlot,
          block: "-",
          proposer: "-",
          attnPCount: "-",
          attnIncScore: "-",
          syncP: "-",
          peerCounts: this.getPeerCountAvgRow(),
        });
        // Prevent this missed slot from being logged again
        this.loggedMissedSlots.add(prevSlot);
      }
    }
  }

  private getPeerCountAvgRow(): string {
    return Array.from(this.peerCountByNode.values()).join(",");
  }

  private fetchNodesPeerCount(): Promise<number[]> {
    return Promise.all(
      this.beaconNodes.map(async (node) => {
        const {connected} = (await node.api.node.getPeerCount()).data;
        this.peerCountByNode.set(node.nodeIndex, connected);
        return connected;
      })
    );
  }

  private onFinalizedCheckpoint(
    _event: routes.events.EventData[routes.events.EventType.finalizedCheckpoint],
    _node: BeaconParticipant
  ): void {
    // TODO: Add checkpoint tracking
  }

  /**
   * Formats time as: `EPOCH/SLOT_INDEX SECONDS.MILISECONDS
   * - epoch 2 digits most
   * - / 1 char
   * - slot 1 digit most
   * - \s 1 char
   * - seconds (X.YY) 4 char most
   * 2+1+1+1+4 = 9
   */
  private formatEpochSlotTime(): string {
    return formatEpochSlotTime(this.genesisTime, this.config);
  }
}

function toPercent(fraction: number): string {
  return String(Math.round(100 * fraction)) + "%";
}

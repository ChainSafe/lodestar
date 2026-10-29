import {BeaconConfig} from "@lodestar/config";
import {GoldilocksNode, GoldilocksStore, HeadVoteSummary} from "@lodestar/fork-choice";
import {HEAD_VOTE_COMMITTEE_SIZE, PAYLOAD_STATUS_FULL, PAYLOAD_STATUS_PENDING} from "@lodestar/params";
import {
  CachedBeaconStateEip8453,
  IBeaconStateView,
  computeStartSlotAtEpoch,
  getHeadVoteCommittee,
  readHeightCheckpoint,
} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot, eip8453} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {asCachedStateEip8453} from "./state.js";

/**
 * [EIP8453] Runs the Goldilocks fork choice over the legacy ProtoArray: every imported post-fork block and every
 * head vote feed the store, the store's AC voting head and FG inputs drive the validator duties, and once the store
 * is active its head is the canonical head (`ForkChoiceOpts.headOverride`), so proposals, the engine's forkchoice
 * and the head state follow it. The ProtoArray keeps the tree, the checkpoints and the pruning.
 */
export class GoldilocksTracker {
  private store: GoldilocksStore | null = null;
  /** Highest slot of a post-fork block imported so far: the data the node has, as opposed to the head it chose */
  private latestImported: Slot = 0;

  constructor(
    private readonly config: BeaconConfig,
    private readonly genesisTimeSec: number,
    private readonly logger: Logger
  ) {}

  get active(): boolean {
    return this.store !== null;
  }

  getStore(): GoldilocksStore | null {
    return this.store;
  }

  /** ms since genesis, the store's clock */
  now(): number {
    return Date.now() - this.genesisTimeSec * 1000;
  }

  /**
   * Feed an imported block. The first post-fork block activates the store with its parent as the anchor, carrying
   * the finality gadget heights the upgraded state starts from.
   */
  onBlockImported(block: SignedBeaconBlock, postState: IBeaconStateView, parentRoot: RootHex): void {
    const state = asCachedStateEip8453(postState);
    const fg = fgSummary(state);
    const slot = block.message.slot;
    if (slot > this.latestImported) this.latestImported = slot;
    const root = toRootHex(this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
    if (this.store === null) {
      this.store = new GoldilocksStore({root: parentRoot, slot: slot - 1, fg}, this.now(), {
        slotDurationMs: this.config.getSlotDurationMs(this.config.getForkName(slot)),
        committeeSize: HEAD_VOTE_COMMITTEE_SIZE,
        forkSlot: computeStartSlotAtEpoch(this.config.EIP8453_FORK_EPOCH),
      });
      this.logger.info("Goldilocks fork choice activated", {anchorRoot: parentRoot, anchorSlot: slot - 1, slot});
    }
    const body = block.message.body as eip8453.BeaconBlockBody;
    const headVotes = body.headVotes.flatMap((vote, i) => {
      const support = body.headVoteSupport[i];
      const seatsByVoter = countSeats(state, vote.data.slot);
      return vote.voterIndices.map((validator, j) => ({
        validator,
        slot: vote.data.slot,
        root: toRootHex(vote.data.beaconBlockRoot),
        payloadStatus: vote.data.payloadStatus,
        seats: seatsByVoter.get(validator) ?? 1,
        supported: support.get(j),
      }));
    });
    try {
      this.store.insertBlock({root, slot, parentRoot, fg, headVotes}, this.now());
    } catch (e) {
      this.logger.warn("Goldilocks store rejected block", {slot, root}, e as Error);
    }
  }

  /** Feed a validated head vote; `state` resolves the voter's seats in the slot's committee */
  onHeadVote(message: eip8453.HeadVoteMessage, state: CachedBeaconStateEip8453): void {
    if (this.store === null) return;
    const vote: HeadVoteSummary = {
      validator: message.validatorIndex,
      slot: message.data.slot,
      root: toRootHex(message.data.beaconBlockRoot),
      payloadStatus: message.data.payloadStatus,
      seats: countSeats(state, message.data.slot).get(message.validatorIndex) ?? 1,
    };
    this.store.processHeadVote(vote, this.now());
  }

  /** Slot of the newest imported post-fork block, 0 before the fork */
  latestImportedSlot(): Slot {
    return this.latestImported;
  }

  /**
   * The store's head now, for the legacy fork choice's `headOverride`: before `2Δ` of the current slot the previous
   * slot's votes decide, which is also the proposer's parent at the start of a slot.
   */
  canonicalHeadRoot(): RootHex | null {
    return this.store?.head(this.now()).root ?? null;
  }

  /** The AC voting head recorded at Δ of `slot`, or null before activation or when the duty was not recorded */
  voteHead(slot: Slot): GoldilocksNode | null {
    return this.store?.vote(slot, this.now()) ?? null;
  }

  /** The FG source and head recorded at 2Δ of `slot` */
  fgInputs(slot: Slot): {source: GoldilocksNode; head: GoldilocksNode} | null {
    return this.store?.fgInputs(slot, this.now()) ?? null;
  }

  /** Payload status of a head vote for `node` at `slot`: PENDING for the slot's own block, else FULL (no empty payloads yet) */
  payloadStatusFor(node: GoldilocksNode, slot: Slot): number {
    return node.slot === slot ? PAYLOAD_STATUS_PENDING : PAYLOAD_STATUS_FULL;
  }

  /** Log the store's view once per slot */
  logSlot(slot: Slot, legacyHeadRoot: RootHex): void {
    const store = this.store;
    if (store === null) return;
    const now = this.now();
    const head = store.head(now);
    const confirmed = store.confirmed(now);
    this.logger.info("Goldilocks view", {
      slot,
      head: `${head.slot}:${head.root.slice(0, 10)}`,
      canonical: head.root === legacyHeadRoot,
      confirmed: `${confirmed.slot}:${confirmed.root.slice(0, 10)}`,
      locks: store
        .liveLocks(now)
        .map((n) => `${n.slot}:${n.root.slice(0, 10)}`)
        .join(","),
      hJ: store.hJ,
      hF: store.hF,
      hMax: store.hMax,
      blocks: store.nodes.size,
    });
  }
}

function fgSummary(state: CachedBeaconStateEip8453): {
  targetHeight: number;
  justified: {height: number; root: RootHex};
  finalized: {height: number; root: RootHex};
} {
  const justified = readHeightCheckpoint(state.justifiedCheckpoint);
  const finalized = readHeightCheckpoint(state.finalizedCheckpoint);
  return {
    targetHeight: state.targetCheckpoint.height,
    justified: {height: justified.height, root: toRootHex(justified.root)},
    finalized: {height: finalized.height, root: toRootHex(finalized.root)},
  };
}

/** Seats per validator in the head vote committee of `slot`, from the state's committee window */
function countSeats(state: CachedBeaconStateEip8453, slot: Slot): Map<number, number> {
  const seats = new Map<number, number>();
  try {
    for (const index of getHeadVoteCommittee(state, slot)) seats.set(index, (seats.get(index) ?? 0) + 1);
  } catch (_e) {
    // slot outside the window: every voter counts one seat
  }
  return seats;
}

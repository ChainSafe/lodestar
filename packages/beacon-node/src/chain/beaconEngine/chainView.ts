import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Root} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ChainViewBlock, ChainViewSnapshot, ChainViewState, ChainViewUpdate} from "../chainView/interface.js";

export function toChainViewBlock(block: ProtoBlock): ChainViewBlock {
  return {
    blockRoot: block.blockRoot,
    slot: block.slot,
    parentRoot: block.parentRoot,
    stateRoot: block.stateRoot,
    parentBlockHash: block.parentBlockHash,
    payloadStatus: block.payloadStatus,
    executionPayloadBlockHash: block.executionPayloadBlockHash,
    executionPayloadNumber: "executionPayloadNumber" in block ? block.executionPayloadNumber : undefined,
  };
}

export function toChainViewBlockBytes(block: ProtoBlock): ChainViewBlock<Root> {
  return {
    ...toChainViewBlock(block),
    blockRoot: fromHex(block.blockRoot),
    parentRoot: fromHex(block.parentRoot),
    stateRoot: fromHex(block.stateRoot),
    parentBlockHash: block.parentBlockHash === null ? null : fromHex(block.parentBlockHash),
    executionPayloadBlockHash:
      block.executionPayloadBlockHash === null ? null : fromHex(block.executionPayloadBlockHash),
  };
}

/** Captures mutable fork-choice metadata before publishing detached updates. */
export class ChainViewPublisher {
  private revision = 0;
  private previousState?: ChainViewState;
  private blocks = new Map<string, ChainViewBlock>();

  constructor(
    private readonly forkChoice: Pick<
      IForkChoice,
      "getAllNodes" | "getHead" | "getJustifiedCheckpoint" | "getFinalizedCheckpoint"
    >
  ) {}

  snapshot(): ChainViewSnapshot {
    const blocks = this.forkChoice.getAllNodes().map(toChainViewBlock);
    this.blocks = new Map(blocks.map((block) => [this.key(block), block]));
    this.previousState = structuredClone(this.state());
    return structuredClone({revision: this.revision, blocks, ...this.previousState});
  }

  // TODO - beacon engine: sloppy code, need to review later
  update(blocksChanged = true): ChainViewUpdate | null {
    const blocks: ChainViewBlock[] = [];
    const current = new Map<string, ChainViewBlock>();
    for (const node of blocksChanged ? this.forkChoice.getAllNodes() : []) {
      const block = toChainViewBlock(node);
      const key = this.key(block);
      const previous = this.blocks.get(key);
      if (
        !previous ||
        (Object.keys(block) as (keyof ChainViewBlock)[]).some((field) => block[field] !== previous[field])
      )
        blocks.push(block);
      current.set(key, block);
    }
    if (blocksChanged) this.blocks = current;
    const state = this.state();
    const previous = this.previousState;
    if (
      previous &&
      blocks.length === 0 &&
      (Object.keys(state.head) as (keyof ChainViewBlock)[]).every(
        (field) => state.head[field] === previous.head[field]
      ) &&
      state.justified.epoch === previous.justified.epoch &&
      state.justified.rootHex === previous.justified.rootHex &&
      state.finalized.epoch === previous.finalized.epoch &&
      state.finalized.rootHex === previous.finalized.rootHex
    )
      return null;
    this.previousState = structuredClone(state);
    return structuredClone({revision: ++this.revision, blocks, ...state});
  }

  private state(): ChainViewState {
    const head = this.forkChoice.getHead();
    return {
      head: toChainViewBlock(head),
      justified: this.forkChoice.getJustifiedCheckpoint(),
      finalized: this.forkChoice.getFinalizedCheckpoint(),
    };
  }

  private key(block: ChainViewBlock): string {
    return `${block.blockRoot}:${block.payloadStatus}`;
  }
}

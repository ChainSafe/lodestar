import {toHexString, fromHexString} from "@chainsafe/ssz";
import {ITreeStateContext} from "./stateContextCache";

/**
 * Checkpoint state is state of 1st block of each epoch.
 */
export class CheckpointStateCache {
  // TODO: cache epoch to state root to produce weak subjectivity checkpoint state
  // checkpoint state by root
  private statesByRoot: Record<string, ITreeStateContext>;
  // map a state root to its parent state root
  private stateRootToParent: Record<string, string>;

  constructor() {
    this.statesByRoot = {};
    this.stateRootToParent = {};
  }

  /**
   * Return checkpoint state from a state root.
   */
  public async get(stateRoot: Uint8Array): Promise<ITreeStateContext | null> {
    const item = this.statesByRoot[toHexString(stateRoot)];
    if (!item) {
      return null;
    }
    return this.clone(item);
  }

  /**
   * Get state roots of parent until a checkpoint state.
   * A -> B -> C -> D then getStateRootAncestors(D) returns [A, B, C, D] where A is checkpoint state.
   */
  public async getStateRootAncestors(stateRoot: Uint8Array): Promise<Uint8Array[] | null> {
    return getStateRootAncestors(stateRoot, this.statesByRoot, this.stateRootToParent);
  }

  public async add(item: ITreeStateContext): Promise<void> {
    const root = toHexString(item.state.hashTreeRoot());
    this.statesByRoot[root] = this.clone(item);
    this.stateRootToParent[root] = root;
  }

  public async addStateRoot(stateRoot: Uint8Array, parentStateRoot: Uint8Array): Promise<void> {
    this.stateRootToParent[toHexString(stateRoot)] = toHexString(parentStateRoot);
  }

  public async delete(root: Uint8Array): Promise<void> {
    const rootHex = toHexString(root);
    delete this.statesByRoot[rootHex];
    delete this.stateRootToParent[rootHex];
  }

  public async batchDelete(roots: Uint8Array[]): Promise<void> {
    await Promise.all(roots.map((root) => this.delete(root)));
  }

  public clear(): void {
    this.statesByRoot = {};
    this.stateRootToParent = {};
  }

  public get size(): number {
    return Object.keys(this.statesByRoot).length;
  }

  // TODO: move to util
  private clone(item: ITreeStateContext): ITreeStateContext {
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx.copy(),
    };
  }
}

export function getStateRootAncestors(
  stateRoot: Uint8Array,
  statesByRoot: Record<string, ITreeStateContext>,
  stateRootToParent: Record<string, string>
): Uint8Array[] | null {
  const keys = Object.keys(statesByRoot);
  let rootHex = toHexString(stateRoot);
  const result: Uint8Array[] = [];
  while (!keys.includes(rootHex) && stateRootToParent[rootHex]) {
    result.unshift(fromHexString(rootHex));
    rootHex = stateRootToParent[rootHex];
  }
  if (keys.includes(rootHex)) {
    result.unshift(fromHexString(rootHex));
    return result;
  } else {
    return null;
  }
}

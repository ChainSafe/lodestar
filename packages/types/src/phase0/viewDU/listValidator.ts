import {
  ListCompositeType,
  ArrayCompositeTreeViewDUCache,
  ListCompositeTreeViewDU,
  ByteViews,
  ContainerNodeStructTreeViewDU,
} from "@chainsafe/ssz";
import {HashComputationLevel, Node, digestNLevel, setNodesAtDepth} from "@chainsafe/persistent-merkle-tree";
import {byteArrayIntoHashObject} from "@chainsafe/as-sha256";
import {ValidatorNodeStructType, ValidatorType, validatorToChunkBytes} from "../validator.js";
import {ValidatorIndex} from "../../types.js";

/**
 * hashtree has a MAX_SIZE of 1024 bytes = 32 chunks
 * Given a level3 of validators have 8 chunks, we can hash 4 validators at a time
 */
const PARALLEL_FACTOR = 4;
/**
 * Allocate memory once for batch hash validators.
 */
// each level 3 of validator has 8 chunks, each chunk has 32 bytes
const batchLevel3Bytes = new Uint8Array(PARALLEL_FACTOR * 8 * 32);
const level3ByteViewsArr: ByteViews[] = [];
for (let i = 0; i < PARALLEL_FACTOR; i++) {
  const uint8Array = batchLevel3Bytes.subarray(i * 8 * 32, (i + 1) * 8 * 32);
  const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  level3ByteViewsArr.push({uint8Array, dataView});
}
// each level 4 of validator has 2 chunks for pubkey, each chunk has 32 bytes
const batchLevel4Bytes = new Uint8Array(PARALLEL_FACTOR * 2 * 32);
const level4BytesArr: Uint8Array[] = [];
for (let i = 0; i < PARALLEL_FACTOR; i++) {
  level4BytesArr.push(batchLevel4Bytes.subarray(i * 2 * 32, (i + 1) * 2 * 32));
}
const pubkeyRoots: Uint8Array[] = [];
for (let i = 0; i < PARALLEL_FACTOR; i++) {
  pubkeyRoots.push(batchLevel4Bytes.subarray(i * 32, (i + 1) * 32));
}

const validatorRoots: Uint8Array[] = [];
for (let i = 0; i < PARALLEL_FACTOR; i++) {
  validatorRoots.push(batchLevel3Bytes.subarray(i * 32, (i + 1) * 32));
}
const validatorRoot = new Uint8Array(32);

/**
 * Similar to ListCompositeTreeViewDU with some differences:
 * - if called without params, it's from hashTreeRoot() api call, no need to compute root
 * - otherwise it's from batchHashTreeRoot() call, compute validator roots in batch
 */
export class ListValidatorTreeViewDU extends ListCompositeTreeViewDU<ValidatorNodeStructType> {
  constructor(
    readonly type: ListCompositeType<ValidatorNodeStructType>,
    protected _rootNode: Node,
    cache?: ArrayCompositeTreeViewDUCache
  ) {
    super(type, _rootNode, cache);
  }

  commit(hcOffset = 0, hcByLevel: HashComputationLevel[] | null = null): void {
    if (hcByLevel === null) {
      // this is not from batchHashTreeRoot() call, go with regular flow
      super.commit();
      return;
    }

    const isOldRootHashed = this._rootNode.h0 !== null;
    if (this.viewsChanged.size === 0) {
      if (!isOldRootHashed && hcByLevel !== null) {
        // not possible to get HashComputations due to BranchNodeStruct
        this._rootNode.root;
      }
      return;
    }

    // TODO - batch: remove this type cast
    const viewsChanged = this.viewsChanged as unknown as Map<
      number,
      ContainerNodeStructTreeViewDU<typeof ValidatorType>
    >;

    const indicesChanged: number[] = [];
    for (const [index, viewChanged] of viewsChanged) {
      // should not have any params here in order not to compute root
      viewChanged.commit();
      // Set new node in nodes array to ensure data represented in the tree and fast nodes access is equal
      this.nodes[index] = viewChanged.node;
      // `validators.get(i)` was called but it may not modify any property, do not need to compute root
      if (viewChanged.node.h0 === null) {
        indicesChanged.push(index);
      }
    }

    // these validators don't have roots, we compute roots in batch
    const sortedIndicesChanged = indicesChanged.sort((a, b) => a - b);
    const nodesChanged: {index: ValidatorIndex; node: Node}[] = new Array(sortedIndicesChanged.length);
    for (const [i, validatorIndex] of sortedIndicesChanged.entries()) {
      nodesChanged[i] = {index: validatorIndex, node: this.nodes[validatorIndex]};
    }
    doBatchHashTreeRootValidators(sortedIndicesChanged, viewsChanged);

    // do the remaining commit step the same to parent (ArrayCompositeTreeViewDU)
    const indexes = nodesChanged.map((entry) => entry.index);
    const nodes = nodesChanged.map((entry) => entry.node);
    const chunksNode = this.type.tree_getChunksNode(this._rootNode);
    const offsetThis = hcOffset + this.type.tree_chunksNodeOffset();
    const byLevelThis = hcByLevel != null && isOldRootHashed ? hcByLevel : null;
    const newChunksNode = setNodesAtDepth(chunksNode, this.type.chunkDepth, indexes, nodes, offsetThis, byLevelThis);

    this._rootNode = this.type.tree_setChunksNode(
      this._rootNode,
      newChunksNode,
      this.dirtyLength ? this._length : null,
      hcOffset,
      hcByLevel
    );

    if (!isOldRootHashed && hcByLevel !== null) {
      // should never happen, handle just in case
      // not possible to get HashComputations due to BranchNodeStruct
      this._rootNode.root;
    }

    this.viewsChanged.clear();
    this.dirtyLength = false;
  }
}

function doBatchHashTreeRootValidators(
  indices: ValidatorIndex[],
  validators: Map<ValidatorIndex, ContainerNodeStructTreeViewDU<typeof ValidatorType>>
): void {
  const endBatch = indices.length - (indices.length % PARALLEL_FACTOR);

  // commit every 16 validators in batch
  for (let i = 0; i < endBatch; i++) {
    if (i % PARALLEL_FACTOR === 0) {
      batchLevel3Bytes.fill(0);
      batchLevel4Bytes.fill(0);
    }
    const indexInBatch = i % PARALLEL_FACTOR;
    const viewIndex = indices[i];
    const validator = validators.get(viewIndex);
    if (validator) {
      validatorToChunkBytes(level3ByteViewsArr[indexInBatch], level4BytesArr[indexInBatch], validator.value);
    }

    if (indexInBatch === PARALLEL_FACTOR - 1) {
      // hash level 4, this is populated to pubkeyRoots
      digestNLevel(batchLevel4Bytes, 1);
      for (let j = 0; j < PARALLEL_FACTOR; j++) {
        level3ByteViewsArr[j].uint8Array.set(pubkeyRoots[j], 0);
      }
      // hash level 3, this is populated to validatorRoots
      digestNLevel(batchLevel3Bytes, 3);
      // commit all validators in this batch
      for (let j = PARALLEL_FACTOR - 1; j >= 0; j--) {
        const viewIndex = indices[i - j];
        const indexInBatch = (i - j) % PARALLEL_FACTOR;
        const viewChanged = validators.get(viewIndex);
        if (viewChanged) {
          const branchNodeStruct = viewChanged.node;
          byteArrayIntoHashObject(validatorRoots[indexInBatch], 0, branchNodeStruct);
        }
      }
    }
  }

  // commit the remaining validators, we can do in batch too but don't want to create new Uint8Array views
  // it's not much different to commit one by one
  for (let i = endBatch; i < indices.length; i++) {
    const viewIndex = indices[i];
    const viewChanged = validators.get(viewIndex);
    if (viewChanged) {
      // compute root for each validator
      viewChanged.type.hashTreeRootInto(viewChanged.value, validatorRoot, 0);
      byteArrayIntoHashObject(validatorRoot, 0, viewChanged.node);
    }
  }
}

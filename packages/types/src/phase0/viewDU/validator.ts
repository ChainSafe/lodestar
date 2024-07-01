import {byteArrayIntoHashObject} from "@chainsafe/as-sha256";
import {Node, digestNLevelUnsafe} from "@chainsafe/persistent-merkle-tree";
import {ByteViews, TreeViewDU, ContainerTypeGeneric, BranchNodeStruct} from "@chainsafe/ssz";
import {ValidatorType} from "../validator.js";
type Validator = {
  pubkey: Uint8Array;
  withdrawalCredentials: Uint8Array;
  effectiveBalance: number;
  slashed: boolean;
  activationEligibilityEpoch: number;
  activationEpoch: number;
  exitEpoch: number;
  withdrawableEpoch: number;
};

const numFields = 8;
const NUMBER_2_POW_32 = 2 ** 32;
/*
 * Below constants are respective to their ssz type in `ValidatorType`.
 */
const UINT32_SIZE = 4;
const CHUNK_SIZE = 32;

// validator has 8 nodes at level 3
const singleLevel3Bytes = new Uint8Array(8 * 32);
const singleLevel3ByteView = {uint8Array: singleLevel3Bytes, dataView: new DataView(singleLevel3Bytes.buffer)};
// validator has 2 nodes at level 4 (pubkey has 48 bytes = 2 * nodes)
const singleLevel4Bytes = new Uint8Array(2 * 32);

/**
 * A specific ViewDU for validator designed to be efficient to batch hash and efficient to create tree
 * because it uses prepopulated nodes to do that.
 */
export class ValidatorTreeViewDU extends TreeViewDU<ContainerTypeGeneric<typeof ValidatorType>> {
  protected valueChanged: Validator | null = null;
  protected _rootNode: BranchNodeStruct<Validator>;

  constructor(
    readonly type: ContainerTypeGeneric<typeof ValidatorType>,
    node: Node
  ) {
    super();
    this._rootNode = node as BranchNodeStruct<Validator>;
  }

  get node(): Node {
    return this._rootNode;
  }

  get cache(): void {
    return;
  }

  /**
   * Commit the changes to the tree, need to hashTreeRoot() because this does not support batch hash
   */
  commit(): void {
    if (this.valueChanged !== null) {
      this._rootNode = this.type.value_toTree(this.valueChanged) as BranchNodeStruct<Validator>;
    }

    if (this._rootNode.h0 === null) {
      this.valueToMerkleBytes(singleLevel3ByteView, singleLevel4Bytes);
      // level 4 hash
      const pubkeyRoot = digestNLevelUnsafe(singleLevel4Bytes, 1);
      if (pubkeyRoot.length !== 32) {
        throw new Error(`Invalid pubkeyRoot length, expect 32, got ${pubkeyRoot.length}`);
      }
      singleLevel3ByteView.uint8Array.set(pubkeyRoot, 0);
      // level 3 hash
      const validatorRoot = digestNLevelUnsafe(singleLevel3ByteView.uint8Array, 3);
      if (validatorRoot.length !== 32) {
        throw new Error(`Invalid validatorRoot length, expect 32, got ${validatorRoot.length}`);
      }
      byteArrayIntoHashObject(validatorRoot, this._rootNode);
    }
    this.valueChanged = null;
  }

  get pubkey(): Uint8Array {
    return (this.valueChanged || this._rootNode.value).pubkey;
  }

  set pubkey(value: Uint8Array) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.pubkey = value.slice();
  }

  get withdrawalCredentials(): Uint8Array {
    return (this.valueChanged || this._rootNode.value).withdrawalCredentials;
  }

  set withdrawalCredentials(value: Uint8Array) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.withdrawalCredentials = value.slice();
  }

  get effectiveBalance(): number {
    return (this.valueChanged || this._rootNode.value).effectiveBalance;
  }

  set effectiveBalance(value: number) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.effectiveBalance = value;
  }

  get slashed(): boolean {
    return (this.valueChanged || this._rootNode.value).slashed;
  }

  set slashed(value: boolean) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.slashed = value;
  }

  get activationEligibilityEpoch(): number {
    return (this.valueChanged || this._rootNode.value).activationEligibilityEpoch;
  }

  set activationEligibilityEpoch(value: number) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.activationEligibilityEpoch = value;
  }

  get activationEpoch(): number {
    return (this.valueChanged || this._rootNode.value).activationEpoch;
  }

  set activationEpoch(value: number) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.activationEpoch = value;
  }

  get exitEpoch(): number {
    return (this.valueChanged || this._rootNode.value).exitEpoch;
  }

  set exitEpoch(value: number) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.exitEpoch = value;
  }

  get withdrawableEpoch(): number {
    return (this.valueChanged || this._rootNode.value).withdrawableEpoch;
  }

  set withdrawableEpoch(value: number) {
    if (this.valueChanged === null) {
      this.valueChanged = this.type.clone(this._rootNode.value);
    }

    this.valueChanged.withdrawableEpoch = value;
  }

  /**
   * Write to level3 and level4 bytes to compute merkle root. Note that this is to compute
   * merkle root and it's different from serialization (which is more compressed).
   * pub0 + pub1 are at level4, they will be hashed to 1st chunked of level 3
   * then use 8 chunks of level 3 to compute the root hash.
   *           reserved     withdr     eff        sla        actElig    act        exit       with
   * level 3 |----------|----------|----------|----------|----------|----------|----------|----------|
   *
   *            pub0       pub1
   * level4  |----------|----------|
   *
   */
  valueToMerkleBytes(level3: ByteViews, level4: Uint8Array): void {
    if (level3.uint8Array.byteLength !== 8 * CHUNK_SIZE) {
      throw Error(`Expected level3 to be 8 * CHUNK_SIZE bytes, got ${level3.uint8Array.byteLength}`);
    }
    if (level4.length !== 2 * CHUNK_SIZE) {
      throw Error(`Expected level4 to be 2 * CHUNK_SIZE bytes, got ${level4.length}`);
    }
    // in case pushing a new validator to array, valueChanged could be null
    const value = this.valueChanged ?? this._rootNode.value;
    validatorToMerkleBytes(level3, level4, value);
  }

  /**
   * Batch hash flow: parent will compute hash and call this function
   */
  commitToRoot(root: Uint8Array): void {
    // this.valueChanged === null means this viewDU is new
    if (this.valueChanged !== null) {
      this._rootNode = this.type.value_toTree(this.valueChanged) as BranchNodeStruct<Validator>;
    }
    byteArrayIntoHashObject(root, this._rootNode);
    this.valueChanged = null;
  }

  protected clearCache(): void {
    this.valueChanged = null;
  }

  get name(): string {
    return this.type.typeName;
  }
}

/**
 * Write to level3 and level4 bytes to compute merkle root. Note that this is to compute
 * merkle root and it's different from serialization (which is more compressed).
 * pub0 + pub1 are at level4, they will be hashed to 1st chunked of level 3
 * then use 8 chunks of level 3 to compute the root hash.
 *           reserved     withdr     eff        sla        actElig    act        exit       with
 * level 3 |----------|----------|----------|----------|----------|----------|----------|----------|
 *
 *            pub0       pub1
 * level4  |----------|----------|
 *
 */
export function validatorToMerkleBytes(level3: ByteViews, level4: Uint8Array, value: Validator): void {
  const {
    pubkey,
    withdrawalCredentials,
    effectiveBalance,
    slashed,
    activationEligibilityEpoch,
    activationEpoch,
    exitEpoch,
    withdrawableEpoch,
  } = value;
  const {uint8Array: outputLevel3, dataView} = level3;

  // pubkey = 48 bytes which is 2 * CHUNK_SIZE
  level4.set(pubkey, 0);
  let offset = CHUNK_SIZE;
  outputLevel3.set(withdrawalCredentials, offset);
  offset += CHUNK_SIZE;
  // effectiveBalance is UintNum64
  dataView.setUint32(offset, effectiveBalance & 0xffffffff, true);
  dataView.setUint32(offset + 4, (effectiveBalance / NUMBER_2_POW_32) & 0xffffffff, true);

  offset += CHUNK_SIZE;
  // output[offset] = validator.slashed ? 1 : 0;
  dataView.setUint32(offset, slashed ? 1 : 0, true);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, activationEligibilityEpoch);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, activationEpoch);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, exitEpoch);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, withdrawableEpoch);
}


/**
 * Write an epoch to DataView at offset.
 */
function writeEpochInf(dataView: DataView, offset: number, value: number): void {
  if (value === Infinity) {
    dataView.setUint32(offset, 0xffffffff, true);
    offset += UINT32_SIZE;
    dataView.setUint32(offset, 0xffffffff, true);
    offset += UINT32_SIZE;
  } else {
    dataView.setUint32(offset, value & 0xffffffff, true);
    offset += UINT32_SIZE;
    dataView.setUint32(offset, (value / NUMBER_2_POW_32) & 0xffffffff, true);
    offset += UINT32_SIZE;
  }
}

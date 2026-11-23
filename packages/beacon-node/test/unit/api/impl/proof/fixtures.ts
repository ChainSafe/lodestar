import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {concatGindices} from "@chainsafe/persistent-merkle-tree";
import {
  ArrayType,
  BitArray,
  BitListType,
  BitVectorType,
  BooleanType,
  ByteListType,
  ByteVectorType,
  CompositeType,
  ContainerNodeStructType,
  ContainerType,
  ProgressiveBitListType,
  ProgressiveByteListType,
  ProgressiveContainerType,
  ProgressiveSerializedListType,
  SerializedList,
  SerializedListType,
  Type,
  UintBigintType,
  UintNumberType,
} from "@chainsafe/ssz";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {fulu, gloas, ssz} from "@lodestar/types";

export const proofConfig = getConfig(ForkName.gloas, 2);
export const proofForkSlot = 2 * SLOTS_PER_EPOCH;
export const proofForks = [ForkName.fulu, ForkName.gloas] as const;
export type ProofFork = (typeof proofForks)[number];
export type ProofTarget = {path: string; gindex: bigint; root: Uint8Array};

type FieldContainer =
  | ContainerType<Record<string, Type<unknown>>>
  | ProgressiveContainerType<Record<string, Type<unknown>>>;

function isFieldContainer(type: Type<unknown>): type is FieldContainer {
  return type instanceof ContainerType || type instanceof ProgressiveContainerType;
}

export function populatedValue(type: Type<unknown>, path = "", populated = true): unknown {
  if (type instanceof SerializedListType || type instanceof ProgressiveSerializedListType) {
    return SerializedList.fromArray(populatedValue(type.inner, path, populated) as Uint8Array[]);
  }
  const seed = createHash("sha256").update(path).digest();
  if (type instanceof UintNumberType) return seed.readUInt16LE() % (type.byteLength === 1 ? 255 : 65535);
  if (type instanceof UintBigintType) return BigInt(seed.readUInt16LE());
  if (type instanceof BooleanType) return (seed[0] & 1) === 1;
  if (type instanceof ByteVectorType || type instanceof ByteListType || type instanceof ProgressiveByteListType) {
    const length = type instanceof ByteVectorType ? type.lengthBytes : populated ? Math.min(type.limitBytes, 705) : 0;
    return Uint8Array.from({length}, (_, i) => seed[i % 32] ^ (i >>> 5));
  }
  if (type instanceof BitVectorType || type instanceof BitListType || type instanceof ProgressiveBitListType) {
    const length = type instanceof BitVectorType ? type.lengthBits : populated ? Math.min(type.limitBits, 5633) : 0;
    const bits = BitArray.fromBitLen(length);
    for (let i = 0; i < length; i++) bits.set(i, (seed[i % 32] & 1) === 1);
    return bits;
  }
  if (isFieldContainer(type)) {
    return Object.fromEntries(
      Object.entries(type.fields).map(([key, field]) => [key, populatedValue(field, `${path}.${key}`, populated)])
    );
  }
  if (type instanceof ArrayType) {
    const length =
      "length" in type && typeof type.length === "number"
        ? type.length
        : populated
          ? Math.min(
              "limit" in type && typeof type.limit === "number" ? type.limit : 2,
              path.split(".").length === 2 ? 22 * type.itemsPerChunk : 2
            )
          : 0;
    return Array.from({length}, (_, i) => populatedValue(type.elementType, `${path}[${i}]`, populated));
  }
  throw Error(`Missing proof fixture for ${path}: ${type.typeName}`);
}

export function createProofFixture(fork: ProofFork, populated = true) {
  const stateType: CompositeType<fulu.BeaconState | gloas.BeaconState, unknown, unknown> &
    Pick<FieldContainer, "fields"> = ssz[fork].BeaconState;
  const state = populatedValue(stateType, "state", populated) as ReturnType<typeof stateType.defaultValue>;
  state.slot = fork === ForkName.fulu ? proofForkSlot - 1 : proofForkSlot;
  state.genesisTime = 0;
  state.fork = {
    previousVersion: proofConfig.FULU_FORK_VERSION,
    currentVersion: proofConfig.getForkVersion(state.slot),
    epoch: 2,
  };
  state.validators = Array.from({length: 88}, (_, i) => ({
    ...ssz.phase0.Validator.defaultValue(),
    pubkey: SecretKey.fromBytes(Buffer.alloc(32, i + 1))
      .toPublicKey()
      .toBytes(),
    withdrawalCredentials: createHash("sha256").update(`credentials:${i}`).digest(),
    effectiveBalance: 32_000_000_000 + i,
    slashed: i % 2 === 1,
    activationEligibilityEpoch: i + 10,
    activationEpoch: 0,
    exitEpoch: i + 20,
    withdrawableEpoch: i + 276,
  }));
  state.balances = state.validators.map((_, i) => 32_000_000_000 + i * 1234567);
  state.previousEpochParticipation = state.validators.map((_, i) => i % 8);
  state.currentEpochParticipation = state.validators.map((_, i) => (i + 1) % 8);
  state.inactivityScores = state.validators.map((_, i) => i + 1000);
  for (const committee of [state.currentSyncCommittee, state.nextSyncCommittee]) {
    committee.pubkeys = committee.pubkeys.map((_, i) => state.validators[i % state.validators.length].pubkey);
  }
  state.proposerLookahead = state.proposerLookahead.map((_, i) => i % state.validators.length);
  const blockType: CompositeType<fulu.BeaconBlock | gloas.BeaconBlock, unknown, unknown> &
    Pick<FieldContainer, "fields"> = ssz[fork].BeaconBlock;
  const block = populatedValue(blockType, "block", populated) as ReturnType<typeof blockType.defaultValue>;
  block.slot = state.slot;
  block.proposerIndex = 3;
  const bodyType: Type<fulu.BeaconBlock["body"] | gloas.BeaconBlock["body"]> = ssz[fork].BeaconBlockBody;
  // A post-block state leaves this root zero to avoid a circular state commitment.
  state.latestBlockHeader = {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    bodyRoot: bodyType.hashTreeRoot(block.body),
    stateRoot: new Uint8Array(32),
  };
  block.stateRoot = stateType.hashTreeRoot(state);
  return {stateType, state, blockType, block};
}

export function schemaManifest(type: Type<unknown>, path = ""): string[] {
  if (type instanceof SerializedListType || type instanceof ProgressiveSerializedListType) type = type.inner;
  const result = [`${path || "."}: ${type.typeName}`];
  if (isFieldContainer(type)) {
    for (const [key, field] of Object.entries(type.fields)) result.push(...schemaManifest(field, `${path}.${key}`));
  } else if (type instanceof ArrayType) {
    result.push(...schemaManifest(type.elementType, `${path}[]`));
  }
  return result;
}

export function proofTargets(type: Type<unknown>, value: unknown, path = "", gindex = 1n): ProofTarget[] {
  if (type instanceof SerializedListType || type instanceof ProgressiveSerializedListType) {
    assert(value instanceof SerializedList);
    return proofTargets(type.inner, value.toArray(), path, gindex);
  }
  const targets: ProofTarget[] = [{path: path || ".", gindex, root: type.hashTreeRoot(value)}];
  if (type instanceof ContainerNodeStructType) type = new ContainerType(type.fields);
  if (isFieldContainer(type)) {
    for (const [key, field] of Object.entries(type.fields)) {
      const childGindex = type.getPropertyGindex(key);
      assert(childGindex !== null);
      targets.push(
        ...proofTargets(
          field,
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
          concatGindices([gindex, childGindex])
        )
      );
    }
    if (type instanceof ProgressiveContainerType) {
      const root = new Uint8Array(32);
      root.set(type.activeFields.uint8Array);
      targets.push({path: `${path}.$activeFields`, gindex: concatGindices([gindex, 3n]), root});
    }
  } else if (type instanceof ArrayType) {
    const values = value as unknown[];
    if (type.isList)
      targets.push({
        path: `${path}.$length`,
        gindex: concatGindices([gindex, 3n]),
        root: ssz.UintNum64.hashTreeRoot(values.length),
      });
    const indices = [
      ...new Set([
        0,
        1,
        2,
        3,
        4,
        5,
        20,
        21,
        84,
        85,
        values.length - 1,
        ...[1, 5, 21].flatMap((chunk) => [chunk * type.itemsPerChunk - 1, chunk * type.itemsPerChunk]),
      ]),
    ].filter((i) => i >= 0 && i < values.length);
    for (const i of indices) {
      const childGindex = concatGindices([gindex, type.getPropertyGindex(i)]);
      if (type.elementType.isBasic) {
        const root = new Uint8Array(32);
        const first = i - (i % type.itemsPerChunk);
        for (let lane = 0; lane < type.itemsPerChunk && first + lane < values.length; lane++) {
          root.set(type.elementType.serialize(values[first + lane]), lane * (type.elementType.fixedSize ?? 0));
        }
        targets.push({path: `${path}[${i}]`, gindex: childGindex, root});
      } else {
        targets.push(...proofTargets(type.elementType, values[i], `${path}[${i}]`, childGindex));
      }
    }
  } else if (
    type instanceof ByteVectorType ||
    type instanceof ByteListType ||
    type instanceof ProgressiveByteListType ||
    type instanceof BitVectorType ||
    type instanceof BitListType ||
    type instanceof ProgressiveBitListType
  ) {
    const bytes = value instanceof BitArray ? value.uint8Array : (value as Uint8Array);
    const length = value instanceof BitArray ? value.bitLen : bytes.length;
    const list = type.isList;
    const progressive = type instanceof ProgressiveByteListType || type instanceof ProgressiveBitListType;
    if (list)
      targets.push({
        path: `${path}.$length`,
        gindex: concatGindices([gindex, 3n]),
        root: ssz.UintNum64.hashTreeRoot(length),
      });
    const chunkCount = Math.ceil(bytes.length / 32);
    for (const index of [...new Set([0, 1, 4, 5, 20, 21, chunkCount - 1])].filter((i) => i >= 0 && i < chunkCount)) {
      const root = new Uint8Array(32);
      root.set(bytes.subarray(index * 32, (index + 1) * 32));
      const child = progressive
        ? concatGindices([2n, progressiveIndex(BigInt(index))])
        : BigInt(2 ** type.depth + index);
      targets.push({path: `${path}.$chunk${index}`, gindex: concatGindices([gindex, child]), root});
    }
  }
  return targets;
}

// Progressive chunks occupy successive subtrees of 1, 4, 16, ... leaves.
export function progressiveIndex(index: bigint): bigint {
  let capacity = 1n;
  let branch = 1n;
  while (index >= capacity) {
    index -= capacity;
    capacity *= 4n;
    branch = branch * 2n + 1n;
  }
  return branch * 2n * capacity + index;
}

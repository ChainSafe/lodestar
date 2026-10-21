import {afterEach, describe, expect, expectTypeOf, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {Root, RootHex, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  SignedBlockRoot,
  SignedBlockRootHex,
  computeSignedBlockRoot,
  toSignedBlockRootHex,
} from "../../../../src/chain/blocks/signedBlockRoot.js";

describe("signed block roots", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(Object.values(ForkName))("matches SignedBeaconBlock.hashTreeRoot for %s", (fork) => {
    const types = sszTypesFor(fork);
    const block = types.SignedBeaconBlock.defaultValue();
    block.message.slot = 123;
    block.message.stateRoot.fill(1);
    block.signature.fill(2);
    const blockRoot = types.BeaconBlock.hashTreeRoot(block.message);
    const signedBlockRoot = computeSignedBlockRoot(fork, block);
    const hashTreeRootInto = vi.spyOn(types.SignedBeaconBlock, "hashTreeRootInto");

    expect(types.BeaconBlock.hashTreeRoot(block.message)).toBe(blockRoot);
    expect(computeSignedBlockRoot(fork, block)).toBe(signedBlockRoot);
    expect(types.SignedBeaconBlock.hashTreeRoot(block)).toBe(signedBlockRoot);
    expect(signedBlockRoot).not.toEqual(blockRoot);
    expect(toSignedBlockRootHex(signedBlockRoot)).toBe(toRootHex(types.SignedBeaconBlock.hashTreeRoot(block)));
    expectTypeOf(signedBlockRoot).toEqualTypeOf<SignedBlockRoot>();
    expectTypeOf<Root>().not.toExtend<SignedBlockRoot>();
    expectTypeOf<RootHex>().not.toExtend<SignedBlockRootHex>();
    expect(hashTreeRootInto).not.toHaveBeenCalled();
  });

  it("distinguishes signatures for the same unsigned message root", () => {
    const types = sszTypesFor(ForkName.phase0);
    const block = types.SignedBeaconBlock.defaultValue();
    const blockRoot = types.BeaconBlock.hashTreeRoot(block.message);
    const first = computeSignedBlockRoot(ForkName.phase0, block);
    const other = types.SignedBeaconBlock.clone(block);
    other.signature = Uint8Array.from(other.signature);
    other.signature[0] = 1;

    expect(types.BeaconBlock.hashTreeRoot(other.message)).toEqual(blockRoot);
    expect(computeSignedBlockRoot(ForkName.phase0, other)).not.toEqual(first);
    expect(computeSignedBlockRoot(ForkName.phase0, other)).toBe(types.SignedBeaconBlock.hashTreeRoot(other));
    expect(computeSignedBlockRoot(ForkName.phase0, block)).toBe(first);
  });
});

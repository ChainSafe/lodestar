import {beforeEach, describe, expect, it, vi} from "vitest";
import {symbolCachedPermanentRoot} from "@chainsafe/ssz";
import {getPresetBase, signedBlockRoots} from "@lodestar/native/block-roots";
import {ForkName, ForkSeq, PresetName} from "@lodestar/params";
import {ssz} from "@lodestar/types";

vi.mock("@lodestar/native/block-roots", () => ({
  getPresetBase: vi.fn(),
  signedBlockRoots: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@lodestar/params");
  vi.doUnmock("@lodestar/params/setPreset");
});

describe.each(Object.values(PresetName))("block roots with native %s preset", (nativePreset) => {
  it.each(Object.values(PresetName))("only seeds a matching %s runtime preset", async (runtimePreset) => {
    vi.mocked(getPresetBase).mockReturnValue(nativePreset);
    vi.doMock("@lodestar/params", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@lodestar/params")>()),
      ACTIVE_PRESET: runtimePreset,
    }));
    const {seedBlockRoots, getSeededTransactionsRoot} = await import(
      "../../../../../src/chain/blocks/utils/blockRoots.js"
    );
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const bytes = ssz.fulu.SignedBeaconBlock.serialize(block);
    const roots = new Uint8Array(96).fill(1);
    vi.mocked(signedBlockRoots).mockReturnValue(roots);

    seedBlockRoots(ForkName.fulu, block, bytes);

    if (nativePreset === runtimePreset) {
      expect(signedBlockRoots).toHaveBeenCalledExactlyOnceWith(ForkSeq.fulu, bytes);
      expect(ssz.fulu.BeaconBlock.hashTreeRoot(block.message)).toEqual(roots.subarray(0, 32));
      expect(ssz.fulu.BeaconBlockBody.hashTreeRoot(block.message.body)).toEqual(roots.subarray(32, 64));
      expect(getSeededTransactionsRoot(block)).toEqual(roots.subarray(64));
    } else {
      expect(signedBlockRoots).not.toHaveBeenCalled();
      expect(Reflect.get(block.message, symbolCachedPermanentRoot)).toBeUndefined();
      expect(Reflect.get(block.message.body, symbolCachedPermanentRoot)).toBeUndefined();
      expect(getSeededTransactionsRoot(block)).toBeUndefined();
      expect(ssz.fulu.BeaconBlock.hashTreeRoot(block.message)).toEqual(
        ssz.fulu.BeaconBlock.hashTreeRoot(ssz.fulu.BeaconBlock.defaultValue())
      );
    }
  });
});

it("does not seed native roots when the runtime preset has custom overrides", async () => {
  vi.mocked(getPresetBase).mockReturnValue(PresetName.mainnet);
  vi.doMock("@lodestar/params/setPreset", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@lodestar/params/setPreset")>()),
    userOverrides: {MAX_WITHDRAWALS_PER_PAYLOAD: 8},
  }));
  const {seedBlockRoots, getSeededTransactionsRoot} = await import(
    "../../../../../src/chain/blocks/utils/blockRoots.js"
  );
  const block = ssz.capella.SignedBeaconBlock.defaultValue();

  seedBlockRoots(ForkName.capella, block, ssz.capella.SignedBeaconBlock.serialize(block));

  expect(signedBlockRoots).not.toHaveBeenCalled();
  expect(Reflect.get(block.message, symbolCachedPermanentRoot)).toBeUndefined();
  expect(Reflect.get(block.message.body, symbolCachedPermanentRoot)).toBeUndefined();
  expect(getSeededTransactionsRoot(block)).toBeUndefined();
});

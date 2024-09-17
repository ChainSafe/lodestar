import {describe, it, expect} from "vitest";
import {ForkInfo} from "@lodestar/config";
import {SignedBlindedBeaconBlock, SignedBeaconBlock} from "@lodestar/types";
import {ForkWithdrawals, isForkExecution} from "@lodestar/params";
import {
  blindedOrFullBlockToFull,
  deserializeFullOrBlindedSignedBeaconBlock,
  isBlindedBytes,
  serializeFullOrBlindedSignedBeaconBlock,
} from "../../../src/util/fullOrBlindedBlock.js";
import {chainConfig, mockBlocks} from "../../mocks/block.js";
import {byteArrayEquals} from "../../../src/util/bytes.js";

type FullOrBlind = "full" | "blinded";
type FullOrBlindBlock = [FullOrBlind, ForkInfo, SignedBlindedBeaconBlock | SignedBeaconBlock, Uint8Array];

const fullOrBlindedBlocks = Object.values(mockBlocks)
  .map(({forkInfo, full, fullSerialized, blinded, blindedSerialized}) => {
    const fullOrBlindBlock: FullOrBlindBlock[] = [["full", forkInfo, full, fullSerialized]];
    if (blinded && blindedSerialized) {
      fullOrBlindBlock.push(["blinded", forkInfo, blinded, blindedSerialized]);
    }
    return fullOrBlindBlock;
  })
  .flat();

describe("isBlindedBytes", () => {
  for (const [fullOrBlinded, {seq, name}, , block] of fullOrBlindedBlocks) {
    it(`should return ${fullOrBlinded === "blinded"} for ${name} ${fullOrBlinded} blocks`, () => {
      expect(isBlindedBytes(seq, block)).toEqual(isForkExecution(name) && fullOrBlinded === "blinded");
    });
  }
});

describe("serializeFullOrBlindedSignedBeaconBlock", () => {
  for (const [fullOrBlinded, {name}, block, expected] of fullOrBlindedBlocks) {
    it(`should serialize ${name} ${fullOrBlinded} block`, () => {
      const serialized = serializeFullOrBlindedSignedBeaconBlock(chainConfig, block);
      expect(byteArrayEquals(serialized, expected)).toBeTruthy();
    });
  }
});

describe("deserializeFullOrBlindedSignedBeaconBlock", () => {
  for (const [fullOrBlinded, {name}, block, serialized] of fullOrBlindedBlocks) {
    it(`should deserialize ${name} ${fullOrBlinded} block`, () => {
      const deserialized = deserializeFullOrBlindedSignedBeaconBlock(chainConfig, serialized);
      const type =
        isForkExecution(name) && fullOrBlinded === "blinded"
          ? chainConfig.getExecutionForkTypes(block.message.slot).SignedBlindedBeaconBlock
          : chainConfig.getForkTypes(block.message.slot).SignedBeaconBlock;
      expect(type.equals(deserialized as any, block as any)).toBeTruthy();
    });
  }
});

describe("blindedOrFullBlockToFull", function () {
  for (const {
    forkInfo: {name},
    full,
    blinded,
  } of mockBlocks) {
    const transactionsAndWithdrawals = {
      transactions: (full as SignedBeaconBlock<ForkWithdrawals>).message.body.executionPayload?.transactions ?? [],
      withdrawals: (full as SignedBeaconBlock<ForkWithdrawals>).message.body.executionPayload?.withdrawals ?? [],
    };
    it(`should convert ${name} full to full block`, () => {
      const result = blindedOrFullBlockToFull(chainConfig, full, transactionsAndWithdrawals);
      expect(chainConfig.getForkTypes(full.message.slot).SignedBeaconBlock.equals(result, full)).toBeTruthy();
    });
    if (!blinded) continue;
    it(`should convert ${name} blinded to full block`, () => {
      const result = blindedOrFullBlockToFull(chainConfig, blinded, transactionsAndWithdrawals);
      expect(chainConfig.getForkTypes(full.message.slot).SignedBeaconBlock.equals(result, full)).toBeTruthy();
    });
  }
});

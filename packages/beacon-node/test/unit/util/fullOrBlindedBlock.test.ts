import {expect} from "chai";
import {ForkInfo, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {allForks, capella} from "@lodestar/types";
import {
  blindedOrFullSignedBlockToBlinded,
  blindedOrFullSignedBlockToBlindedBytes,
  deserializeFullOrBlindedSignedBeaconBlock,
  isSerializedBlinded,
  reassembleBlindedBlockBytesToFullBytes,
  serializeFullOrBlindedSignedBeaconBlock,
} from "../../../src/util/fullOrBlindedBlock.js";
import {mockBlocks} from "../../utils/mocks/block.js";
import {byteArrayEquals} from "../../../src/util/bytes.js";

const config = createChainForkConfig(defaultChainConfig);
type FullOrBlinded = "full" | "blinded";
const fullOrBlindedBlocks = [
  ...mockBlocks.map(([forkInfo, serialized, block]) => ["full", forkInfo, serialized, block]),
  ...mockBlocks.map(([forkInfo, , , serialized, block]) => ["blinded", forkInfo, serialized, block]),
] as [FullOrBlinded, ForkInfo, Uint8Array, allForks.FullOrBlindedSignedBeaconBlock][];

describe("isSerializedBlinded", () => {
  for (const [fullOrBlinded, {seq, name}, block] of fullOrBlindedBlocks) {
    it(`should return ${fullOrBlinded === "blinded"} for ${fullOrBlinded} ${name} blocks`, () => {
      expect(isSerializedBlinded(seq, block)).to.equal(fullOrBlinded === "blinded");
    });
  }
});

describe("serializeFullOrBlindedSignedBeaconBlock", () => {
  for (const [fullOrBlinded, {name}, expected, block] of fullOrBlindedBlocks) {
    it(`should serialize ${fullOrBlinded} ${name} block`, () => {
      const serialized = serializeFullOrBlindedSignedBeaconBlock(config, block);
      expect(byteArrayEquals(serialized, expected)).to.be.true;
    });
  }
});

describe("deserializeFullOrBlindedSignedBeaconBlock", () => {
  for (const [fullOrBlinded, {name}, serialized, block] of fullOrBlindedBlocks) {
    it(`should deserialize ${fullOrBlinded} ${name} block`, () => {
      const deserialized = deserializeFullOrBlindedSignedBeaconBlock(config, serialized);
      const type =
        fullOrBlinded === "full"
          ? config.getForkTypes(block.message.slot).SignedBeaconBlock
          : config.getBlindedForkTypes(block.message.slot).SignedBeaconBlock;
      expect(type.equals(deserialized, block)).to.be.true;
    });
  }
});

describe("blindedOrFullSignedBlockToBlinded", () => {
  for (const [{name}, , block, , blinded] of mockBlocks) {
    it(`should convert full ${name} to blinded block`, () => {
      expect(
        config
          .getForkTypes(block.message.slot)
          .SignedBeaconBlock.equals(blindedOrFullSignedBlockToBlinded(config, block), blinded)
      ).to.be.true;
    });
    it(`should convert blinded ${name} to blinded block`, () => {
      expect(
        config
          .getForkTypes(block.message.slot)
          .SignedBeaconBlock.equals(blindedOrFullSignedBlockToBlinded(config, blinded), blinded)
      ).to.be.true;
    });
  }
});

describe("blindedOrFullSignedBlockToBlindedBytes", () => {
  for (const [{name}, serializedFull, full, serializedBlinded, blinded] of mockBlocks) {
    it(`should convert full ${name} to blinded block`, () => {
      expect(byteArrayEquals(blindedOrFullSignedBlockToBlindedBytes(config, full, serializedFull), serializedBlinded))
        .to.be.true;
    });
    it(`should convert blinded ${name} to blinded block`, () => {
      expect(
        byteArrayEquals(blindedOrFullSignedBlockToBlindedBytes(config, blinded, serializedBlinded), serializedBlinded)
      ).to.be.true;
    });
  }
});

describe("reassembleBlindedBlockBytesToFullBytes", () => {
  for (const [{name, seq}, serializedFull, full, serializedBlinded] of mockBlocks) {
    const transactions = (full as capella.SignedBeaconBlock).message.body.executionPayload?.transactions;
    const withdrawals = (full as capella.SignedBeaconBlock).message.body.executionPayload?.withdrawals;
    it(`should reassemble serialized blinded ${name} to serialized full block`, () => {
      expect(
        byteArrayEquals(
          reassembleBlindedBlockBytesToFullBytes(seq, serializedBlinded, transactions, withdrawals),
          serializedFull
        )
      ).to.be.true;
    });
  }
});

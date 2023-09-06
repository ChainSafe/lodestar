import {expect} from "chai";
import {ForkInfo, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {allForks, capella} from "@lodestar/types";
import {ForkSeq, isForkExecution} from "@lodestar/params";
import {
  blindedOrFullSignedBlockToBlinded,
  blindedOrFullSignedBlockToBlindedBytes,
  deserializeFullOrBlindedSignedBeaconBlock,
  isSerializedBlinded,
  reassembleBlindedOrFullToFullBytes,
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
      expect(isSerializedBlinded(seq, block)).to.equal(isForkExecution(name) && fullOrBlinded === "blinded");
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
        isForkExecution(name) && fullOrBlinded === "blinded"
          ? config.getBlindedForkTypes(block.message.slot).SignedBeaconBlock
          : config.getForkTypes(block.message.slot).SignedBeaconBlock;
      expect(type.equals(deserialized, block)).to.be.true;
    });
  }
});

describe("blindedOrFullSignedBlockToBlinded", () => {
  for (const [{name}, , block, , expected] of mockBlocks) {
    it(`should convert full ${name} to blinded block`, () => {
      const blinded = blindedOrFullSignedBlockToBlinded(config, block);
      const isEqual = isForkExecution(name)
        ? config.getBlindedForkTypes(block.message.slot).SignedBeaconBlock.equals(blinded, expected)
        : config.getForkTypes(block.message.slot).SignedBeaconBlock.equals(blinded, expected);
      expect(isEqual).to.be.true;
    });
    it(`should convert blinded ${name} to blinded block`, () => {
      const blinded = blindedOrFullSignedBlockToBlinded(config, expected);
      const isEqual = isForkExecution(name)
        ? config.getBlindedForkTypes(block.message.slot).SignedBeaconBlock.equals(blinded, expected)
        : config.getForkTypes(block.message.slot).SignedBeaconBlock.equals(blinded, expected);
      expect(isEqual).to.be.true;
    });
  }
});

describe("blindedOrFullSignedBlockToBlindedBytes", function () {
  this.timeout(60000);
  for (const [{name}, serializedFull, full, serializedBlinded, blindBlock] of mockBlocks) {
    it(`should convert full ${name} to blinded block`, () => {
      const blinded = blindedOrFullSignedBlockToBlindedBytes(config, full, serializedFull);
      expect(byteArrayEquals(blinded, serializedBlinded)).to.be.true;
    });
    it(`should convert blinded ${name} to blinded block`, () => {
      const blinded = blindedOrFullSignedBlockToBlindedBytes(config, blindBlock, serializedBlinded);
      expect(byteArrayEquals(blinded, serializedBlinded)).to.be.true;
    });
  }
});

describe("reassembleBlindedOrFullToFullBytes", () => {
  for (const [{name, seq}, serializedFull, full, serializedBlinded] of mockBlocks) {
    const transactions = (full as capella.SignedBeaconBlock).message.body.executionPayload?.transactions;
    const withdrawals = (full as capella.SignedBeaconBlock).message.body.executionPayload?.withdrawals;
    it(`should reassemble serialized blinded ${name} to serialized full block`, async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of reassembleBlindedOrFullToFullBytes(
        seq,
        serializedBlinded,
        Promise.resolve({transactions, withdrawals})
      )) {
        chunks.push(chunk);
      }
      const result = Uint8Array.from(Buffer.concat(chunks));
      expect(byteArrayEquals(result, serializedFull)).to.be.true;
    });
  }
});

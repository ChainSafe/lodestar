import {expect} from "chai";
import {ForkInfo, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {allForks, capella, ssz} from "@lodestar/types";
import {ForkName, ForkSeq, isForkExecution} from "@lodestar/params";
import {mainnetPreset} from "@lodestar/params/presets/mainnet";
import {minimalPreset} from "@lodestar/params/presets/minimal";
import {mainnetChainConfig} from "@lodestar/config/presets";
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

// calculate slot ratio so that getForkTypes and getBlindedForkTypes return correct fork for minimal configuration
const slotPerEpochRatio =
  defaultChainConfig.CONFIG_NAME === "minimal" ? mainnetPreset.SLOTS_PER_EPOCH / minimalPreset.SLOTS_PER_EPOCH : 1;

/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: mainnetChainConfig.ALTAIR_FORK_EPOCH * slotPerEpochRatio,
  BELLATRIX_FORK_EPOCH: mainnetChainConfig.BELLATRIX_FORK_EPOCH * slotPerEpochRatio,
  CAPELLA_FORK_EPOCH: mainnetChainConfig.CAPELLA_FORK_EPOCH * slotPerEpochRatio,
  DENEB_FORK_EPOCH: mainnetChainConfig.DENEB_FORK_EPOCH * slotPerEpochRatio,
});
/* eslint-enable @typescript-eslint/naming-convention */

type FullOrBlind = "full" | "blinded";
type FullOrBlindBlock = [FullOrBlind, ForkInfo, allForks.FullOrBlindedSignedBeaconBlock, Uint8Array];

const fullOrBlindedBlocks = Object.values(mockBlocks)
  .map(({forkInfo, full, fullSerialized, blinded, blindedSerialized}) => {
    const fullOrBlindBlock: FullOrBlindBlock[] = [["full", forkInfo, full, fullSerialized]];
    if (blinded && blindedSerialized) {
      fullOrBlindBlock.push(["blinded", forkInfo, blinded, blindedSerialized]);
    }
    return fullOrBlindBlock;
  })
  .flat();

describe("isSerializedBlinded", () => {
  for (const [fullOrBlinded, {seq, name}, , block] of fullOrBlindedBlocks) {
    it(`should return ${fullOrBlinded === "blinded"} for ${fullOrBlinded} ${name} blocks`, () => {
      expect(isSerializedBlinded(seq, block)).to.equal(isForkExecution(name) && fullOrBlinded === "blinded");
    });
  }
});

describe("serializeFullOrBlindedSignedBeaconBlock", () => {
  for (const [fullOrBlinded, {name}, block, expected] of fullOrBlindedBlocks) {
    it(`should serialize ${fullOrBlinded} ${name} block`, () => {
      const serialized = serializeFullOrBlindedSignedBeaconBlock(config, block);
      expect(byteArrayEquals(serialized, expected)).to.be.true;
    });
  }
});

describe("deserializeFullOrBlindedSignedBeaconBlock", () => {
  for (const [fullOrBlinded, {name}, block, serialized] of fullOrBlindedBlocks) {
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

describe("blindedOrFullSignedBlockToBlinded", function () {
  for (const {
    forkInfo: {name},
    full,
    blinded,
  } of mockBlocks) {
    it(`should convert full ${name} to blinded block`, () => {
      const result = blindedOrFullSignedBlockToBlinded(config, full);
      const isExecution = isForkExecution(name);
      const isEqual = isExecution
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          config.getBlindedForkTypes(full.message.slot).SignedBeaconBlock.equals(result, blinded!)
        : // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          config.getForkTypes(full.message.slot).SignedBeaconBlock.equals(result, isExecution ? blinded! : full);
      expect(isEqual).to.be.true;
    });
    if (!blinded) continue;
    it(`should convert blinded ${name} to blinded block`, () => {
      const result = blindedOrFullSignedBlockToBlinded(config, blinded);
      const isEqual = isForkExecution(name)
        ? config.getBlindedForkTypes(full.message.slot).SignedBeaconBlock.equals(result, blinded)
        : config.getForkTypes(full.message.slot).SignedBeaconBlock.equals(result, blinded);
      expect(isEqual).to.be.true;
    });
  }
});

describe("blindedOrFullSignedBlockToBlindedBytes", function () {
  for (const {
    forkInfo: {name},
    full,
    fullSerialized,
    blinded,
    blindedSerialized,
  } of mockBlocks) {
    const expected = (isForkExecution(name) ? blindedSerialized : fullSerialized) as Uint8Array;
    it(`should convert full ${name} to blinded block`, () => {
      const result = blindedOrFullSignedBlockToBlindedBytes(config, full, fullSerialized);
      expect(byteArrayEquals(result, expected)).to.be.true;
    });
    if (blinded && blindedSerialized) {
      it(`should convert blinded ${name} to blinded block`, () => {
        const result = blindedOrFullSignedBlockToBlindedBytes(config, blinded, blindedSerialized);
        expect(byteArrayEquals(result, expected)).to.be.true;
      });
    }
  }
});

describe("reassembleBlindedOrFullToFullBytes", () => {
  for (const {
    forkInfo: {seq, name},
    full,
    fullSerialized,
    blindedSerialized,
  } of mockBlocks) {
    const transactions = (full as capella.SignedBeaconBlock).message.body.executionPayload?.transactions;
    const withdrawals = (full as capella.SignedBeaconBlock).message.body.executionPayload?.withdrawals;
    it(`should reassemble serialized blinded ${name} to serialized full block`, async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of reassembleBlindedOrFullToFullBytes(
        seq,
        (isForkExecution(name) ? blindedSerialized : fullSerialized) as Uint8Array,
        Promise.resolve({transactions, withdrawals})
      )) {
        chunks.push(chunk);
      }
      const result = Uint8Array.from(Buffer.concat(chunks));
      expect(byteArrayEquals(result, fullSerialized)).to.be.true;
    });
  }
});

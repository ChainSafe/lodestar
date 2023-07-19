import chai from "chai";
import chaiBytes from "chai-bytes";
import {ForkInfo, createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {randBytesArray} from "@lodestar/utils";
import {allForks, bellatrix, capella, ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {
  fullToBlindedSignedBeaconBlock,
  blindedToFullSignedBeaconBlock,
  buildVariableOffset,
} from "../../../../../src/db/repositories/blockBlindingAndUnblinding.js";
import {getMockSignedBeaconBlock, convertFullToBlindedMock} from "../../../../utils/block.js";

chai.use(chaiBytes);
const {expect} = chai;

const config = createBeaconConfig(defaultChainConfig, randBytesArray(32));

interface TestCase {
  info: ForkInfo;
  full: allForks.SignedBeaconBlock;
  blinded: allForks.SignedBlindedBeaconBlock;
}
const tests: TestCase[] = config.forksAscendingEpochOrder.map((info) => {
  const full = getMockSignedBeaconBlock(info.seq);
  return {
    info,
    full,
    blinded: convertFullToBlindedMock(info, full),
  };
});

describe("buildVariableOffset", () => {
  it("should create correct length offset", () => {
    expect(buildVariableOffset(1).length).to.equal(4);
  });

  it("should encode correct offset", () => {
    const offset = 100;
    const result = buildVariableOffset(offset);
    const dv = new DataView(result.buffer);
    expect(dv.getUint32(0, true)).to.equal(offset);
  });
});

describe("Serialized Blinding and Un-Blinding", () => {
  it("should have tests for all forks", () => {
    expect(tests.length).to.equal(config.forksAscendingEpochOrder.length);
  });

  describe("full to blinded", () => {
    for (const test of tests) {
      it(`should convert ${test.info.name} blocks`, () => {
        let transactionsRoot: undefined | Uint8Array;
        if (test.info.seq >= ForkSeq.bellatrix) {
          transactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(
            (test.full as bellatrix.SignedBeaconBlock).message.body.executionPayload.transactions
          );
        }

        let withdrawalsRoot: undefined | Uint8Array;
        if (test.info.seq >= ForkSeq.capella) {
          withdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(
            (test.full as capella.SignedBeaconBlock).message.body.executionPayload.withdrawals
          );
        }

        const converted = fullToBlindedSignedBeaconBlock(
          test.info.seq,
          ssz[test.info.name].SignedBeaconBlock.serialize(test.full),
          transactionsRoot,
          withdrawalsRoot
        );

        if (test.info.seq < ForkSeq.bellatrix) {
          expect(converted).to.equalBytes(
            config.getForkTypes(test.full.message.slot).SignedBeaconBlock.serialize(test.blinded)
          );
        } else {
          expect(converted).to.equalBytes(
            config.getBlindedForkTypes(test.full.message.slot).SignedBeaconBlock.serialize(test.blinded)
          );
        }
      });
    }
  });

  describe("blinded to full", () => {
    for (const test of tests) {
      it(`should convert ${test.info.name} blocks`, () => {
        const serializedBlinded =
          test.info.seq < ForkSeq.bellatrix
            ? ssz[test.info.name].SignedBeaconBlock.serialize(test.blinded)
            : ssz[test.info.name as "bellatrix"].SignedBlindedBeaconBlock.serialize(test.blinded);

        let transactions: undefined | Uint8Array;
        if (test.info.seq >= ForkSeq.bellatrix) {
          transactions = ssz.bellatrix.Transactions.serialize(
            (test.full as bellatrix.SignedBeaconBlock).message.body.executionPayload.transactions
          );
        }

        let withdrawals: undefined | Uint8Array;
        if (test.info.seq >= ForkSeq.capella) {
          withdrawals = ssz.capella.Withdrawals.serialize(
            (test.full as capella.SignedBeaconBlock).message.body.executionPayload.withdrawals
          );
        }

        const converted = blindedToFullSignedBeaconBlock(test.info.seq, serializedBlinded, transactions, withdrawals);
        expect(converted).to.equalBytes(ssz[test.info.name].SignedBeaconBlock.serialize(test.full));
      });
    }
  });
});

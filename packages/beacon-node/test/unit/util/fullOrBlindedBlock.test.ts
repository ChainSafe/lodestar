import {expect} from "chai";
import {ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {isSerializedBlinded} from "../../../src/util/fullOrBlindedBlock.js";

const blindedBlockBellatrix = ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue();
const blindedBlockDeneb = ssz.deneb.SignedBlindedBeaconBlock.defaultValue();

const fullBlockAltair = ssz.altair.SignedBeaconBlock.defaultValue();
const fullBlockBellatrix = ssz.bellatrix.SignedBeaconBlock.defaultValue();
const fullBlockDeneb = ssz.deneb.SignedBeaconBlock.defaultValue();

const serializedBlindedBlockBellatrix = ssz.bellatrix.SignedBlindedBeaconBlock.serialize(blindedBlockBellatrix);
const serializedBlindedBlockDeneb = ssz.deneb.SignedBlindedBeaconBlock.serialize(blindedBlockDeneb);

const serializedFullBlockAltair = ssz.altair.SignedBeaconBlock.serialize(fullBlockAltair);
const serializedFullBlockBellatrix = ssz.bellatrix.SignedBeaconBlock.serialize(fullBlockBellatrix);
const serializedFullBlockDeneb = ssz.deneb.SignedBeaconBlock.serialize(fullBlockDeneb);

describe("isSerializedBlinded", () => {
  it("should return true for blinded block", () => {
    expect(isSerializedBlinded(ForkSeq.bellatrix, serializedBlindedBlockBellatrix)).to.be.true;
    expect(isSerializedBlinded(ForkSeq.deneb, serializedBlindedBlockDeneb)).to.be.true;
  });

  it("should return false for full block", () => {
    expect(isSerializedBlinded(ForkSeq.altair, serializedFullBlockAltair)).to.be.false;
    expect(isSerializedBlinded(ForkSeq.bellatrix, serializedFullBlockBellatrix)).to.be.false;
    expect(isSerializedBlinded(ForkSeq.deneb, serializedFullBlockDeneb)).to.be.false;
  });
});

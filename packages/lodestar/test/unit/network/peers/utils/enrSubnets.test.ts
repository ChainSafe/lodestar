import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {toHex} from "@chainsafe/lodestar-utils";
import {BitArray} from "@chainsafe/ssz";
import {expect} from "chai";
import {deserializeEnrSubnets} from "../../../../../src/network/peers/utils/enrSubnetsDeserialize.js";

describe("ENR syncnets", () => {
  const syncnetTestCases: {bytes: string; bools: boolean[]}[] = [
    {bytes: "00", bools: [false, false, false, false]},
    {bytes: "01", bools: [true, false, false, false]},
    {bytes: "02", bools: [false, true, false, false]},
    {bytes: "03", bools: [true, true, false, false]},
    {bytes: "04", bools: [false, false, true, false]},
    {bytes: "0f", bools: [true, true, true, true]},
  ];

  for (const {bytes, bools} of syncnetTestCases) {
    it(`Deserialize syncnet ${bytes}`, () => {
      const bytesBuf = Buffer.from(bytes, "hex");

      expect(toHex(ssz.altair.SyncSubnets.deserialize(bytesBuf).uint8Array)).to.deep.equal(
        toHex(BitArray.fromBoolArray(bools).uint8Array)
      );

      expect(
        deserializeEnrSubnets(bytesBuf, SYNC_COMMITTEE_SUBNET_COUNT).slice(0, SYNC_COMMITTEE_SUBNET_COUNT)
      ).to.deep.equal(bools);
    });
  }

  // ATTESTATION_SUBNET_COUNT = 64 is too much for unit test, make it 16
  const ATTESTATION_SUBNET_COUNT = 16;
  const attnetTestCases: {bytes: string; bools: boolean[]}[] = [
    {
      bytes: "1111",
      bools: [
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
      ],
    },
    {
      bytes: "2222",
      bools: [
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
      ],
    },
    {
      bytes: "3333",
      bools: [true, true, false, false, true, true, false, false, true, true, false, false, true, true, false, false],
    },
    {
      bytes: "4444",
      bools: [
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        true,
        false,
      ],
    },
    {
      bytes: "ffff",
      bools: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    },
  ];
  for (const {bytes, bools} of attnetTestCases) {
    const bytesBuf = Buffer.from(bytes, "hex");
    it(`Deserialize attnet ${bytes}`, () => {
      expect(
        deserializeEnrSubnets(bytesBuf, ATTESTATION_SUBNET_COUNT).slice(0, ATTESTATION_SUBNET_COUNT)
      ).to.deep.equal(bools);
    });
  }
});

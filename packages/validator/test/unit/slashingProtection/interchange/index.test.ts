import {describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {Root, ssz} from "@lodestar/types";
import {
  Interchange,
  InterchangeErrorErrorCode,
  parseInterchange,
  serializeInterchange,
} from "../../../../src/slashingProtection/interchange/index.js";

describe("interchange", () => {
  it("Should parseInterchange and serializeInterchange", () => {
    const expectedGenesisValidatorsRoot: Root = ssz.Root.defaultValue();
    const interchange: Interchange = {
      metadata: {
        interchange_format: "complete",
        interchange_format_version: "4",
        genesis_validators_root: toHexString(expectedGenesisValidatorsRoot),
      },
      data: [
        {
          pubkey: "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c",
          signed_blocks: [{slot: "4"}],
          signed_attestations: [{source_epoch: "2", target_epoch: "4"}],
        },
      ],
    };

    const interchangeLodestar = parseInterchange(interchange, expectedGenesisValidatorsRoot);
    const serializedInterchange = serializeInterchange(interchangeLodestar, {format: "complete", version: "4"});
    // Stringify and parse to simulate writing and reading. It ignores undefined values
    expect(JSON.parse(JSON.stringify(serializedInterchange))).toEqual(interchange);
  });

  describe("slot and epoch values", () => {
    const genesisValidatorsRoot: Root = ssz.Root.defaultValue();

    function interchangeWith(slot: string, epoch: string): Interchange {
      return {
        metadata: {
          interchange_format_version: "5",
          genesis_validators_root: toHexString(genesisValidatorsRoot),
        },
        data: [
          {
            pubkey:
              "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c",
            signed_blocks: [{slot}],
            signed_attestations: [{source_epoch: epoch, target_epoch: epoch}],
          },
        ],
      };
    }

    it("Should accept the highest supported value", () => {
      const {data} = parseInterchange(interchangeWith("9007199254740990", "9007199254740990"), genesisValidatorsRoot);
      expect(data[0].signedBlocks[0].slot).toBe(9007199254740990);
      expect(data[0].signedAttestations[0].targetEpoch).toBe(9007199254740990);
    });

    for (const value of ["18446744073709551615", "9007199254740991", "-1", "1.5", "1e3", "0x10", "12abc", " 1", ""]) {
      it(`Should reject ${JSON.stringify(value)}`, () => {
        expect(() => parseInterchange(interchangeWith(value, "1"), genesisValidatorsRoot)).toThrow(
          InterchangeErrorErrorCode.INVALID_VALUE
        );
        expect(() => parseInterchange(interchangeWith("1", value), genesisValidatorsRoot)).toThrow(
          InterchangeErrorErrorCode.INVALID_VALUE
        );
      });
    }
  });
});

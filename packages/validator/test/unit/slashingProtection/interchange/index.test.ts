/* eslint-disable @typescript-eslint/naming-convention */
import {expect} from "chai";
import {Root, ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {
  Interchange,
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
    expect(JSON.parse(JSON.stringify(serializedInterchange))).to.deep.equal(interchange);
  });
});

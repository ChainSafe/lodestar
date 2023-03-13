import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect} from "chai";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {phase0, ssz} from "@lodestar/types";
import {verifyBlockSequence} from "../../../../src/sync/backfill/verify.js";
import {BackfillSyncErrorCode, BackfillSyncError} from "./../../../../src/sync/backfill/errors.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("backfill sync - verify block sequence", function () {
  //mainnet validators root
  const beaconConfig = createBeaconConfig(
    config,
    ssz.Root.fromJson("0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95")
  );

  it("should verify valid chain of blocks", function () {
    const blocks = getBlocks();

    expect(() => verifyBlockSequence(beaconConfig, blocks.slice(0, 2), blocks[2].message.parentRoot)).to.not.throw;
  });

  it("should fail with sequence not anchored", function () {
    const blocks = getBlocks();

    const wrongAncorRoot = ssz.Root.defaultValue();
    expect(() => verifyBlockSequence(beaconConfig, blocks, wrongAncorRoot)).to.throw(
      BackfillSyncErrorCode.NOT_ANCHORED
    );
  });

  it("should fail with sequence not linear", function () {
    const blocks = getBlocks();
    expect(() => {
      const {error} = verifyBlockSequence(
        beaconConfig,
        // remove middle block
        blocks.filter((b) => b.message.slot !== 2).slice(0, blocks.length - 2),
        blocks[blocks.length - 1].message.parentRoot
      );
      if (error) throw new BackfillSyncError({code: error});
    }).to.throw(BackfillSyncErrorCode.NOT_LINEAR);
  });

  //first 4 mainnet blocks
  function getBlocks(): phase0.SignedBeaconBlock[] {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, "./blocks.json"), "utf-8")) as unknown[];
    return json.map((b) => {
      return ssz.phase0.SignedBeaconBlock.fromJson(b);
    });
  }
});

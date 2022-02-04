import {BackfillSyncErrorCode, BackfillSyncError} from "./../../../../src/sync/backfill/errors";
import {Json} from "@chainsafe/ssz";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {verifyBlockSequence} from "../../../../src/sync/backfill/verify";
import path from "node:path";

describe("backfill sync - verify block sequence", function () {
  //mainnet validators root
  const beaconConfig = createIBeaconConfig(
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
    const json = JSON.parse(readFileSync(path.join(__dirname, "./blocks.json"), "utf-8")) as Json[];
    return json.map((b) => {
      return ssz.phase0.SignedBeaconBlock.fromJson(b, {case: "snake"});
    });
  }
});

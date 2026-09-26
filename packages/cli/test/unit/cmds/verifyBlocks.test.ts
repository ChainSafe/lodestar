import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {BeaconDb} from "@lodestar/beacon-node";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths.js";
import {verifyBlocks} from "../../../src/cmds/beacon/verifyBlocks.js";
import {getBeaconConfigFromArgs} from "../../../src/config/index.js";
import {GlobalArgs} from "../../../src/options/globalOptions.js";
import {testLogger} from "../../utils.js";

const MAX_PAYLOAD_SIZE = 64 * 1024;

function block(slot: number, oversized = false) {
  const signedBlock = ssz.capella.SignedBeaconBlock.defaultValue();
  signedBlock.message.slot = slot;
  if (oversized) signedBlock.message.body.executionPayload.transactions = [new Uint8Array(MAX_PAYLOAD_SIZE)];
  return {
    bytes: ssz.capella.SignedBeaconBlock.serialize(signedBlock),
    root: toRootHex(ssz.capella.BeaconBlock.hashTreeRoot(signedBlock.message)),
  };
}

describe("cmds / beacon / verify-blocks", () => {
  it("stops at an oversized archived block with its slot and root, then resumes and verifies", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lodestar-verify-blocks-"));
    const args = {
      dataDir,
      network: "mainnet",
      logLevel: "error",
      logFile: "none",
      "params.ALTAIR_FORK_EPOCH": "0",
      "params.BELLATRIX_FORK_EPOCH": "0",
      "params.CAPELLA_FORK_EPOCH": "0",
      "params.MAX_PAYLOAD_SIZE": String(MAX_PAYLOAD_SIZE),
    } as unknown as BeaconArgs & GlobalArgs;
    const {config, network} = getBeaconConfigFromArgs(args);
    const {dbDir} = getBeaconPaths(args, network);
    const withDb = async (run: (db: BeaconDb) => Promise<void>): Promise<void> => {
      const controller = await LevelDbController.create({name: dbDir}, {logger: testLogger()});
      try {
        await run(new BeaconDb(config, controller));
      } finally {
        await controller.close();
      }
    };
    try {
      // Blocks archived by a build without the certification
      await withDb(async (db) => {
        for (const slot of [1, 2, 3]) await db.blockArchive.putBinary(slot, block(slot, slot === 2).bytes);
      });
      await expect(verifyBlocks.handler?.(args)).rejects.toThrow(
        `Archived block at slot 2 root ${block(2, true).root} has ${block(2, true).bytes.byteLength} bytes, above MAX_PAYLOAD_SIZE ${MAX_PAYLOAD_SIZE}`
      );
      await withDb(async (db) => {
        expect(await db.blockCertification.load()).toEqual({from: 2, to: 3});
        // The operator replaces the oversized block
        await db.blockArchive.putBinary(2, block(2).bytes);
      });
      await verifyBlocks.handler?.(args);
      await withDb(async (db) => {
        expect(await db.blockCertification.load()).toBeNull();
      });
    } finally {
      await rm(dataDir, {recursive: true, force: true});
    }
  });
});

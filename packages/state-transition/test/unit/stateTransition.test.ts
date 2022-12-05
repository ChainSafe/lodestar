import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect} from "chai";
import {ssz, capella} from "@lodestar/types";
import {createIChainForkConfig, defaultChainConfig} from "@lodestar/config";

import {stateTransition} from "../../src/index.js";
import {createCachedBeaconStateTest} from "../utils/state.js";

/* eslint-disable @typescript-eslint/naming-convention */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("capella withdrawal consensus", () => {
  it("devnet 1 - process slot 10497", () => {
    const testPath = __dirname + "/data/withdrawal-devnet-slot-10497";
    const config = createIChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
    });

    const preStateBuffer = fs.readFileSync(path.join(testPath, "./preState.ssz"));
    const preBeaconState = ssz.capella.BeaconState.deserializeToViewDU(preStateBuffer);
    const preState = createCachedBeaconStateTest(preBeaconState, config);

    const postStateBuffer = fs.readFileSync(path.join(testPath, "./postState.ssz"));
    const postBeaconState = ssz.capella.BeaconState.deserializeToViewDU(postStateBuffer);
    const postState = createCachedBeaconStateTest(postBeaconState, config);
    const signedBlockJson = JSON.parse(fs.readFileSync(path.join(testPath, "./block.json"), "utf8")) as {
      data: unknown;
    };
    const signedBlock = ssz.capella.SignedBeaconBlock.fromJson(signedBlockJson.data);

    const processedState = stateTransition(preState, signedBlock, {
      verifyStateRoot: true,
      verifyProposer: false,
      verifySignatures: false,
    });

    expect(ssz.capella.BeaconState.toJson(processedState.toValue() as capella.BeaconState)).deep.equals(
      ssz.capella.BeaconState.toJson(postState.toValue() as capella.BeaconState)
    );
  });
});

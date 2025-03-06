import { describe, expect, it } from "vitest";
import fs from "fs";
import { formatBytes } from "@lodestar/utils";
import {decodeSync, encodeSync} from "@chainsafe/xdelta3-node";
import {holeskyChainConfig} from "@lodestar/config/networks";
import { createChainForkConfig } from "@lodestar/config";
import { getForkFromStateBytes, getStateTypeFromBytes } from "../src/util/sszBytes";
import { ssz } from "@lodestar/types";


describe("State diff", () => {
  const dir = ".";
  const statePath = `${dir}/holesky_state_3768287.ssz`;
  const finalizedStatePath = `${dir}/holesky_finalized_state_Feb_25.ssz`;
  const config = createChainForkConfig(holeskyChainConfig);
  it("load state and check validators size", () => {
    const stateBytes = fs.readFileSync(statePath);
    console.log("@@@ state bytes", formatBytes(stateBytes.length));
    const fork = getForkFromStateBytes(config, stateBytes);
    const forkName = config.getForkName(fork);
    console.log("@@@ fork", forkName);
    const stateType = getStateTypeFromBytes(config, stateBytes);
    const state = stateType.deserializeToViewDU(stateBytes);
    console.log("@@@ state", state.slot);
    const validatorsBytes = state.validators.serialize();
    console.log("@@@ validators bytes", formatBytes(validatorsBytes.length));

    const finalizedStateBytes = fs.readFileSync(finalizedStatePath);
    console.log("@@@ finalized state bytes", formatBytes(finalizedStateBytes.length));
    const finalizedStateType = getStateTypeFromBytes(config, finalizedStateBytes);
    const finalizedState = finalizedStateType.deserializeToViewDU(finalizedStateBytes);
    console.log("@@@ finalized state", finalizedState.slot);
    const finalizedValidatorsBytes = finalizedState.validators.serialize();
    console.log("@@@ finalized validators bytes", formatBytes(finalizedValidatorsBytes.length));

    const stateDelta = encodeSync(finalizedStateBytes, stateBytes);
    console.log("@@@ state delta", formatBytes(stateDelta.length));

    let start = Date.now();
    const validatorDelta = encodeSync(finalizedValidatorsBytes, validatorsBytes);
    console.log("@@@ validator delta", formatBytes(validatorDelta.length), Date.now() - start, "ms");
    start = Date.now();
    const validatorsBytes2 = decodeSync(finalizedValidatorsBytes, validatorDelta);
    console.log("@@@ apply delta in", Date.now() - start, "ms");
    expect(Buffer.compare(validatorsBytes, validatorsBytes2)).toBe(0);
  })
});

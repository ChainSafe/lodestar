import {getClient} from "@lodestar/api";
import {gnosisChainConfig as chainConfig} from "@lodestar/config/networks";
import {createIChainForkConfig} from "@lodestar/config";
import {getStateTypeFromBytes} from "@lodestar/beacon-node";

/* eslint-disable no-console, @typescript-eslint/explicit-function-return-type */

export async function downloadHeadState() {
  const config = createIChainForkConfig(chainConfig);

  const client = getClient({baseUrl: "http://localhost:4000"}, {config});

  const stateBytes = await client.debug.getStateV2("head", "ssz");

  const stateType = getStateTypeFromBytes(config, stateBytes);
  const state = stateType.deserialize(stateBytes);

  const fork = config.getForkName(state.slot);
  console.log("Downloaded state", {fork});

  return {state, config, fork};
}

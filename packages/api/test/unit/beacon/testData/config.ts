import {ssz} from "@lodestar/types";
import {chainConfigToJson} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {activePreset, presetToJson} from "@lodestar/params";
import {Api} from "../../../../src/beacon/routes/config.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const configJson = chainConfigToJson(chainConfig);
const presetJson = presetToJson(activePreset);
const jsonSpec = {...configJson, ...presetJson};

export const testData: GenericServerTestCases<Api> = {
  getDepositContract: {
    args: [],
    res: {
      data: {
        chainId: 1,
        address: Buffer.alloc(20, 1),
      },
    },
  },
  getForkSchedule: {
    args: [],
    res: {data: [ssz.phase0.Fork.defaultValue()]},
  },
  getSpec: {
    args: [],
    res: {data: jsonSpec},
  },
};

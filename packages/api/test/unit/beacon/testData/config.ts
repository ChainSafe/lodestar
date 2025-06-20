import {chainConfigToJson} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {activePreset, presetToJson} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints} from "../../../../src/beacon/routes/config.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const configJson = chainConfigToJson(chainConfig);
const presetJson = presetToJson(activePreset);
const jsonSpec = {...configJson, ...presetJson};

export const testData: GenericServerTestCases<Endpoints> = {
  getDepositContract: {
    args: undefined,
    res: {
      data: {
        chainId: 1,
        address: new Uint8Array(20).fill(1),
      },
    },
  },
  getForkSchedule: {
    args: undefined,
    res: {data: [ssz.phase0.Fork.defaultValue()]},
  },
  getSpec: {
    args: undefined,
    res: {data: jsonSpec},
  },
};

import {ssz} from "@chainsafe/lodestar-types";
import {chainConfigToJson} from "@chainsafe/lodestar-config";
import {config, chainConfig} from "@chainsafe/lodestar-config/default";
import {activePreset, presetToJson} from "@chainsafe/lodestar-params";
import {Api, ReqTypes, getReturnTypes} from "../../src/routes/config";
import {getClient} from "../../src/client/config";
import {getRoutes} from "../../src/server/config";
import {runGenericServerTest} from "../utils/genericServerTest";
import {expect} from "chai";

/* eslint-disable @typescript-eslint/naming-convention */

describe("config", () => {
  const configJson = chainConfigToJson(chainConfig);
  const presetJson = presetToJson(activePreset);
  const jsonSpec = {...configJson, ...presetJson};

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
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
  });

  it("Serialize Partial Spec object", () => {
    const returnTypes = getReturnTypes();

    const partialJsonSpec: Record<string, string> = {
      PRESET_BASE: "mainnet",
      DEPOSIT_CONTRACT_ADDRESS: "0xff50ed3d0ec03ac01d4c79aad74928bff48a7b2b",
      GENESIS_FORK_VERSION: "0x00001020",
      TERMINAL_TOTAL_DIFFICULTY: "115792089237316195423570985008687907853269984665640564039457584007913129639936",
      MIN_GENESIS_TIME: "1606824000",
    };

    const jsonRes = returnTypes.getSpec.toJson({data: partialJsonSpec});
    const specRes = returnTypes.getSpec.fromJson(jsonRes);

    expect(specRes).to.deep.equal({data: partialJsonSpec}, "Wrong toJson -> fromJson");
  });
});

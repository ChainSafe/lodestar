import {config} from "@chainsafe/lodestar-config/default";
import {Api, DeletionStatus, ImportStatus, ReqTypes} from "../../src/keymanager/routes";
import {getClient} from "../../src/keymanager/client";
import {getRoutes} from "../../src/keymanager/server";
import {runGenericServerTest} from "../utils/genericServerTest";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IHttpClient} from "../../src/client/utils";

describe("keymanager", () => {
  runGenericServerTest<Api, ReqTypes>(
    config,
    (config: IChainForkConfig, httpClient: IHttpClient) => {
      return getClient(httpClient);
    },
    getRoutes,
    {
      listKeys: {
        args: [],
        res: {
          data: [
            {
              validatingPubkey: "0x",
              derivationPath: "",
              readonly: false,
            },
          ],
        },
      },
      importKeystores: {
        args: [["key1"], ["pass1"], "slash_protection"],
        res: {data: [{status: ImportStatus.imported}]},
      },
      deleteKeystores: {
        args: [["key1"]],
        res: {data: [{status: DeletionStatus.deleted}], slashingProtection: "slash_protection"},
      },
    }
  );
});

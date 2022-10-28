import {request} from "node:http";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parse} from "node:url";
import {Epoch} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {IChainForkConfig} from "@lodestar/config";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __dirname = dirname(fileURLToPath(import.meta.url));

export const logFilesDir = "test-logs";

export const avg = (arr: number[]): number => {
  return arr.length === 0 ? 0 : arr.reduce((p, c) => p + c, 0) / arr.length;
};

export const getForkName = (epoch: Epoch, config: IChainForkConfig): ForkName => {
  if (epoch < config.ALTAIR_FORK_EPOCH) {
    return ForkName.phase0;
  } else if (epoch < config.BELLATRIX_FORK_EPOCH) {
    return ForkName.altair;
  } else {
    return ForkName.bellatrix;
  }
};

export const callHttp = async (
  url: string,
  method: string,
  data?: unknown
): Promise<{status: number; data: Record<string, unknown>}> => {
  const opts = parse(url);

  return new Promise((resolve, reject) => {
    const req = request({...opts, method, headers: {"Content-Type": "application/json"}}, function (res) {
      let data = "";

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data = data + chunk;
      });
      res.on("end", () => {
        if (res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({status: res.statusCode ?? 500, data: JSON.parse(data) as Record<string, unknown>});
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
};

export const FAR_FUTURE_EPOCH = 10 ** 12;
export const BN_P2P_BASE_PORT = 4000;
export const BN_REST_BASE_PORT = 5000;
export const KEY_MANAGER_BASE_PORT = 6000;
export const EXTERNAL_SIGNER_BASE_PORT = 7000;
export const EL_ETH_BASE_PORT = 8000;
export const EL_ENGINE_BASE_PORT = 9000;
export const LODESTAR_BINARY_PATH = `${__dirname}/../../../bin/lodestar.js`;

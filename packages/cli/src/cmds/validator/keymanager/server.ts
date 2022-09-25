import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {RestApiServer, RestApiServerOpts, RestApiServerModules} from "@lodestar/beacon-node";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@lodestar/api/keymanager";
import {registerRoutes} from "@lodestar/api/keymanager/server";
import {IChainForkConfig} from "@lodestar/config";

import {writeFile600Perm} from "../../../util/index.js";

export type KeymanagerRestApiServerOpts = RestApiServerOpts & {
  isAuthEnabled: boolean;
  tokenDir?: string;
};

export const keymanagerRestApiServerOptsDefault: KeymanagerRestApiServerOpts = {
  address: "127.0.0.1",
  port: 5062,
  cors: "*",
  isAuthEnabled: true,
  // Slashing protection DB has been reported to be 3MB https://github.com/ChainSafe/lodestar/issues/4530
  bodyLimit: 20 * 1024 * 1024, // 20MB
};

export type KeymanagerRestApiServerModules = RestApiServerModules & {
  config: IChainForkConfig;
  api: Api;
};

export const apiTokenFileName = "api-token.txt";

export class KeymanagerRestApiServer extends RestApiServer {
  private readonly apiTokenPath: string;
  private readonly isAuthEnabled: boolean;

  constructor(optsArg: Partial<KeymanagerRestApiServerOpts>, modules: KeymanagerRestApiServerModules) {
    // Apply opts defaults
    const opts = {
      ...keymanagerRestApiServerOptsDefault,
      // optsArg is a Partial type, any of its properties can be undefined. If port is set to undefined,
      // it overrides the default port value in restApiOptionsDefault to be undefined.
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
    };

    const apiTokenPath = path.join(opts.tokenDir ?? ".", apiTokenFileName);
    let bearerToken: string | undefined;

    if (opts.isAuthEnabled) {
      // Generate a new token if token file does not exist or file do exist, but is empty
      bearerToken = readFileIfExists(apiTokenPath) ?? `api-token-${toHexString(crypto.randomBytes(32))}`;
      writeFile600Perm(apiTokenPath, bearerToken, {encoding: "utf8"});
    }

    super({address: opts.address, port: opts.port, cors: opts.cors, bearerToken}, modules);

    // Instantiate and register the keymanager routes
    registerRoutes(this.server, modules.config, modules.api);

    this.apiTokenPath = apiTokenPath;
    this.isAuthEnabled = opts.isAuthEnabled;
  }

  async listen(): Promise<void> {
    await super.listen();

    if (this.isAuthEnabled) {
      this.logger.info(`REST api server keymanager bearer access token located at:\n\n${this.apiTokenPath}\n`);
    } else {
      this.logger.warn("REST api server keymanager started without authentication");
    }
  }
}

function readFileIfExists(filepath: string): string | null {
  try {
    return fs.readFileSync(filepath, "utf8").trim();
  } catch (e) {
    if ((e as {code: string}).code === "ENOENT") return null;
    else throw e;
  }
}

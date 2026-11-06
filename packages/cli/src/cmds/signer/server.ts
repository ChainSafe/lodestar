import {SignerApiMethods, registerRoutes} from "@lodestar/api/signer/server";
import {RestApiServer, RestApiServerModules, RestApiServerOpts} from "@lodestar/beacon-node";

export type SignerRestApiServerOpts = RestApiServerOpts;

export const signerRestApiServerOptsDefault: SignerRestApiServerOpts = {
  address: "127.0.0.1",
  port: 9000,
  cors: "*",
  // Pre-bellatrix blocks are sent in full, a phase0 block with maximum attestations is a few MB of JSON
  bodyLimit: 10 * 1024 * 1024,
  stacktraces: false,
};

export type SignerRestApiServerModules = RestApiServerModules & {
  api: SignerApiMethods;
};

export class SignerRestApiServer extends RestApiServer {
  constructor(optsArg: Partial<SignerRestApiServerOpts>, modules: SignerRestApiServerModules) {
    // optsArg is a Partial type, any of its properties can be undefined. If port is set to undefined,
    // it overrides the default port value in signerRestApiServerOptsDefault to be undefined.
    const opts = {
      ...signerRestApiServerOptsDefault,
      ...Object.fromEntries(Object.entries(optsArg).filter(([_, v]) => v != null)),
    };

    super(opts, modules);

    registerRoutes(this.server, modules.api);
  }
}

import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {signerHandler} from "./handler.js";
import {ISignerCliArgs, signerOptions} from "./options.js";
import {slashingProtection} from "./slashingProtection/index.js";

export const signer: CliCommand<ISignerCliArgs, GlobalArgs> = {
  command: "signer",
  describe: "Run a remote signer serving the Ethereum remote signing API for local keystores",
  docsFolder: "run/signer-management",
  examples: [
    {
      command: "signer --network hoodi --importKeystores ./keystores --importKeystoresPassword ./password.txt",
      title: "Base `signer` command",
      description:
        "Serve the remote signing API on http://127.0.0.1:9000 for all keystores in the directory, " +
        "connect a validator client with `validator --externalSigner.url http://127.0.0.1:9000 --externalSigner.fetch`",
    },
  ],
  options: signerOptions,
  handler: signerHandler,
  subcommands: [slashingProtection],
};

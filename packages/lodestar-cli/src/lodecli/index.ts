import * as yargs from "yargs";

import * as options from "./options";

import * as beaconCmd from "./cmds/beacon";

yargs
  .env("LODECLI")
  .options(options)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .command(beaconCmd as any)
  .demandCommand()
  .showHelpOnFail(false)
  .help()
  .wrap(yargs.terminalWidth())
  .argv;

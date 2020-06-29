import * as yargs from "yargs";

import * as beaconCmd from "./cmds/beacon";

import {devCommandModule} from "./cmds/dev";
import {globalOptions} from "./options";

yargs
  .env("LODESTAR")
  .options(globalOptions)
  .command(devCommandModule)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .command(beaconCmd as any)
  .demandCommand()
  .showHelpOnFail(false)
  .help()
  .wrap(yargs.terminalWidth())
  .parse();

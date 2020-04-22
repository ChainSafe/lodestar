import * as yargs from "yargs";

import * as beacon from "./cmds/beacon";

yargs
  .command(beacon)
  .demandCommand()
  .help()
  .argv;

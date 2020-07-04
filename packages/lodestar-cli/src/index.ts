import * as yargs from "yargs";

import * as beaconCmd from "./cmds/beacon";

import {devCommandModule} from "./cmds/dev";
import {validatorCommandModule} from "./cmds/validator";
import {globalOptions} from "./options";
import {YargsError} from "./util/errors";


yargs
  .env("LODESTAR")
  .options(globalOptions)
  .command(devCommandModule)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .command(beaconCmd as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .command(validatorCommandModule as any)
  .demandCommand()
  .showHelpOnFail(false)
  .help()
  .wrap(yargs.terminalWidth())
  .fail((msg, err) => {
    if (err) {
      if (err instanceof YargsError) {
        // eslint-disable-next-line no-console
        console.error(` ✖ ${err.message}\n`);
      } else {
        // eslint-disable-next-line no-console
        console.error(` ✖ ${err.stack}\n`);
      }
      process.exit(1);
    }
  })
  .parse();

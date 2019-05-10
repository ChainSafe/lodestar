/**
 * @module cli
 */

// NOTE :: All commands are stubbed as examples
// Useful repo https://github.com/tsantef/commander-starter
import program from "commander";
import * as commands from "./commands";
import logger from "../logger/winston";

program
  .version('0.0.1');


//register all exported commands
Object.keys(commands)
  .forEach(commandName => {
    new commands[commandName]().register(program);
  });

program.on('command:*', function () {
  console.error('Invalid command: %s \n', program.args.join(' '));
  program.help();
});
try {
  // CLI ends after being parsed
  program.parse(process.argv);
} catch (e) {
  logger.error(e.message);
}


// This catches all other statements
if (!program.args.length) program.help();



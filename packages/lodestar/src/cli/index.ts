/* eslint-disable no-console */
/**
 * @module cli
 */
// NOTE :: All commands are stubbed as examples
// Useful repo https://github.com/tsantef/commander-starter
import program from "commander";
import * as commands from "./commands";

program
  .version("0.0.1");


//register all exported commands
Object.keys(commands)
  .forEach(commandName => {
    // @ts-ignore
    // eslint-disable-next-line import/namespace
    new commands[commandName]().register(program);
  });

program.on("command:*", function () {
  console.error("Invalid command: %s \n", program.args.join(" "));
  program.help();
});
try {
  // CLI ends after being parsed
  program.parse(process.argv);
} catch (e) {
  // logger.error(e.message + '\n' + e.stack);
  console.error(e.message + "\n" + e.stack);
}


// This catches all other statements
if (!program.args.length) program.help();



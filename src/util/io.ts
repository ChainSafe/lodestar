import readline from "readline";

interface IHiddenReadlineInterface extends readline.Interface {
  output?: any;
  _writeToOutput?(stringToWrite: string): void;
}


export function promptPassword(passwordPrompt: string): Promise<string>{
  const rl: IHiddenReadlineInterface =
    readline.createInterface({input: process.stdin, output: process.stdout});

  rl._writeToOutput = function _writeToOutput(stringToWrite: string): void {
    if (stringToWrite === passwordPrompt || stringToWrite.match(/\n/g))
      rl.output.write(stringToWrite);
    else
      rl.output.write("*");
  };

  return new Promise((resolve): void => {
    rl.question(passwordPrompt, function(password: string): void {
      rl.close();
      resolve(password);
    });
  });
}


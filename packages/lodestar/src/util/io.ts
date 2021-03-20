import readline from "readline";

interface IHiddenReadlineInterface extends readline.Interface {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: {write: (arg0: string) => void};
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _writeToOutput?(stringToWrite: string): void;
}

export function promptPassword(passwordPrompt: string): Promise<string> {
  const rl: IHiddenReadlineInterface = readline.createInterface({input: process.stdin, output: process.stdout});

  // eslint-disable-next-line @typescript-eslint/naming-convention
  rl._writeToOutput = function _writeToOutput(stringToWrite: string): void {
    if (stringToWrite === passwordPrompt || stringToWrite.match(/\n/g)) rl.output?.write(stringToWrite);
    else rl.output?.write("*");
  };

  return new Promise((resolve): void => {
    rl.question(passwordPrompt, function (password: string): void {
      rl.close();
      resolve(password);
    });
  });
}

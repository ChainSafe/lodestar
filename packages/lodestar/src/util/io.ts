import readline from "readline";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import keystore from "./keystore";
import fs from "fs";
import {PrivateKey} from "@chainsafe/bls/lib/privateKey";

interface IHiddenReadlineInterface extends readline.Interface {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// This returns a promise
export async function getKeyFromFileOrKeystore(key: string): Promise<Keypair> {
  if (fs.existsSync(key)) {
    const password = await promptPassword("Enter password to decrypt the keystore: ");
    return keystore.getKeyFromKeyStore(key, password);
  } else {
    return new Keypair(PrivateKey.fromHexString(key));
  }
}

export function getKeyFromFileOrKeystoreWithPassword(key: string, password: string): Keypair {
  if (fs.existsSync(key)) {
    return keystore.getKeyFromKeyStore(key, password);
  } else {
    return new Keypair(PrivateKey.fromHexString(key));
  }
}


import {loadYaml, dumpYaml} from "@chainsafe/eth2.0-spec-test-util";

function fromHexString(input: string): Buffer {
  return Buffer.from(input.replace("0x", ""), "hex");
}

function toHexString(output: Buffer): string {
  return "0x" + output.toString("hex");
}

interface OutputParser {
  parse: (string) => Buffer;
  dump: (Buffer) => string;
}

export const outputParsers: Record<string, OutputParser> = {
  hex: {
    parse: fromHexString,
    dump: toHexString,
  },
};

interface InputParser {
  parse: (string) => any;
  dump: (any) => string;
}


export const inputParsers: Record<string, InputParser> = {
  yaml: {
    parse: loadYaml,
    dump: dumpYaml,
  },
};

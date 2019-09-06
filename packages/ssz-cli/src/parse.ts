import {loadYaml, dumpYaml} from "@chainsafe/eth2.0-spec-test-util";
import {expandYamlValue, unexpandInput} from "@chainsafe/lodestar/src/util/expandYamlValue";

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
  parse: (string, AnySSZType) => any;
  dump: (any, AnySSZType) => string;
}

export const inputParsers: Record<string, InputParser> = {
  yaml: {
    parse: (input, type) => expandYamlValue(loadYaml(input), type),
    dump: (value, type) => dumpYaml(unexpandInput(value,type, true)),
  },
};

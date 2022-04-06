// Forked from https://github.com/nodeca/js-yaml/blob/master/lib/js-yaml/type/int.js
// Currently only supports loading ints
import yaml from "js-yaml";

const {Type} = yaml;

function isHexCode(c: number): boolean {
  return (
    // 0, 9
    (0x30 <= c && c <= 0x39) ||
    // A, F
    (0x41 <= c && c <= 0x46) ||
    // a, f
    (0x61 <= c && c <= 0x66)
  );
}

function isOctCode(c: number): boolean {
  return 0x30 /* 0 */ <= c && c <= 0x37 /* 7 */;
}

function isDecCode(c: number): boolean {
  return 0x30 /* 0 */ <= c && c <= 0x39 /* 9 */;
}

function resolveYamlInteger(data: string): boolean {
  if (data === null) return false;

  const max = data.length;
  let ch,
    index = 0,
    hasDigits = false;

  if (!max) return false;

  ch = data[index];

  // sign
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }

  if (ch === "0") {
    // 0
    if (index + 1 === max) return true;
    ch = data[++index];

    // base 2, base 8, base 16

    if (ch === "b") {
      // base 2
      index++;

      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }

    if (ch === "x") {
      // base 16
      index++;

      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }

    // base 8
    for (; index < max; index++) {
      ch = data[index];
      if (ch === "_") continue;
      if (!isOctCode(data.charCodeAt(index))) return false;
      hasDigits = true;
    }
    return hasDigits && ch !== "_";
  }

  // base 10 (except 0) or base 60

  // value should not start with `_`;
  if (ch === "_") return false;

  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (ch === ":") break;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }

  // Should have digits and should not end with `_`
  if (!hasDigits || ch === "_") return false;

  // if !base60 - done;
  if (ch !== ":") return true;

  // base60 almost not used, no needs to optimize
  return /^(:[0-5]?[0-9])+$/.test(data.slice(index));
}

function constructYamlInteger(data: string): bigint {
  let value: string | bigint = data,
    sign = 1,
    ch,
    base: number | bigint;
  const digits: number[] = [];

  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }

  ch = value[0];

  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }

  if (value === "0") return BigInt(0);

  if (ch === "0") {
    if (value[1] === "b" || value[1] === "x") return BigInt(value) * BigInt(sign);
    return BigInt("0o" + value) * BigInt(sign);
  }

  if (value.indexOf(":") !== -1) {
    for (const v of value.split(":")) {
      digits.unshift(parseInt(v, 10));
    }
    value = BigInt(0);
    base = BigInt(1);

    for (const d of digits) {
      value = (BigInt(value) + BigInt(base)) * BigInt(d);
      base = BigInt(base) * BigInt(60);
    }

    return value * BigInt(sign);
  }

  return BigInt(value) * BigInt(sign);
}

function isInteger(object: unknown): boolean {
  return typeof object === "bigint" || typeof object === "number";
}

export const intType = new Type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  instanceOf: BigInt,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  represent: {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    binary: function binary(obj: number) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    octal: function octal(obj: number) {
      return obj >= 0 ? "0" + obj.toString(8) : "-0" + obj.toString(8).slice(1);
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    decimal: function decimal(obj: number) {
      return obj.toString(10);
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    hexadecimal: function hexadecimal(obj: number) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    },
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"],
  },
});

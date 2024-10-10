/* eslint-disable no-console */
import fs from "node:fs";

const primitiveTypeof = ["number", "string", "bigint", "boolean"];
export type BufferType = Uint8Array | Uint32Array;
export type PrimitiveType = number | string | bigint | boolean | BufferType;
export type DiffableCollection = Record<string | number, PrimitiveType>;
export type Diffable = PrimitiveType | Array<PrimitiveType> | DiffableCollection;

export interface Diff {
  objectPath: string;
  errorMessage?: string;
  val1: Diffable;
  val2: Diffable;
}

export function diffUint8Array(val1: Uint8Array, val2: PrimitiveType, objectPath: string): Diff[] {
  if (!(val2 instanceof Uint8Array)) {
    return [
      {
        objectPath,
        errorMessage: `val1${objectPath} is a Uint8Array, but val2${objectPath} is not`,
        val1,
        val2,
      },
    ];
  }
  const hex1 = Buffer.from(val1).toString("hex");
  const hex2 = Buffer.from(val2).toString("hex");
  if (hex1 !== hex2) {
    return [
      {
        objectPath,
        val1: `0x${hex1}`,
        val2: `0x${hex2}`,
      },
    ];
  }
  return [];
}

export function diffUint32Array(val1: Uint32Array, val2: PrimitiveType, objectPath: string): Diff[] {
  if (!(val2 instanceof Uint32Array)) {
    return [
      {
        objectPath,
        errorMessage: `val1${objectPath} is a Uint32Array, but val2${objectPath} is not`,
        val1,
        val2,
      },
    ];
  }
  const diffs: Diff[] = [];
  val1.forEach((value, index) => {
    const value2 = val2[index];
    if (value !== value2) {
      diffs.push({
        objectPath: `${objectPath}[${index}]`,
        val1: `0x${value.toString(16).padStart(8, "0")}`,
        val2: value2 ? `0x${val2[index].toString(16).padStart(8, "0")}` : "undefined",
      });
    }
  });
  return diffs;
}

function diffPrimitiveValue(val1: PrimitiveType, val2: PrimitiveType, objectPath: string): Diff[] {
  if (val1 instanceof Uint8Array) {
    return diffUint8Array(val1, val2, objectPath);
  }
  if (val1 instanceof Uint32Array) {
    return diffUint32Array(val1, val2, objectPath);
  }

  const diff = {objectPath, val1, val2} as Diff;
  const type1 = typeof val1;
  if (!primitiveTypeof.includes(type1)) {
    diff.errorMessage = `val1${objectPath} is not a supported type`;
  }
  const type2 = typeof val2;
  if (!primitiveTypeof.includes(type2)) {
    diff.errorMessage = `val2${objectPath} is not a supported type`;
  }
  if (type1 !== type2) {
    diff.errorMessage = `val1${objectPath} is not the same type as val2${objectPath}`;
  }
  if (val1 !== val2) {
    return [diff];
  }
  return [];
}

function isPrimitiveValue(val: unknown): val is PrimitiveType {
  if (Array.isArray(val)) return false;
  if (typeof val === "object") {
    return val instanceof Uint8Array || val instanceof Uint32Array;
  }
  return true;
}

function isDiffable(val: unknown): val is Diffable {
  return !(typeof val === "function" || typeof val === "symbol" || typeof val === "undefined" || val === null);
}

export function getDiffs(val1: Diffable, val2: Diffable, objectPath: string): Diff[] {
  if (isPrimitiveValue(val1)) {
    if (!isPrimitiveValue(val2)) {
      return [
        {
          objectPath,
          errorMessage: `val1${objectPath} is a primitive value and val2${objectPath} is not`,
          val1,
          val2,
        },
      ];
    }
    return diffPrimitiveValue(val1, val2, objectPath);
  }

  const isArray = Array.isArray(val1);
  let errorMessage: string | undefined;
  if (isArray && !Array.isArray(val2)) {
    errorMessage = `val1${objectPath} is an array and val2${objectPath} is not`;
  } else if (typeof val1 === "object" && typeof val2 !== "object") {
    errorMessage = `val1${objectPath} is a nested object and val2${objectPath} is not`;
  }
  if (errorMessage) {
    return [
      {
        objectPath,
        errorMessage,
        val1,
        val2,
      },
    ];
  }

  const diffs: Diff[] = [];
  for (const [index, value] of Object.entries(val1)) {
    if (!isDiffable(value)) {
      diffs.push({objectPath, val1, val2, errorMessage: `val1${objectPath} is not Diffable`});
      continue;
    }
    const value2 = (val2 as DiffableCollection)[index];
    if (!isDiffable(value2)) {
      diffs.push({objectPath, val1, val2, errorMessage: `val2${objectPath} is not Diffable`});
      continue;
    }
    const innerPath = isArray ? `${objectPath}[${index}]` : `${objectPath}.${index}`;
    diffs.push(...getDiffs(value, value2, innerPath));
  }
  return diffs;
}

/**
 * Find the different values on complex, nested objects. Outputs the path through the object to
 * each value that does not match from val1 and val2. Optionally can output the values that differ.
 *
 * For objects that differ greatly, can write to a file instead of the terminal for analysis
 *
 * ## Example
 * ```ts
 * const obj1 = {
 *   key1: {
 *     key2: [
 *       { key3: 1 },
 *       { key3: new Uint8Array([1, 2, 3]) }
 *     ]
 *   },
 *   key4: new Uint32Array([1, 2, 3]),
 *   key5: 362436
 * };
 *
 * const obj2 = {
 *   key1: {
 *     key2: [
 *       { key3: 1 },
 *       { key3: new Uint8Array([1, 2, 4]) }
 *     ]
 *   },
 *   key4: new Uint32Array([1, 2, 4])
 *   key5: true
 * };
 *
 * diffObjects(obj1, obj2, true);
 *
 *
 * ```
 *
 * ## Output
 * ```sh
 * val.key1.key2[1].key3
 *   - 0x010203
 *   - 0x010204
 * val.key4[2]
 *   - 0x00000003
 *   - 0x00000004
 * val.key5
 *   val1.key5 is not the same type as val2.key5
 *   - 362436
 *   - true
 * ```
 */
export function diff(val1: unknown, val2: unknown, outputValues = false, filename?: string): void {
  if (!isDiffable(val1)) {
    // biome-ignore lint/suspicious/noConsoleLog: <explanation>
    console.log("val1 is not Diffable");
    return;
  }
  if (!isDiffable(val2)) {
    // biome-ignore lint/suspicious/noConsoleLog: <explanation>
    console.log("val2 is not Diffable");
    return;
  }
  const diffs = getDiffs(val1, val2, "");
  let output = "";
  if (diffs.length) {
    diffs.forEach((diff) => {
      let diffOutput = `value${diff.objectPath}`;
      if (diff.errorMessage) {
        diffOutput += `\n  ${diff.errorMessage}`;
      }
      if (outputValues) {
        diffOutput += `\n  - ${diff.val1.toString()}\n  - ${diff.val2.toString()}\n`;
      }
      output += `${diffOutput}\n`;
    });
    if (filename) {
      fs.writeFileSync(filename, output);
    } else {
      // biome-ignore lint/suspicious/noConsoleLog: <explanation>
      console.log(output);
    }
  }
}

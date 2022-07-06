import fs from "node:fs";

const DELIMITER = ",";

/**
 * Returns a callback to append csv data to `filepath`
 */
export function csvAppend<T extends Record<string, number>>(filepath: string): (values: T) => void {
  let firstWrite = !fs.existsSync(filepath) || fs.readFileSync(filepath, "utf8").length === 0;

  const writeStream = fs.createWriteStream(filepath, {
    flags: "a",
  });

  return function write(values: T): void {
    if (firstWrite) {
      writeStream.write(Object.keys(values).join(DELIMITER) + "\n");
      firstWrite = false;
    }

    writeStream.write(Object.values(values).join(DELIMITER) + "\n");
  };
}

export function readCsv<T extends Record<string, number>>(filepath: string): T[] {
  const rows = fs.readFileSync(filepath, "utf8").trim().split("\n");

  // Return early if no data, to prevent type errors
  if (rows.length < 2) return [];

  const headerRow = rows[0];
  const dataRows = rows.slice(1);

  const values: T[] = [];

  const headers = headerRow.trim().split(DELIMITER);

  for (let j = 0; j < dataRows.length; j++) {
    const valuesRow = dataRows[j].trim().split(DELIMITER);
    const value = {} as T;
    for (let i = 0; i < headers.length; i++) {
      const str = valuesRow[i];
      const num = parseInt(str);
      value[headers[i] as keyof T] = (isNaN(num) ? str : num) as T[keyof T];
    }
    values[j] = value;
  }

  return values;
}

import fs from "fs";
import process from "process";

export async function readInput(inputFile: string, inputRaw: string): Promise<string> {
  if (inputFile) {
    return fs.readFileSync(inputFile, "utf8");
  } else if (inputRaw) {
    return inputRaw;
  } else {
    return await readStdin();
  }
}

export async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let input = "";
    process.stdin.on("readable", () => {
      let chunk: string;
      while ((chunk = process.stdin.read() as string) !== null) {
        input += chunk;
      }
    });
    process.stdin.on("end", () => {
      resolve(input);
    });
  })
}

export async function writeOutput(output: string, outputFile: string): Promise<void> {
  if (outputFile) {
    fs.writeFileSync(outputFile, output);
  } else {
    await writeStdout(output);
  }
}

export async function writeStdout(output: string): Promise<void> {
  process.stdout.setEncoding("utf8");
  process.stdout.write(output);
}

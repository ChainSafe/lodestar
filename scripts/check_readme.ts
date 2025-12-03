#!/usr/bin/env ts-node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function extractTypeScriptBlocks(readmePath: string): string[] {
  const content = fs.readFileSync(readmePath, "utf8");
  const blocks: string[] = [];

  const regex = /```(?:ts|typescript)\s+([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function compileSnippet(snippet: string, index: number, baseDir: string): readonly ts.Diagnostic[] {
  const fileName = path.join(baseDir, `__readme_snippet_${index}.ts`);
  fs.writeFileSync(fileName, snippet);

  const configPath = ts.findConfigFile(baseDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error("tsconfig.json not found in " + baseDir);
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, baseDir);

  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,

    // Custom options specific to readme files checking
    declaration: false,
    declarationMap: false,
    incremental: false,
    sourceMap: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noEmit: true,
    rootDir: baseDir,
  };

  const program = ts.createProgram({
    rootNames: [fileName],
    options: compilerOptions,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);

  fs.unlinkSync(fileName);
  return diagnostics;
}

function printDiagnostics(diags: ts.Diagnostic[], snippetIndex: number) {
  for (const diag of diags) {
    const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
    const location = diag.file
      ? `${diag.file.fileName}:${diag.file.getLineAndCharacterOfPosition(diag.start!).line + 1}`
      : "unknown";

    console.error(`Error in README snippet ${snippetIndex}:`);
    console.error(`  ${location}: ${message}\n`);
  }
}

function main() {
  const baseDir = process.cwd();
  const readmePath = path.join(baseDir, "README.md");

  if (!fs.existsSync(readmePath)) {
    console.error("No README.md found");
    process.exit(1);
  }

  const snippets = extractTypeScriptBlocks(readmePath);
  console.log(`Found ${snippets.length} TypeScript snippets`);

  let hasError = false;

  snippets.forEach((snippet, i) => {
    const diags = compileSnippet(snippet, i + 1, baseDir);
    if (diags.length > 0) {
      hasError = true;
      printDiagnostics(diags, i + 1);
    }
  });

  if (hasError) process.exit(1);
  console.log("All README TypeScript snippets are valid");
}

main();
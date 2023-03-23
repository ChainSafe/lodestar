// TODO: Refactor the parsing to JSON to avoid the any escape hatch
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable no-restricted-imports */
import "../setup.js";
import {spawn} from "child_process";
import {readdirSync} from "fs";
import * as path from "path";
import {expect} from "chai";
import {rgPath} from "@vscode/ripgrep";
import {testLogger} from "../utils/logger.js";

interface ExportedValue {
  value: string;
  isUsedInModule: boolean;
}

/**
 * relative to pkg
 * Ex:
 * {
 *   "relativeName": '.'
 *   "relativeLocation": "./lib/index.js"
 * }
 * */
interface Subpackage {
  name: string;
  relativeName: string;
  relativeLocation: string;
}

describe("No dead-code", () => {
  /**
   * Example:
   * {
   *   "@lodestar/api": [
   *     "@lodestar/config",
   *     "@lodestar/params",
   *     "@lodestar/types",
   *     "@lodestar/utils"
   *   ],
   *   "@lodestar/beacon-node": [
   *     "@lodestar/api",
   *     "@lodestar/config",
   *     "@lodestar/db",
   *     "@lodestar/fork-choice",
   *     "@lodestar/light-client",
   *     "@lodestar/params",
   *     "@lodestar/reqresp",
   *     "@lodestar/state-transition",
   *     "@lodestar/types",
   *     "@lodestar/utils",
   *     "@lodestar/validator"
   *     ],
   *     ...etc
   * }
   * */
  let dependencyTree: {[pkg: string]: string[]};
  let isDependencyTreeLoaded = false;
  /**
   * Example:
   * {'@lodestar/api': './packages/api', '@lodestar/beacon-node': './packages/beacon-node'}
   *
   * */
  const directoriesPerPackages: {
    [pkg: string]: string;
  } = {};
  let isDirectoriesPerPackagesLoaded = false;
  /**
   * Example:
   * {
   *   '@lodestar/api': [
   *     {
   *       'name': '@lodestar/api',
   *       'relativeName': '.',
   *       'relativeLocation': './lib/index.js',
   *     },
   *     {
   *       'name': '@lodestar/api/beacon',
   *       'relativeName': './beacon',
   *       'relativeLocation': './lib/beacon/index.js',
   *     },
   *     {
   *       'name': '@lodestar/api/builder',
   *       'relativeName': './builder',
   *       'relativeLocation': './lib/builder/index.js',
   *     },
   *     {
   *       'name': '@lodestar/api/builder/server',
   *       'relativeName': './builder/server',
   *       'relativeLocation': './lib/builder/server/index.js',
   *     },
   *     {
   *       'name': '@lodestar/api/keymanager',
   *       'relativeName': './keymanager',
   *       'relativeLocation': './lib/keymanager/index.js',
   *     },
   *     {
   *       'name': '@lodestar/api/keymanager/server',
   *       'relativeName': './keymanager/server',
   *       'relativeLocation': './lib/keymanager/server/index.js',
   *     }
   *   ],
   *   '@lodestar/beacon-node': [
   *     {
   *       'name': '@lodestar/beacon-node',
   *       'relativeName': '.',
   *       'relativeLocation': './lib/index.js',
   *     },
   *     {
   *       'name': '@lodestar/beacon-node/api',
   *       'relativeName': './api',
   *       'relativeLocation': './lib/api/index.js',
   *     },
   *     ...etc
   *   ],
   *   ...etc
   * }
   *
   * */
  const subpackagesPerPackages: {[pkg: string]: Subpackage[]} = {};
  let isSubpackagePerPackagesLoaded = false;
  /**
   * Exports that are unused within the package of the subpackage.
   * Example:
   * {
   *   '@lodestar/api': [
   *     {
   *       'value': 'routes',
   *       'isUsedInModule': true
   *     }
   *     {
   *       'value': 'ServerApi',
   *       'isUsedInModule': false
   *     }
   *     {
   *       'value': 'ApiError',
   *       'isUsedInModule': true
   *     },
   *     ...etc
   *   ],
   *   '@lodestar/api/lib/beacon': [
   *     {
   *       'value': 'getClients',
   *       'isUsedInModule': true
   *     }
   *     {
   *       'value': 'allNamespaces',
   *       'isUsedInModule': false
   *     },
   *     ...etc
   *   ],
   *   ...etc
   * }
   * */
  const unusedExportsPerSubpackages: {[subpkg: string]: ExportedValue[]} = {};
  let isUnusedExportsPerSubpackagesLoaded = false;

  /**
   * For each subpackage, list import usage per exported values - if any
   * Example:
   * {
   *   '@lodestar/api': [
   *     'routes': {
   *         '@chainsafe/lodestar': [/home/user/lodestar/packages/cli/test/sim/endpoints.test.ts:5', ...etc],
   *         '@lodestar/beacon-node': [/home/user/lodestar/packages/beacon-node/src/foo/bar.ts:8', ...etc],
   *         ...etc
   *     }
   *     'ServerApi': {
   *         '@chainsafe/lodestar': [/home/user/lodestar/packages/cli/test/utils/mockBeaconApiServer.ts'', ...etc],
   *         ...etc
   *     }
   *     'ApiError': {
   *         '@chainsafe/lodestar': ['/home/user/lodestar/packages/cli/test/utils/simulation/utils/network.ts', '/home/user/lodestar/packages/cli/test/utils/simulation/assertions/nodeAssertion.ts', ...etc],
   *         ...etc
   *     }
   *     ...etc
   *   ],
   *   '@lodestar/api/lib/beacon': [
   *       ...etc
   *   ],
   *   ...etc
   * }
   * */
  const importsPerSubpackages: {[subpkg: string]: {[value: string]: {[pkg: string]: string[]}}} = {};
  let isImportsPerSubpackagesLoaded = false;
  const logger = testLogger();

  before(function (done) {
    this.timeout(0);
    // get the dependency tree
    const lerna = spawn("npx", ["lerna", "list", "--graph"], {cwd: `${process.cwd()}/../../`});
    let result = "";
    lerna.stdout.on("data", function (data) {
      result += data;
    });
    lerna.on("close", function () {
      dependencyTree = JSON.parse(result); // this could throw an error and stop the test
      // only keep lodestar-related dependencies
      const lodestarPackages = Object.keys(dependencyTree);
      for (const lodestarPackage of lodestarPackages) {
        dependencyTree[lodestarPackage] = dependencyTree[lodestarPackage].filter((dep) =>
          lodestarPackages.includes(dep)
        );
      }

      isDependencyTreeLoaded = true;
    });

    // get a one-to-one mapping between a package and its local directory location
    // get the list of subpackage per packages
    // how?: go to each packages/ subdirectory
    // how?: in each corresponding subdirectory, run `yarn info --graph --json --silent`, parse to JSON and get the `exports` and `name` parameter at the root

    // first, get list of directories in <root>/packages except this one:
    const packageDirectories = readdirSync(`${process.cwd()}/../../packages`, {withFileTypes: true})
      .filter((dirent) => dirent.isDirectory() && dirent.name !== path.basename(path.resolve(process.cwd())))
      .map((dirent) => dirent.name);
    const areYarnDonePerDirectory: {[directoryName: string]: boolean} = packageDirectories.reduce(
      (acc: {[directoryName: string]: boolean}, directory) => {
        acc[directory] = false;
        return acc;
      },
      {}
    );
    for (const directoryName of packageDirectories) {
      areYarnDonePerDirectory[directoryName] = false;
      const directory = path.join(process.cwd(), `../../packages/${directoryName}`);
      const yarnInfoCommand = spawn("yarn", ["info", "--silent", "--json", "--graph"], {cwd: directory});
      let result = "";
      yarnInfoCommand.stdout.on("data", function (data) {
        result += data;
      });
      yarnInfoCommand.on("close", function () {
        //
        try {
          const packageJson: any = JSON.parse(result); // this could throw and error and stop the test
          const pkg = packageJson.data.name;
          directoriesPerPackages[pkg] = path.join("packages", directoryName);
          if (typeof packageJson.data.exports === "string") {
            const subpkg = {name: pkg, relativeName: ".", relativeLocation: packageJson.data.exports};
            if (pkg in subpackagesPerPackages) {
              subpackagesPerPackages[pkg].push(subpkg);
            } else {
              subpackagesPerPackages[pkg] = [subpkg];
            }
          } else {
            for (const [relativeName, relativeLocation] of Object.entries(packageJson.data.exports)) {
              const subpkg = {
                name: path.join(pkg, relativeName),
                relativeName: relativeName,
                relativeLocation: (relativeLocation as any).import,
              };
              if (pkg in subpackagesPerPackages) {
                subpackagesPerPackages[pkg].push(subpkg);
              } else {
                subpackagesPerPackages[pkg] = [subpkg];
              }
            }
            // sorting in descending order of depth (@lodestar/api/builder/server > @lodestar/api/beacon/server > @lodestar/api/builder > @lodestar/api/beacon > @lodestar/api)
            subpackagesPerPackages[pkg].sort(function (subpkgA, subpkgB) {
              return subpkgB.relativeLocation.split("/").length - subpkgA.relativeLocation.split("/").length;
            });
          }
          areYarnDonePerDirectory[directoryName] = true;
          if (!Object.values(areYarnDonePerDirectory).includes(false)) {
            isDirectoriesPerPackagesLoaded = true;
            isSubpackagePerPackagesLoaded = true;
          }
        } catch (e) {
          logger.error(
            `Cannot run 'yarn info' in ${directoryName} - could be due to the package still being unpublished`,
            {rawResult: result},
            e as Error
          );
          areYarnDonePerDirectory[directoryName] = true;
          if (!Object.values(areYarnDonePerDirectory).includes(false)) {
            isDirectoriesPerPackagesLoaded = true;
            isSubpackagePerPackagesLoaded = true;
          }
        }
      });
    }
    //
    //
    const waitUntilYarnDone = setInterval(() => {
      if (isDirectoriesPerPackagesLoaded && isSubpackagePerPackagesLoaded) {
        stopWaitingForYarn();
        loadUnusedExports();
        loadImports();
      }
    }, 500);

    function stopWaitingForYarn(): void {
      clearInterval(waitUntilYarnDone);
    }

    function loadUnusedExports(): void {
      // get the list of unused exported values per subpackage - only care about src/* and test/* directories (some values are exported only to be tested), ignore lib/* directories
      // skip unused exported values from the test/* directory for now
      // exported values that are only used in tests are considered used
      // this list doesn't take into consideration cross-packages usage
      const repoRootDirectory = path.join(process.cwd(), "../../");
      const tsPruneCommand = spawn("npx", ["ts-prune", "-s", "'(.*/lib/.*)'", "-i", "'(.*/test/.*)'"], {
        cwd: repoRootDirectory,
        shell: true,
      }); // 'shell: true' is necessary otherwise spawn ignores the regex!
      let result = "";
      tsPruneCommand.stdout.on("data", function (data) {
        result += data;
      });
      tsPruneCommand.on("close", function () {
        const lines = result.split("\n");
        for (const line of lines) {
          if (line === "") {
            // for some reasons, the first line is an empty string
            continue;
          }
          const pathAndValue = line.split(":");
          const exportedValuePath = pathAndValue[0];
          // get string after '-', remove trailing space
          // we get: "<exportedValue> (used in module)" OR "<exportedValue"
          const exportedValueWithInModule: string = pathAndValue[1].split("-")[1].trim();
          // if true, it means the exported value is potentially unused but the value itself shall not be deleted, only 'export' keyword should be removed
          // if false, the value is potentially dead code that must be deleted entirely
          let isUsedInModule = false;
          if (exportedValueWithInModule.includes("(used in module)")) {
            isUsedInModule = true;
          }
          const exportedValue = {
            value: exportedValueWithInModule.replace(/ .*/, ""), // take first word (ignoring potential "(used in module)")
            isUsedInModule: isUsedInModule,
          };
          // const exportedValue = pathAndValue[1]
          for (const [pkg, subpkgs] of Object.entries(subpackagesPerPackages)) {
            const pkgLocation = directoriesPerPackages[pkg];
            for (const subpkg of subpkgs) {
              let subpkgLocation = path.join(pkgLocation, subpkg.relativeLocation);
              subpkgLocation = path.dirname(subpkgLocation);
              subpkgLocation = subpkgLocation.replace(/lib/g, "src");
              if (exportedValuePath.includes(subpkgLocation)) {
                if (subpkg.name in unusedExportsPerSubpackages) {
                  unusedExportsPerSubpackages[subpkg.name].push(exportedValue);
                } else {
                  unusedExportsPerSubpackages[subpkg.name] = [exportedValue];
                }
              }
            }
          }
        }
        isUnusedExportsPerSubpackagesLoaded = true;
      });
    }

    function loadImports(): void {
      // for each subpackage, get the list of values imported by each package that depends on it
      // example for @lodestar/api, run the following in the directory of each package that depends on it
      // rg --no-heading -g *.ts  "^.*?(import)(\s+\{*\s*)([^\{\}]+)(\s*\}*\s+)(from)(\s+)(['|\"]@lodestar/api['|\"]).*?$" -r '"$3"'
      // rg --no-heading -g *.ts  "^.*?(import)(\s+\{*\s*)([^\{\}]+)(\s*\}*\s+)(from)(\s+)(['|\"]@lodestar/api/lib/beacon['|\"]).*?$" -r '"$3"'
      // ...etc
      let numberOfRg = 0; // will be used to condition whether all `rg` has terminated
      const rgIsFinished: boolean[] = [];
      for (const [pkg, deps] of Object.entries(dependencyTree)) {
        for (const dep of deps) {
          for (const subpkg of subpackagesPerPackages[dep]) {
            numberOfRg += 1;
            // ex: lodestar/packages/check-dead-code/../../packages/cli
            const directory = path.join(process.cwd(), `../../${directoriesPerPackages[pkg]}`);
            // rgPath load rg in node_modules, we cd there to load the binary
            const rgCommand = spawn(
              "./rg",
              [
                "--no-heading",
                "-g",
                "*.ts",
                String.raw`"^.*?(import)(\s+\{*\s*)([^\{\}]+)(\s*\}*\s+)(from)(\s+)(['|\"]${subpkg.name}['|\"]).*?$"`,
                "-r",
                "'$3'",
                directory,
              ],
              {cwd: path.dirname(rgPath), shell: true}
            );
            let result = "";
            rgCommand.stdout.on("data", function (data) {
              result += data;
            });
            rgCommand.on("close", function () {
              const lines = result.split("\n");
              for (const line of lines) {
                if (line === "") {
                  // for some reasons, the first line is an empty string
                  continue;
                }
                const pathAndValues = line.split(":");
                const filename = pathAndValues[0];
                const values = pathAndValues[1];
                const imports = values.split(",");
                for (let imp of imports) {
                  imp = imp.trim();
                  const firstWord = imp.replace(/ .*/, "");
                  if (firstWord !== "*") {
                    addImportedValue(importsPerSubpackages, subpkg.name, firstWord, pkg, filename);
                  } else {
                    const importAs = imp.split("as")[1].trim();
                    // search in the file which parts are actually used
                    numberOfRg += 1;
                    const rgCommand = spawn(
                      "./rg",
                      ["--no-heading", String.raw`"^.*?(${importAs})(\.)(\w+).*?$"`, "-r", "'$3'", filename],
                      {cwd: path.dirname(rgPath), shell: true}
                    );
                    let result = "";
                    rgCommand.stdout.on("data", function (data) {
                      result += data;
                    });
                    rgCommand.on("close", function () {
                      if (result === "") {
                        // may be `${importAs} as unknown` type of usage (ex with importAs === 'constants')
                        // TODO: distinguish this case with the ones with an unused import
                        // for now we consider the whole value has been imported & used
                        // we use the special char '*' to say everything was imported & used
                        addImportedValue(importsPerSubpackages, subpkg.name, "*", pkg, filename);
                      } else {
                        const lines = result.split("\n");
                        for (const line of lines) {
                          if (line === "") {
                            // for some reasons, the first line is an empty string
                            continue;
                          }
                          addImportedValue(importsPerSubpackages, subpkg.name, line, pkg, filename);
                        }
                      }
                      rgIsFinished.push(true);
                      if (rgIsFinished.filter((finished) => finished === true).length === numberOfRg) {
                        // all commands finished executing
                        isImportsPerSubpackagesLoaded = true;
                      }
                    });
                  }
                }
              }
              rgIsFinished.push(true);
              if (rgIsFinished.filter((finished) => finished === true).length === numberOfRg) {
                // all commands finished executing
                isImportsPerSubpackagesLoaded = true;
              }
            });
          }
        }
      }
    }

    function addImportedValue(
      importsPerSubpackages: {[subpkg: string]: {[value: string]: {[pkg: string]: string[]}}},
      subpkg: string,
      importedValue: string,
      pkg: string,
      filename: string
    ): void {
      const location = {
        [pkg]: [filename],
      };
      if (subpkg in importsPerSubpackages) {
        if (importedValue in importsPerSubpackages[subpkg]) {
          if (pkg in importsPerSubpackages[subpkg][importedValue]) {
            importsPerSubpackages[subpkg][importedValue][pkg].push(filename);
          } else {
            importsPerSubpackages[subpkg][importedValue][pkg] = [filename];
          }
        } else {
          importsPerSubpackages[subpkg][importedValue] = location;
        }
      } else {
        importsPerSubpackages[subpkg] = {
          [importedValue]: location,
        };
      }
    }

    const waitUntilDone = setInterval(() => {
      if (
        isDependencyTreeLoaded &&
        isDirectoriesPerPackagesLoaded &&
        isSubpackagePerPackagesLoaded &&
        isUnusedExportsPerSubpackagesLoaded &&
        isImportsPerSubpackagesLoaded
      ) {
        stopWaiting();
        done();
      }
    }, 500);

    function stopWaiting(): void {
      clearInterval(waitUntilDone);
    }
  });

  it("Should not be different from the list of expected unused exported values", () => {
    // For each subpackages, list the exported values that are never imported
    const actualUnusedExportedValues: {[subpkg: string]: ExportedValue[]} = {};
    const expectedUnusedExportedValues: {[subpkg: string]: ExportedValue[]} = {};
    for (const [subpkg, exportedValues] of Object.entries(unusedExportsPerSubpackages)) {
      const unusedExportedValues = exportedValues.filter(
        (exportedValue) =>
          !(subpkg in importsPerSubpackages) ||
          (!(exportedValue.value in importsPerSubpackages[subpkg]) && !("*" in importsPerSubpackages)) // * means every values from the subpkg are used
      );
      if (unusedExportedValues.length !== 0) {
        actualUnusedExportedValues[subpkg] = unusedExportedValues;
      }
    }
    expect(actualUnusedExportedValues).deep.equals(expectedUnusedExportedValues);
  });
});

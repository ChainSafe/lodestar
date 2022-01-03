import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import fs from "fs";
import path from "path";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths";
import {BeaconNodeOptions, mergeBeaconNodeOptions} from "../../../src/config";
import {enrsToNetworkConfig, getInjectableBootEnrs, parseBootnodesFile} from "../../../src/networks";
import {bootEnrs as pyrmontBootEnrs} from "../../../src/networks/pyrmont";
import {testFilesDir} from "../../utils";

describe("config / beaconNodeOptions", () => {
  it("Should return pyrmont options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({
      network: "pyrmont",
      beaconNodeOptionsCli: {},
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal(pyrmontBootEnrs);
  });

  it("Should return added partial options", () => {
    const initialPartialOptions = {eth1: {enabled: true}};
    const editedPartialOptions = {eth1: {enabled: false}};

    const beaconNodeOptions = new BeaconNodeOptions({
      beaconNodeOptionsCli: initialPartialOptions,
    });
    beaconNodeOptions.set(editedPartialOptions);

    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial).to.deep.equal(editedPartialOptions);
  });

  it("Should return options with injected custom bootnodes", async () => {
    const expectedBootEnr = "enr:-KG4QOWkRj";
    const rootDir = testFilesDir;
    const bootnodesFile = path.join(testFilesDir, "bootnodesFile.txt");
    fs.writeFileSync(bootnodesFile, expectedBootEnr);
    const beaconPaths = getBeaconPaths({rootDir});
    beaconPaths.bootnodesFile = bootnodesFile;

    const injectableBootEnrs = await getInjectableBootEnrs(beaconPaths.bootnodesFile);

    const beaconNodeOptions = new BeaconNodeOptions({
      network: "pyrmont",
      beaconNodeOptionsCli: injectableBootEnrs,
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal([expectedBootEnr]);
  });

  it("Should return inline, CLI-provided boot ENR even if bootnodes file is provided", async () => {
    const bootnodesFileContent = "enr:-KG4QOWkRj";
    const expectedBootEnr = "enr:-W4gMj";

    const rootDir = testFilesDir;
    const bootnodesFile = path.join(testFilesDir, "bootnodesFile.txt");
    fs.writeFileSync(bootnodesFile, bootnodesFileContent);
    const beaconPaths = getBeaconPaths({rootDir});
    beaconPaths.bootnodesFile = bootnodesFile;

    const injectableBootEnrs = await getInjectableBootEnrs(beaconPaths.bootnodesFile);
    const beaconNodeOptionsCli = mergeBeaconNodeOptions(injectableBootEnrs, enrsToNetworkConfig([expectedBootEnr]));

    const beaconNodeOptions = new BeaconNodeOptions({
      network: "pyrmont",
      beaconNodeOptionsCli,
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal([expectedBootEnr]);
  });

  it("Should return default options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({
      beaconNodeOptionsCli: {},
    });

    // Assert only part of the data structure as ENR can't be compared directly
    const options = beaconNodeOptions.getWithDefaults();
    expect(options.eth1).to.deep.equal(defaultOptions.eth1);
  });
});

describe("config / bootnodes / parsing", () => {
  const testCases = [
    {
      name: "can parse inline JSON input",
      input: `
{
  "enrs": ["enr:-cabfg", "enr:-deadbeef"]
}
`,
      expected: ["enr:-cabfg", "enr:-deadbeef"],
    },
    {
      name: "can parse multiline JSON input",
      input: `
{
  "enrs": 
    [
      "enr:-cabfg",
      "enr:-deadbeef"
    ]
}
`,
      expected: ["enr:-cabfg", "enr:-deadbeef"],
    },
    {
      name: "Can parse YAML input",
      input: `
- "enr:-Iu4QGCUN3RjOLZCab4LLqlOqnnOB9BspIE30Nj5gQGoY00ZXCIW2PCXuGqDLHEPZJK9NO8SFZlKzFF-5rSbTyPqksoBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQJmy_5ZkaIFozyMd3gPygG1lVLQONuTL4C1j_smkZ9WmoN0Y3CCIyiDdWRwgiMo"
- "enr:-Iu4QCKxIZVqkBMGHOxfeDvY8Yp0V0uq2MQ8wFS2tQGMfQ1YVuER_WeyVmqKawz6H4JE1OVeN52_kJUdZmkuvpyETjMBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQNsaKrbnhjMgAcpHREHrZiCA7sXyEOokOck_1oc3zZMG4N0Y3CCJRyDdWRwgiUc"
- "enr:-Iu4QN6QRhX7abcUZ6E5eV9-AIUSXpNBSytiSNwG0FGWWifEevi98EDGhoPVt3e82j9KC2H7DiLtDGnj03MMrs707fEBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4Lu3nwG5diXILEh3LiAauCrNgtoTJxGZQER33BTDMKoN0Y3CCIyiDdWRwgiMo"
`,
      expected: [
        "enr:-Iu4QGCUN3RjOLZCab4LLqlOqnnOB9BspIE30Nj5gQGoY00ZXCIW2PCXuGqDLHEPZJK9NO8SFZlKzFF-5rSbTyPqksoBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQJmy_5ZkaIFozyMd3gPygG1lVLQONuTL4C1j_smkZ9WmoN0Y3CCIyiDdWRwgiMo",
        "enr:-Iu4QCKxIZVqkBMGHOxfeDvY8Yp0V0uq2MQ8wFS2tQGMfQ1YVuER_WeyVmqKawz6H4JE1OVeN52_kJUdZmkuvpyETjMBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQNsaKrbnhjMgAcpHREHrZiCA7sXyEOokOck_1oc3zZMG4N0Y3CCJRyDdWRwgiUc",
        "enr:-Iu4QN6QRhX7abcUZ6E5eV9-AIUSXpNBSytiSNwG0FGWWifEevi98EDGhoPVt3e82j9KC2H7DiLtDGnj03MMrs707fEBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4Lu3nwG5diXILEh3LiAauCrNgtoTJxGZQER33BTDMKoN0Y3CCIyiDdWRwgiMo",
      ],
    },
    {
      name: "Can parse normal txt-file input",
      input: `
### Ethereum Node Records
- "enr:-KG4QOWkRj"
`,
      expected: ["enr:-KG4QOWkRj"],
    },
    {
      name: "Can parse plain txt-file input",
      input: `
# Eth2 mainnet bootnodes
# ---------------------------------------
# 1. Tag nodes with maintainer
# 2. Keep nodes updated
# 3. Review PRs: check ENR duplicates, fork-digest, connection.

# Teku team's bootnodes
enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA
enr:-KG4QL-eqFoHy0cI31THvtZjpYUu_Jdw_MO7skQRJxY1g5HTN1A0epPCU6vi0gLGUgrzpU-ygeMSS8ewVxDpKfYmxMMGhGV0aDKQtTA_KgAAAAD__________4JpZIJ2NIJpcIQ2_DUbiXNlY3AyNTZrMaED8GJ2vzUqgL6-KD1xalo1CsmY4X1HaDnyl6Y_WayCo9GDdGNwgiMog3VkcIIjKA

# Prylab team's bootnodes
enr:-Ku4QImhMc1z8yCiNJ1TyUxdcfNucje3BGwEHzodEZUan8PherEo4sF7pPHPSIB1NNuSg5fZy7qFsjmUKs2ea1Whi0EBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQOVphkDqal4QzPMksc5wnpuC3gvSC8AfbFOnZY_On34wIN1ZHCCIyg
enr:-Ku4QP2xDnEtUXIjzJ_DhlCRN9SN99RYQPJL92TMlSv7U5C1YnYLjwOQHgZIUXw6c-BvRg2Yc2QsZxxoS_pPRVe0yK8Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMeFF5GrS7UZpAH2Ly84aLK-TyvH-dRo0JM1i8yygH50YN1ZHCCJxA
enr:-Ku4QPp9z1W4tAO8Ber_NQierYaOStqhDqQdOPY3bB3jDgkjcbk6YrEnVYIiCBbTxuar3CzS528d2iE7TdJsrL-dEKoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMw5fqqkw2hHC4F5HZZDPsNmPdB1Gi8JPQK7pRc9XHh-oN1ZHCCKvg
  `,
      expected: [
        "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA",
        "enr:-KG4QL-eqFoHy0cI31THvtZjpYUu_Jdw_MO7skQRJxY1g5HTN1A0epPCU6vi0gLGUgrzpU-ygeMSS8ewVxDpKfYmxMMGhGV0aDKQtTA_KgAAAAD__________4JpZIJ2NIJpcIQ2_DUbiXNlY3AyNTZrMaED8GJ2vzUqgL6-KD1xalo1CsmY4X1HaDnyl6Y_WayCo9GDdGNwgiMog3VkcIIjKA",
        "enr:-Ku4QImhMc1z8yCiNJ1TyUxdcfNucje3BGwEHzodEZUan8PherEo4sF7pPHPSIB1NNuSg5fZy7qFsjmUKs2ea1Whi0EBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQOVphkDqal4QzPMksc5wnpuC3gvSC8AfbFOnZY_On34wIN1ZHCCIyg",
        "enr:-Ku4QP2xDnEtUXIjzJ_DhlCRN9SN99RYQPJL92TMlSv7U5C1YnYLjwOQHgZIUXw6c-BvRg2Yc2QsZxxoS_pPRVe0yK8Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMeFF5GrS7UZpAH2Ly84aLK-TyvH-dRo0JM1i8yygH50YN1ZHCCJxA",
        "enr:-Ku4QPp9z1W4tAO8Ber_NQierYaOStqhDqQdOPY3bB3jDgkjcbk6YrEnVYIiCBbTxuar3CzS528d2iE7TdJsrL-dEKoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMw5fqqkw2hHC4F5HZZDPsNmPdB1Gi8JPQK7pRc9XHh-oN1ZHCCKvg",
      ],
    },
    {
      name: "Can parse YAML input without double quotes",
      input: `
- enr:-Iu4QGCUN3RjOLZCab4LLqlOqnnOB9BspIE30Nj5gQGoY00ZXCIW2PCXuGqDLHEPZJK9NO8SFZlKzFF-5rSbTyPqksoBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQJmy_5ZkaIFozyMd3gPygG1lVLQONuTL4C1j_smkZ9WmoN0Y3CCIyiDdWRwgiMo
- enr:-Iu4QCKxIZVqkBMGHOxfeDvY8Yp0V0uq2MQ8wFS2tQGMfQ1YVuER_WeyVmqKawz6H4JE1OVeN52_kJUdZmkuvpyETjMBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQNsaKrbnhjMgAcpHREHrZiCA7sXyEOokOck_1oc3zZMG4N0Y3CCJRyDdWRwgiUc
- enr:-Iu4QN6QRhX7abcUZ6E5eV9-AIUSXpNBSytiSNwG0FGWWifEevi98EDGhoPVt3e82j9KC2H7DiLtDGnj03MMrs707fEBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4Lu3nwG5diXILEh3LiAauCrNgtoTJxGZQER33BTDMKoN0Y3CCIyiDdWRwgiMo
  `,
      expected: [
        "enr:-Iu4QGCUN3RjOLZCab4LLqlOqnnOB9BspIE30Nj5gQGoY00ZXCIW2PCXuGqDLHEPZJK9NO8SFZlKzFF-5rSbTyPqksoBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQJmy_5ZkaIFozyMd3gPygG1lVLQONuTL4C1j_smkZ9WmoN0Y3CCIyiDdWRwgiMo",
        "enr:-Iu4QCKxIZVqkBMGHOxfeDvY8Yp0V0uq2MQ8wFS2tQGMfQ1YVuER_WeyVmqKawz6H4JE1OVeN52_kJUdZmkuvpyETjMBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQNsaKrbnhjMgAcpHREHrZiCA7sXyEOokOck_1oc3zZMG4N0Y3CCJRyDdWRwgiUc",
        "enr:-Iu4QN6QRhX7abcUZ6E5eV9-AIUSXpNBSytiSNwG0FGWWifEevi98EDGhoPVt3e82j9KC2H7DiLtDGnj03MMrs707fEBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4Lu3nwG5diXILEh3LiAauCrNgtoTJxGZQER33BTDMKoN0Y3CCIyiDdWRwgiMo",
      ],
    },
    {
      name: "Can parse .env style input",
      input: `
      BOOTNODES=enr:-Iu4QGCUN3RjOLZCab4LLqlOqnnOB9BspIE30Nj5gQGoY00ZXCIW2PCXuGqDLHEPZJK9NO8SFZlKzFF-5rSbTyPqksoBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQJmy_5ZkaIFozyMd3gPygG1lVLQONuTL4C1j_smkZ9WmoN0Y3CCIyiDdWRwgiMo,enr:-Iu4QCKxIZVqkBMGHOxfeDvY8Yp0V0uq2MQ8wFS2tQGMfQ1YVuER_WeyVmqKawz6H4JE1OVeN52_kJUdZmkuvpyETjMBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQNsaKrbnhjMgAcpHREHrZiCA7sXyEOokOck_1oc3zZMG4N0Y3CCJRyDdWRwgiUc,enr:-Iu4QN6QRhX7abcUZ6E5eV9-AIUSXpNBSytiSNwG0FGWWifEevi98EDGhoPVt3e82j9KC2H7DiLtDGnj03MMrs707fEBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4Lu3nwG5diXILEh3LiAauCrNgtoTJxGZQER33BTDMKoN0Y3CCIyiDdWRwgiMo
  `,
      expected: [
        "enr:-Iu4QGCUN3RjOLZCab4LLqlOqnnOB9BspIE30Nj5gQGoY00ZXCIW2PCXuGqDLHEPZJK9NO8SFZlKzFF-5rSbTyPqksoBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQJmy_5ZkaIFozyMd3gPygG1lVLQONuTL4C1j_smkZ9WmoN0Y3CCIyiDdWRwgiMo",
        "enr:-Iu4QCKxIZVqkBMGHOxfeDvY8Yp0V0uq2MQ8wFS2tQGMfQ1YVuER_WeyVmqKawz6H4JE1OVeN52_kJUdZmkuvpyETjMBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQNsaKrbnhjMgAcpHREHrZiCA7sXyEOokOck_1oc3zZMG4N0Y3CCJRyDdWRwgiUc",
        "enr:-Iu4QN6QRhX7abcUZ6E5eV9-AIUSXpNBSytiSNwG0FGWWifEevi98EDGhoPVt3e82j9KC2H7DiLtDGnj03MMrs707fEBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4Lu3nwG5diXILEh3LiAauCrNgtoTJxGZQER33BTDMKoN0Y3CCIyiDdWRwgiMo",
      ],
    },
  ];

  for (const {name, input, expected} of testCases) {
    it(name, () => {
      expect(parseBootnodesFile(input)).to.be.deep.equal(expected);
    });
  }
});

describe("mergeBeaconNodeOptions", () => {
  const enrsToNetworkConfig = (enrs: string[]): RecursivePartial<IBeaconNodeOptions> => {
    return {
      network: {
        discv5: {
          bootEnrs: enrs,
        },
      },
    };
  };

  const testCases: {name: string; networkEnrs: string[]; cliEnrs: string[]; resultEnrs: string[]}[] = [
    {name: "normal case", networkEnrs: ["enr-1", "enr-2", "enr-3"], cliEnrs: ["new-enr"], resultEnrs: ["new-enr"]},
    // TODO: investigate arrayMerge has no effect?
    // {
    //   name: "should not override",
    //   networkEnrs: ["enr-1", "enr-2", "enr-3"],
    //   cliEnrs: [],
    //   resultEnrs: ["enr-1", "enr-2", "enr-3"],
    // },
  ];

  for (const {name, networkEnrs, cliEnrs, resultEnrs} of testCases) {
    it(name, () => {
      const networkConfig = enrsToNetworkConfig(networkEnrs);
      const cliConfig = enrsToNetworkConfig(cliEnrs);
      expect(mergeBeaconNodeOptions(networkConfig, cliConfig)).to.be.deep.equal(enrsToNetworkConfig(resultEnrs));
    });
  }
});

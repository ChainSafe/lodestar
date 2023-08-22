import {expect} from "chai";
import {parseBootnodesFile} from "../../../src/util/index.js";

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
enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA # 3.19.194.157 | aws-us-east-2-ohio
enr:-KG4QL-eqFoHy0cI31THvtZjpYUu_Jdw_MO7skQRJxY1g5HTN1A0epPCU6vi0gLGUgrzpU-ygeMSS8ewVxDpKfYmxMMGhGV0aDKQtTA_KgAAAAD__________4JpZIJ2NIJpcIQ2_DUbiXNlY3AyNTZrMaED8GJ2vzUqgL6-KD1xalo1CsmY4X1HaDnyl6Y_WayCo9GDdGNwgiMog3VkcIIjKA # 54.252.53.27 | aws-ap-southeast-2-sydney

# Prylab team's bootnodes
enr:-Ku4QImhMc1z8yCiNJ1TyUxdcfNucje3BGwEHzodEZUan8PherEo4sF7pPHPSIB1NNuSg5fZy7qFsjmUKs2ea1Whi0EBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQOVphkDqal4QzPMksc5wnpuC3gvSC8AfbFOnZY_On34wIN1ZHCCIyg # 18.223.219.100 | aws-us-east-2-ohio
enr:-Ku4QP2xDnEtUXIjzJ_DhlCRN9SN99RYQPJL92TMlSv7U5C1YnYLjwOQHgZIUXw6c-BvRg2Yc2QsZxxoS_pPRVe0yK8Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMeFF5GrS7UZpAH2Ly84aLK-TyvH-dRo0JM1i8yygH50YN1ZHCCJxA # 18.223.219.100 | aws-us-east-2-ohio
enr:-Ku4QPp9z1W4tAO8Ber_NQierYaOStqhDqQdOPY3bB3jDgkjcbk6YrEnVYIiCBbTxuar3CzS528d2iE7TdJsrL-dEKoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMw5fqqkw2hHC4F5HZZDPsNmPdB1Gi8JPQK7pRc9XHh-oN1ZHCCKvg # 18.223.219.100 | aws-us-east-2-ohio

# Lighthouse team's bootnodes
- enr:-Le4QPUXJS2BTORXxyx2Ia-9ae4YqA_JWX3ssj4E_J-3z1A-HmFGrU8BpvpqhNabayXeOZ2Nq_sbeDgtzMJpLLnXFgAChGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISsaa0Zg2lwNpAkAIkHAAAAAPA8kv_-awoTiXNlY3AyNTZrMaEDHAD2JKYevx89W0CcFJFiskdcEzkH_Wdv9iW42qLK79ODdWRwgiMohHVkcDaCI4I # 172.105.173.25 | linode-au-sydney
- enr:-Le4QLHZDSvkLfqgEo8IWGG96h6mxwe_PsggC20CL3neLBjfXLGAQFOPSltZ7oP6ol54OvaNqO02Rnvb8YmDR274uq8ChGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISLosQxg2lwNpAqAX4AAAAAAPA8kv_-ax65iXNlY3AyNTZrMaEDBJj7_dLFACaxBfaI8KZTh_SSJUjhyAyfshimvSqo22WDdWRwgiMohHVkcDaCI4I # 139.162.196.49 | linode-uk-london
- enr:-Le4QH6LQrusDbAHPjU_HcKOuMeXfdEB5NJyXgHWFadfHgiySqeDyusQMvfphdYWOzuSZO9Uq2AMRJR5O4ip7OvVma8BhGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISLY9ncg2lwNpAkAh8AgQIBAAAAAAAAAAmXiXNlY3AyNTZrMaECDYCZTZEksF-kmgPholqgVt8IXr-8L7Nu7YrZ7HUpgxmDdWRwgiMohHVkcDaCI4I # 139.99.217.220 | ovh-au-sydney
- enr:-Le4QIqLuWybHNONr933Lk0dcMmAB5WgvGKRyDihy1wHDIVlNuuztX62W51voT4I8qD34GcTEOTmag1bcdZ_8aaT4NUBhGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISLY04ng2lwNpAkAh8AgAIBAAAAAAAAAA-fiXNlY3AyNTZrMaEDscnRV6n1m-D9ID5UsURk0jsoKNXt1TIrj8uKOGW6iluDdWRwgiMohHVkcDaCI4I # 139.99.78.39 | ovh-singapore

# EF bootnodes
enr:-Ku4QHqVeJ8PPICcWk1vSn_XcSkjOkNiTg6Fmii5j6vUQgvzMc9L1goFnLKgXqBJspJjIsB91LTOleFmyWWrFVATGngBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhAMRHkWJc2VjcDI1NmsxoQKLVXFOhp2uX6jeT0DvvDpPcU8FWMjQdR4wMuORMhpX24N1ZHCCIyg # 3.17.30.69 | aws-us-east-2-ohio
enr:-Ku4QG-2_Md3sZIAUebGYT6g0SMskIml77l6yR-M_JXc-UdNHCmHQeOiMLbylPejyJsdAPsTHJyjJB2sYGDLe0dn8uYBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhBLY-NyJc2VjcDI1NmsxoQORcM6e19T1T9gi7jxEZjk_sjVLGFscUNqAY9obgZaxbIN1ZHCCIyg # 18.216.248.220 | aws-us-east-2-ohio
enr:-Ku4QPn5eVhcoF1opaFEvg1b6JNFD2rqVkHQ8HApOKK61OIcIXD127bKWgAtbwI7pnxx6cDyk_nI88TrZKQaGMZj0q0Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDayLMaJc2VjcDI1NmsxoQK2sBOLGcUb4AwuYzFuAVCaNHA-dy24UuEKkeFNgCVCsIN1ZHCCIyg # 54.178.44.198 | aws-ap-northeast-1-tokyo
enr:-Ku4QEWzdnVtXc2Q0ZVigfCGggOVB2Vc1ZCPEc6j21NIFLODSJbvNaef1g4PxhPwl_3kax86YPheFUSLXPRs98vvYsoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDZBrP2Jc2VjcDI1NmsxoQM6jr8Rb1ktLEsVcKAPa08wCsKUmvoQ8khiOl_SLozf9IN1ZHCCIyg # 54.65.172.253 | aws-ap-northeast-1-tokyo

# Nimbus team's bootnodes
enr:-LK4QA8FfhaAjlb_BXsXxSfiysR7R52Nhi9JBt4F8SPssu8hdE1BXQQEtVDC3qStCW60LSO7hEsVHv5zm8_6Vnjhcn0Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhAN4aBKJc2VjcDI1NmsxoQJerDhsJ-KxZ8sHySMOCmTO6sHM3iCFQ6VMvLTe948MyYN0Y3CCI4yDdWRwgiOM # 3.120.104.18 | aws-eu-central-1-frankfurt
enr:-LK4QKWrXTpV9T78hNG6s8AM6IO4XH9kFT91uZtFg1GcsJ6dKovDOr1jtAAFPnS2lvNltkOGA9k29BUN7lFh_sjuc9QBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhANAdd-Jc2VjcDI1NmsxoQLQa6ai7y9PMN5hpLe5HmiJSlYzMuzP7ZhwRiwHvqNXdoN0Y3CCI4yDdWRwgiOM # 3.64.117.223 | aws-eu-central-1-frankfurt
  `,
      expected: [
        "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA",
        "enr:-KG4QL-eqFoHy0cI31THvtZjpYUu_Jdw_MO7skQRJxY1g5HTN1A0epPCU6vi0gLGUgrzpU-ygeMSS8ewVxDpKfYmxMMGhGV0aDKQtTA_KgAAAAD__________4JpZIJ2NIJpcIQ2_DUbiXNlY3AyNTZrMaED8GJ2vzUqgL6-KD1xalo1CsmY4X1HaDnyl6Y_WayCo9GDdGNwgiMog3VkcIIjKA",
        "enr:-Ku4QImhMc1z8yCiNJ1TyUxdcfNucje3BGwEHzodEZUan8PherEo4sF7pPHPSIB1NNuSg5fZy7qFsjmUKs2ea1Whi0EBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQOVphkDqal4QzPMksc5wnpuC3gvSC8AfbFOnZY_On34wIN1ZHCCIyg",
        "enr:-Ku4QP2xDnEtUXIjzJ_DhlCRN9SN99RYQPJL92TMlSv7U5C1YnYLjwOQHgZIUXw6c-BvRg2Yc2QsZxxoS_pPRVe0yK8Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMeFF5GrS7UZpAH2Ly84aLK-TyvH-dRo0JM1i8yygH50YN1ZHCCJxA",
        "enr:-Ku4QPp9z1W4tAO8Ber_NQierYaOStqhDqQdOPY3bB3jDgkjcbk6YrEnVYIiCBbTxuar3CzS528d2iE7TdJsrL-dEKoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMw5fqqkw2hHC4F5HZZDPsNmPdB1Gi8JPQK7pRc9XHh-oN1ZHCCKvg",
        "enr:-Le4QPUXJS2BTORXxyx2Ia-9ae4YqA_JWX3ssj4E_J-3z1A-HmFGrU8BpvpqhNabayXeOZ2Nq_sbeDgtzMJpLLnXFgAChGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISsaa0Zg2lwNpAkAIkHAAAAAPA8kv_-awoTiXNlY3AyNTZrMaEDHAD2JKYevx89W0CcFJFiskdcEzkH_Wdv9iW42qLK79ODdWRwgiMohHVkcDaCI4I",
        "enr:-Le4QLHZDSvkLfqgEo8IWGG96h6mxwe_PsggC20CL3neLBjfXLGAQFOPSltZ7oP6ol54OvaNqO02Rnvb8YmDR274uq8ChGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISLosQxg2lwNpAqAX4AAAAAAPA8kv_-ax65iXNlY3AyNTZrMaEDBJj7_dLFACaxBfaI8KZTh_SSJUjhyAyfshimvSqo22WDdWRwgiMohHVkcDaCI4I",
        "enr:-Le4QH6LQrusDbAHPjU_HcKOuMeXfdEB5NJyXgHWFadfHgiySqeDyusQMvfphdYWOzuSZO9Uq2AMRJR5O4ip7OvVma8BhGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISLY9ncg2lwNpAkAh8AgQIBAAAAAAAAAAmXiXNlY3AyNTZrMaECDYCZTZEksF-kmgPholqgVt8IXr-8L7Nu7YrZ7HUpgxmDdWRwgiMohHVkcDaCI4I",
        "enr:-Le4QIqLuWybHNONr933Lk0dcMmAB5WgvGKRyDihy1wHDIVlNuuztX62W51voT4I8qD34GcTEOTmag1bcdZ_8aaT4NUBhGV0aDKQtTA_KgEAAAAAIgEAAAAAAIJpZIJ2NIJpcISLY04ng2lwNpAkAh8AgAIBAAAAAAAAAA-fiXNlY3AyNTZrMaEDscnRV6n1m-D9ID5UsURk0jsoKNXt1TIrj8uKOGW6iluDdWRwgiMohHVkcDaCI4I",
        "enr:-Ku4QHqVeJ8PPICcWk1vSn_XcSkjOkNiTg6Fmii5j6vUQgvzMc9L1goFnLKgXqBJspJjIsB91LTOleFmyWWrFVATGngBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhAMRHkWJc2VjcDI1NmsxoQKLVXFOhp2uX6jeT0DvvDpPcU8FWMjQdR4wMuORMhpX24N1ZHCCIyg",
        "enr:-Ku4QG-2_Md3sZIAUebGYT6g0SMskIml77l6yR-M_JXc-UdNHCmHQeOiMLbylPejyJsdAPsTHJyjJB2sYGDLe0dn8uYBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhBLY-NyJc2VjcDI1NmsxoQORcM6e19T1T9gi7jxEZjk_sjVLGFscUNqAY9obgZaxbIN1ZHCCIyg",
        "enr:-Ku4QPn5eVhcoF1opaFEvg1b6JNFD2rqVkHQ8HApOKK61OIcIXD127bKWgAtbwI7pnxx6cDyk_nI88TrZKQaGMZj0q0Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDayLMaJc2VjcDI1NmsxoQK2sBOLGcUb4AwuYzFuAVCaNHA-dy24UuEKkeFNgCVCsIN1ZHCCIyg",
        "enr:-Ku4QEWzdnVtXc2Q0ZVigfCGggOVB2Vc1ZCPEc6j21NIFLODSJbvNaef1g4PxhPwl_3kax86YPheFUSLXPRs98vvYsoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDZBrP2Jc2VjcDI1NmsxoQM6jr8Rb1ktLEsVcKAPa08wCsKUmvoQ8khiOl_SLozf9IN1ZHCCIyg",
        "enr:-LK4QA8FfhaAjlb_BXsXxSfiysR7R52Nhi9JBt4F8SPssu8hdE1BXQQEtVDC3qStCW60LSO7hEsVHv5zm8_6Vnjhcn0Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhAN4aBKJc2VjcDI1NmsxoQJerDhsJ-KxZ8sHySMOCmTO6sHM3iCFQ6VMvLTe948MyYN0Y3CCI4yDdWRwgiOM",
        "enr:-LK4QKWrXTpV9T78hNG6s8AM6IO4XH9kFT91uZtFg1GcsJ6dKovDOr1jtAAFPnS2lvNltkOGA9k29BUN7lFh_sjuc9QBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhANAdd-Jc2VjcDI1NmsxoQLQa6ai7y9PMN5hpLe5HmiJSlYzMuzP7ZhwRiwHvqNXdoN0Y3CCI4yDdWRwgiOM",
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

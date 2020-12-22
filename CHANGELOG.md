# Changelog

## [v0.13.0](https://github.com/chainsafe/lodestar/tree/v0.13.0) (2020-12-21)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.12.0...v0.13.0)

**Merged pull requests:**

- chore\(release\): v0.13.0 [\#1904](https://github.com/ChainSafe/lodestar/pull/1904) ([wemeetagain](https://github.com/wemeetagain))
- Write request decode validation as async fn [\#1901](https://github.com/ChainSafe/lodestar/pull/1901) ([dapplion](https://github.com/dapplion))
- Improve DiversifyPeersBySubnetTask [\#1898](https://github.com/ChainSafe/lodestar/pull/1898) ([tuyennhv](https://github.com/tuyennhv))
- Debug api to download state [\#1892](https://github.com/ChainSafe/lodestar/pull/1892) ([tuyennhv](https://github.com/tuyennhv))
- Sync validator api response type with spec [\#1888](https://github.com/ChainSafe/lodestar/pull/1888) ([mpetrunic](https://github.com/mpetrunic))
- Remove ERR\_ prefix from error code enums [\#1887](https://github.com/ChainSafe/lodestar/pull/1887) ([dapplion](https://github.com/dapplion))
- lodestar package comment updates [\#1885](https://github.com/ChainSafe/lodestar/pull/1885) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Reduce code duplication in ReqResp [\#1882](https://github.com/ChainSafe/lodestar/pull/1882) ([dapplion](https://github.com/dapplion))
- Automatic release and publish [\#1880](https://github.com/ChainSafe/lodestar/pull/1880) ([mpetrunic](https://github.com/mpetrunic))
- Bump ini from 1.3.5 to 1.3.7 [\#1871](https://github.com/ChainSafe/lodestar/pull/1871) ([dependabot[bot]](https://github.com/apps/dependabot))
- Sync: Use SlotRoot instead of ISyncCheckpoint [\#1870](https://github.com/ChainSafe/lodestar/pull/1870) ([tuyennhv](https://github.com/tuyennhv))
- Fix getRandaoRevealSignatureSet [\#1869](https://github.com/ChainSafe/lodestar/pull/1869) ([tuyennhv](https://github.com/tuyennhv))
- lodestar-types: unused code block removal [\#1868](https://github.com/ChainSafe/lodestar/pull/1868) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Follow XDG Base Directory Specification [\#1865](https://github.com/ChainSafe/lodestar/pull/1865) ([dapplion](https://github.com/dapplion))
- Use TreeBacked\<SignedBeaconBlock\> to improve sync time [\#1861](https://github.com/ChainSafe/lodestar/pull/1861) ([tuyennhv](https://github.com/tuyennhv))
- Import AbortSignal wherever used [\#1853](https://github.com/ChainSafe/lodestar/pull/1853) ([dapplion](https://github.com/dapplion))
- Use verifySignatureSetsBatch for state transition function [\#1851](https://github.com/ChainSafe/lodestar/pull/1851) ([dapplion](https://github.com/dapplion))
- Import lodestar-params from root [\#1850](https://github.com/ChainSafe/lodestar/pull/1850) ([dapplion](https://github.com/dapplion))
- lodestar-cli README update [\#1849](https://github.com/ChainSafe/lodestar/pull/1849) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- lodestar-beacon-state-transition comment updates [\#1848](https://github.com/ChainSafe/lodestar/pull/1848) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Fix yarn:clean in lodestar-params [\#1847](https://github.com/ChainSafe/lodestar/pull/1847) ([tuyennhv](https://github.com/tuyennhv))
- Implement debug api to get forkchoice heads [\#1846](https://github.com/ChainSafe/lodestar/pull/1846) ([tuyennhv](https://github.com/tuyennhv))
- Use for of instead of forEach where possible [\#1845](https://github.com/ChainSafe/lodestar/pull/1845) ([dapplion](https://github.com/dapplion))
- Add whitespace to lodestar/network [\#1844](https://github.com/ChainSafe/lodestar/pull/1844) ([dapplion](https://github.com/dapplion))
- Remove self invoking functions where not strictly necessary [\#1843](https://github.com/ChainSafe/lodestar/pull/1843) ([dapplion](https://github.com/dapplion))
- remove ts-ignores for discv5.enabled [\#1842](https://github.com/ChainSafe/lodestar/pull/1842) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- JSON friendly logger statements [\#1837](https://github.com/ChainSafe/lodestar/pull/1837) ([dapplion](https://github.com/dapplion))
- Remove unnecessary try / catch expect.fail\(\) pattern [\#1835](https://github.com/ChainSafe/lodestar/pull/1835) ([dapplion](https://github.com/dapplion))
- Run eslint on test/ - lodestar [\#1834](https://github.com/ChainSafe/lodestar/pull/1834) ([dapplion](https://github.com/dapplion))
- Run eslint on test/ - lodestar-params [\#1833](https://github.com/ChainSafe/lodestar/pull/1833) ([dapplion](https://github.com/dapplion))
- Run eslint on test/ - lodestar-beacon-state-transition [\#1832](https://github.com/ChainSafe/lodestar/pull/1832) ([dapplion](https://github.com/dapplion))
- Improve lodestar-config exports [\#1831](https://github.com/ChainSafe/lodestar/pull/1831) ([dapplion](https://github.com/dapplion))
- Fix CI errors in master [\#1827](https://github.com/ChainSafe/lodestar/pull/1827) ([dapplion](https://github.com/dapplion))
- Rename IBlockJob metadata props [\#1826](https://github.com/ChainSafe/lodestar/pull/1826) ([dapplion](https://github.com/dapplion))
- Bump highlight.js from 10.4.0 to 10.4.1 [\#1825](https://github.com/ChainSafe/lodestar/pull/1825) ([dependabot[bot]](https://github.com/apps/dependabot))
- Add rewards spec tests [\#1822](https://github.com/ChainSafe/lodestar/pull/1822) ([tuyennhv](https://github.com/tuyennhv))
- Add signature sets getters [\#1821](https://github.com/ChainSafe/lodestar/pull/1821) ([dapplion](https://github.com/dapplion))
- lodestar-validator comment updates [\#1817](https://github.com/ChainSafe/lodestar/pull/1817) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Update eslint and typescript-eslint [\#1813](https://github.com/ChainSafe/lodestar/pull/1813) ([mpetrunic](https://github.com/mpetrunic))

## [v0.12.0](https://github.com/chainsafe/lodestar/tree/v0.12.0) (2020-12-01)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.11.0...v0.12.0)

**Merged pull requests:**

- v0.12.0 [\#1809](https://github.com/ChainSafe/lodestar/pull/1809) ([wemeetagain](https://github.com/wemeetagain))
- Replace IKeypair for SecretKey [\#1807](https://github.com/ChainSafe/lodestar/pull/1807) ([dapplion](https://github.com/dapplion))
- Setup CLI for mainnet [\#1806](https://github.com/ChainSafe/lodestar/pull/1806) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Update params [\#1803](https://github.com/ChainSafe/lodestar/pull/1803) ([wemeetagain](https://github.com/wemeetagain))
- Generalize spec download tool [\#1802](https://github.com/ChainSafe/lodestar/pull/1802) ([dapplion](https://github.com/dapplion))
- Remove evil mocha import [\#1801](https://github.com/ChainSafe/lodestar/pull/1801) ([dapplion](https://github.com/dapplion))
- Update bls [\#1800](https://github.com/ChainSafe/lodestar/pull/1800) ([wemeetagain](https://github.com/wemeetagain))
- Performance tests for state transition functions [\#1799](https://github.com/ChainSafe/lodestar/pull/1799) ([tuyennhv](https://github.com/tuyennhv))
- Type checking [\#1796](https://github.com/ChainSafe/lodestar/pull/1796) ([mpetrunic](https://github.com/mpetrunic))
- Improve some spec tests using TreeBacked [\#1795](https://github.com/ChainSafe/lodestar/pull/1795) ([tuyennhv](https://github.com/tuyennhv))
- Run type and code build tasks in parallel [\#1794](https://github.com/ChainSafe/lodestar/pull/1794) ([mpetrunic](https://github.com/mpetrunic))
- lodestar-cli comments/documentation [\#1791](https://github.com/ChainSafe/lodestar/pull/1791) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Add pyrmont testnet flag [\#1790](https://github.com/ChainSafe/lodestar/pull/1790) ([wemeetagain](https://github.com/wemeetagain))
- Initial Sync: do not import orphaned blocks [\#1786](https://github.com/ChainSafe/lodestar/pull/1786) ([tuyennhv](https://github.com/tuyennhv))
- Inline config files | Bump spec tests to v1.0.0 [\#1783](https://github.com/ChainSafe/lodestar/pull/1783) ([dapplion](https://github.com/dapplion))
- Update gossipsub \#1778 - review comments [\#1781](https://github.com/ChainSafe/lodestar/pull/1781) ([dapplion](https://github.com/dapplion))
- Update discv5 to 0.5.0 [\#1780](https://github.com/ChainSafe/lodestar/pull/1780) ([wemeetagain](https://github.com/wemeetagain))
- Update gossipsub [\#1778](https://github.com/ChainSafe/lodestar/pull/1778) ([wemeetagain](https://github.com/wemeetagain))
- readable goodbye reason codes [\#1769](https://github.com/ChainSafe/lodestar/pull/1769) ([3xtr4t3rr3str14l](https://github.com/3xtr4t3rr3str14l))
- Update attester api [\#1768](https://github.com/ChainSafe/lodestar/pull/1768) ([mpetrunic](https://github.com/mpetrunic))
- Pin nodejs version in docs workflow [\#1766](https://github.com/ChainSafe/lodestar/pull/1766) ([mpetrunic](https://github.com/mpetrunic))

## [v0.11.0](https://github.com/chainsafe/lodestar/tree/v0.11.0) (2020-08-04)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.10.1...v0.11.0)

## [v0.10.1](https://github.com/chainsafe/lodestar/tree/v0.10.1) (2020-07-16)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.10.0...v0.10.1)

## [v0.10.0](https://github.com/chainsafe/lodestar/tree/v0.10.0) (2020-07-14)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.9.0...v0.10.0)

## [v0.9.0](https://github.com/chainsafe/lodestar/tree/v0.9.0) (2020-06-02)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.8.0...v0.9.0)

## [v0.8.0](https://github.com/chainsafe/lodestar/tree/v0.8.0) (2020-05-17)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.7.0...v0.8.0)

## [v0.7.0](https://github.com/chainsafe/lodestar/tree/v0.7.0) (2020-05-06)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.6.0...v0.7.0)

## [v0.6.0](https://github.com/chainsafe/lodestar/tree/v0.6.0) (2020-04-23)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/v0.5.0...v0.6.0)

## [v0.5.0](https://github.com/chainsafe/lodestar/tree/v0.5.0) (2020-02-25)

[Full Changelog](https://github.com/chainsafe/lodestar/compare/11408e95ecd4f64282adfd7ebd9f4ad8c36a4417...v0.5.0)



\* *This Changelog was automatically generated by [github_changelog_generator](https://github.com/github-changelog-generator/github-changelog-generator)*

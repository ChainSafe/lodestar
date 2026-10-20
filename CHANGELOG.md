# Changelog

## [2.1.0](https://github.com/ChainSafe/lodestar-z/compare/v2.0.0...v2.1.0) (2026-10-20)


### Features

* add `bench_ssz` step ([#318](https://github.com/ChainSafe/lodestar-z/issues/318)) ([874de23](https://github.com/ChainSafe/lodestar-z/commit/874de23c5f0c7937c3b15b09f97be7948922e9f8))
* add gloas state transition ([#764](https://github.com/ChainSafe/lodestar-z/issues/764)) ([f7493b7](https://github.com/ChainSafe/lodestar-z/commit/f7493b715041b5493ffdfaa8cc168de077b2e20c))
* add gnosis preset ([#791](https://github.com/ChainSafe/lodestar-z/issues/791)) ([ba4f89e](https://github.com/ChainSafe/lodestar-z/commit/ba4f89e967bdb498f1d856f699f1ba2b863be330))
* add heze timing configuration ([#794](https://github.com/ChainSafe/lodestar-z/issues/794)) ([906ea62](https://github.com/ChainSafe/lodestar-z/commit/906ea627245c28d4e7e1bbf941a4436945462fd1))
* add struct progressive container ([#777](https://github.com/ChainSafe/lodestar-z/issues/777)) ([1de4ebd](https://github.com/ChainSafe/lodestar-z/commit/1de4ebd92f9f2a79404be05dae0ca1d09d9d2cee))
* **metrics:** add sub-second epoch transition histogram buckets ([#759](https://github.com/ChainSafe/lodestar-z/issues/759)) ([bf96e24](https://github.com/ChainSafe/lodestar-z/commit/bf96e24bceccf443f04162873fc4cc88b59fc680))
* **metrics:** label state transitions by source ([#772](https://github.com/ChainSafe/lodestar-z/issues/772)) ([65dc676](https://github.com/ChainSafe/lodestar-z/commit/65dc6761129bb8d39759ba313ee493158fae63d5))
* support progressive ssz views ([#793](https://github.com/ChainSafe/lodestar-z/issues/793)) ([91d03b3](https://github.com/ChainSafe/lodestar-z/commit/91d03b3dac363b02a320af19af6938c72ec16a3d))
* verify EIP-8025 execution proofs through ere's C verifier ([#760](https://github.com/ChainSafe/lodestar-z/issues/760)) ([f069a4d](https://github.com/ChainSafe/lodestar-z/commit/f069a4dd5aaf24e2a10e7760bb95869528648dd2))


### Bug Fixes

* include commit in block timing ([#767](https://github.com/ChainSafe/lodestar-z/issues/767)) ([88a968b](https://github.com/ChainSafe/lodestar-z/commit/88a968b0145cfb50e75fb45bbebf4aa4021fd014))
* include histogram upper bounds ([#766](https://github.com/ChainSafe/lodestar-z/issues/766)) ([f6fbe20](https://github.com/ChainSafe/lodestar-z/commit/f6fbe2069c209643a69bf1893ee399d5f64f22f4))
* prepare state before rewards ([#755](https://github.com/ChainSafe/lodestar-z/issues/755)) ([a1361f0](https://github.com/ChainSafe/lodestar-z/commit/a1361f038bd1c4101483307f9f70c6e100f31e8d))
* preserve shuffling input ownership ([#753](https://github.com/ChainSafe/lodestar-z/issues/753)) ([589e23a](https://github.com/ChainSafe/lodestar-z/commit/589e23a2283474b91e58d6687573e7e5733c00b0))
* release failed batch parents ([#790](https://github.com/ChainSafe/lodestar-z/issues/790)) ([24a8e4a](https://github.com/ChainSafe/lodestar-z/commit/24a8e4ac800bd1b20c6ee229db05dcbf4299d0cd))
* support serialized transaction lists ([#796](https://github.com/ChainSafe/lodestar-z/issues/796)) ([24c5630](https://github.com/ChainSafe/lodestar-z/commit/24c5630788944b8c2f4a229bbc404375b5b8a54f))


### Performance Improvements

* expose sync committee indices ([#768](https://github.com/ChainSafe/lodestar-z/issues/768)) ([79032c5](https://github.com/ChainSafe/lodestar-z/commit/79032c552fe11947876e42ae0a8dc2d315343313))
* store shuffling indices as u32 ([#797](https://github.com/ChainSafe/lodestar-z/issues/797)) ([c17d132](https://github.com/ChainSafe/lodestar-z/commit/c17d1328587505473d302918e0862616382d75a0))
* stream progressive tree construction ([#746](https://github.com/ChainSafe/lodestar-z/issues/746)) ([41fa6dd](https://github.com/ChainSafe/lodestar-z/commit/41fa6dde7d560c9c673fcf1621fef4a76ed3c152))
* stream progressive tree reads ([#745](https://github.com/ChainSafe/lodestar-z/issues/745)) ([5fbb0e2](https://github.com/ChainSafe/lodestar-z/commit/5fbb0e23a64c9a3e3670135787dd750f573630ec))
* vectorize shuffle swap loop ([#769](https://github.com/ChainSafe/lodestar-z/issues/769)) ([40194cb](https://github.com/ChainSafe/lodestar-z/commit/40194cba93f7a058046da00d7bb49bdb9fa27712))


### Code Refactoring

* clarify progressive decode ownership ([#771](https://github.com/ChainSafe/lodestar-z/issues/771)) ([0221893](https://github.com/ChainSafe/lodestar-z/commit/0221893a6189755723787df11124e7a982a34e81))
* leave decode cleanup to callers ([#761](https://github.com/ChainSafe/lodestar-z/issues/761)) ([9561036](https://github.com/ChainSafe/lodestar-z/commit/95610364dd4cfd481eacc82230f3c39f7f278d4e))


### Miscellaneous Chores

* add apache-2.0 license ([#781](https://github.com/ChainSafe/lodestar-z/issues/781)) ([964fefc](https://github.com/ChainSafe/lodestar-z/commit/964fefc332e39e907e35c2acdfbf623e603d2ee0))


### Documentation

* bench with the baseline cpu like release bindings ([#786](https://github.com/ChainSafe/lodestar-z/issues/786)) ([0b36087](https://github.com/ChainSafe/lodestar-z/commit/0b36087874cf566b931a101cb692c2cf32206ae9))
* use ReleaseSafe in bench run instructions ([#785](https://github.com/ChainSafe/lodestar-z/issues/785)) ([b1751bf](https://github.com/ChainSafe/lodestar-z/commit/b1751bf0fb8a9f0f3ac574da68a987acdd335952))

## [2.0.0](https://github.com/ChainSafe/lodestar-z/compare/v1.1.0...v2.0.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* **bindings:** `bindings.config.set()` is removed. Construct a `BeaconConfig(chainConfig, genesisValidatorsRoot)` and pass it to `BeaconStateView.createFromBytes(bytes, config)`. `ExecutionPayloadHeader.blobGasUsed` and `excessBlobGas` are now `bigint`.
* **bindings:** `getBeaconCommittee(slot, index)` returns `Uint32Array` instead of `number[]`.
* **bindings:** `Eth1Data.depositCount` is now `bigint`, including in `eth1Data`, `eth1DataVotes` and `toValue()` output.
* **bindings:** `computeBlockRewards(signedBlockBytes, isBlinded, proposerRewards?)` now takes serialized block bytes and returns `BlockRewards` synchronously instead of a Promise.

### Features

* add typed stf diagnostics ([#694](https://github.com/ChainSafe/lodestar-z/issues/694)) ([d143920](https://github.com/ChainSafe/lodestar-z/commit/d1439208b1c57c70ae3e7341d22ab4db764b2c82))
* **bindings:** implement computeBlockRewards ([1ec864e](https://github.com/ChainSafe/lodestar-z/commit/1ec864e52ee6c33c67d146c6a75e897c2009cd9a))
* **bindings:** implement remaining rewards apis ([#731](https://github.com/ChainSafe/lodestar-z/issues/731)) ([3cdf9ea](https://github.com/ChainSafe/lodestar-z/commit/3cdf9ea4501baf4af086eda085280ddc4b7d1eb6))
* **metrics:** track block transition steps ([#737](https://github.com/ChainSafe/lodestar-z/issues/737)) ([697d390](https://github.com/ChainSafe/lodestar-z/commit/697d390eadd29e5b07ba5f4bb76a7776e8ddf1e4))
* partial validator monitor ([#475](https://github.com/ChainSafe/lodestar-z/issues/475)) ([2c595d3](https://github.com/ChainSafe/lodestar-z/commit/2c595d330101b6b32ab811de179f315c85443003))
* **stf:** zero-alloc `processSyncAggregate` ([#269](https://github.com/ChainSafe/lodestar-z/issues/269)) ([bd68732](https://github.com/ChainSafe/lodestar-z/commit/bd6873289731f9cef133c0a667fbd5ad6f222ea5))


### Bug Fixes

* accept bigint proof indices ([#699](https://github.com/ChainSafe/lodestar-z/issues/699)) ([0a528a4](https://github.com/ChainSafe/lodestar-z/commit/0a528a444f72dbda978b03224032b69b45c19393))
* **bindings:** declare sync-committee index map values as Uint32Array ([#706](https://github.com/ChainSafe/lodestar-z/issues/706)) ([175c080](https://github.com/ChainSafe/lodestar-z/commit/175c080834ecab77a0005077b0812ddb21185832))
* **bindings:** depositCount as bigint ([6133ed0](https://github.com/ChainSafe/lodestar-z/commit/6133ed0aba77ef557cfbe6da9c1c047c470bcfa8))
* **bindings:** emit eth1Data.depositCount as bigint ([#730](https://github.com/ChainSafe/lodestar-z/issues/730)) ([bd746f5](https://github.com/ChainSafe/lodestar-z/commit/bd746f587a66f753455c52776edff3469e232f92))
* **bindings:** make native STF setup and memory ownership safe ([ef6c313](https://github.com/ChainSafe/lodestar-z/commit/ef6c313cf1ad8a127cc53ba96cf5c4887c89ea14))
* **bindings:** preserve eth1 bigint values ([#735](https://github.com/ChainSafe/lodestar-z/issues/735)) ([dd6e0d3](https://github.com/ChainSafe/lodestar-z/commit/dd6e0d30a610eb4e4cb7c3337f4a23a000a2da81))
* **bindings:** return beacon committee as Uint32Array ([0f7ce2d](https://github.com/ChainSafe/lodestar-z/commit/0f7ce2d2fe45430d728c748644249c4e01e7e132))
* **bindings:** return sync committee index maps ([#691](https://github.com/ChainSafe/lodestar-z/issues/691)) ([2f1a177](https://github.com/ChainSafe/lodestar-z/commit/2f1a177a10171c1a9f5cead09f7ebb2d3b9aa7db))
* **bindings:** return sync committee positions as arrays ([#714](https://github.com/ChainSafe/lodestar-z/issues/714)) ([1696068](https://github.com/ChainSafe/lodestar-z/commit/1696068087567885e33c977de534721abe589506))
* **bindings:** use c_allocator for BeaconStateView outside Debug ([#732](https://github.com/ChainSafe/lodestar-z/issues/732)) ([f83914b](https://github.com/ChainSafe/lodestar-z/commit/f83914b3e360b2d903996ea940f84c2f85d3ce76))
* clean up inactivity scores ([#702](https://github.com/ChainSafe/lodestar-z/issues/702)) ([fca5032](https://github.com/ChainSafe/lodestar-z/commit/fca5032ff3116a407331bee31e72a57e49ee83bd))
* isolate binding benchmark suites in separate processes ([#708](https://github.com/ChainSafe/lodestar-z/issues/708)) ([0915ae7](https://github.com/ChainSafe/lodestar-z/commit/0915ae7d9a1c86ae02ce8c5eef4787a08ba6c3c9))
* preserve pending view nodes ([#740](https://github.com/ChainSafe/lodestar-z/issues/740)) ([8a3d024](https://github.com/ChainSafe/lodestar-z/commit/8a3d024f6be525d5a978756f4b9734196e904703))
* **ssz:** make progressive scratch mutable ([#725](https://github.com/ChainSafe/lodestar-z/issues/725)) ([495e5b2](https://github.com/ChainSafe/lodestar-z/commit/495e5b28892818bda16b44ad9a0bd8e055cb4444))
* stage composite child roots ([#747](https://github.com/ChainSafe/lodestar-z/issues/747)) ([b70e8f5](https://github.com/ChainSafe/lodestar-z/commit/b70e8f5662a08a0d177b2f7c96e2c16e5b1b6cce))
* **state-transition:** report withdrawal count mismatch ([#752](https://github.com/ChainSafe/lodestar-z/issues/752)) ([b5c1013](https://github.com/ChainSafe/lodestar-z/commit/b5c10138f84c58072d62d0abd806041ee69280a8))
* **state-transition:** use getReadonly for read-only validator access ([#712](https://github.com/ChainSafe/lodestar-z/issues/712)) ([daebcf1](https://github.com/ChainSafe/lodestar-z/commit/daebcf1beff537a0c9f39819362a31be57dccf6d))
* **stf:** clean up failed Altair participation translation ([#695](https://github.com/ChainSafe/lodestar-z/issues/695)) ([d8c06af](https://github.com/ChainSafe/lodestar-z/commit/d8c06af27fa2bf87fec37554089ffd0762051b38))
* **stf:** floor the sync-aggregate proposer penalty and guard phase0 lookups ([#705](https://github.com/ChainSafe/lodestar-z/issues/705)) ([407c60d](https://github.com/ChainSafe/lodestar-z/commit/407c60d39f7146d3cfa352736b2d10e7840693b1))
* **stf:** self-heal progressive balance drift ([#726](https://github.com/ChainSafe/lodestar-z/issues/726)) ([ede068a](https://github.com/ChainSafe/lodestar-z/commit/ede068af58d0fc8e56a17e140e051a217124b33a))
* **types:** correct Electra blinded attester slashing limit ([#698](https://github.com/ChainSafe/lodestar-z/issues/698)) ([15d3347](https://github.com/ChainSafe/lodestar-z/commit/15d33475436f9a3f05509702803b913e0b627827))


### Performance Improvements

* avoid proposer lookahead allocation ([#716](https://github.com/ChainSafe/lodestar-z/issues/716)) ([5e82cc4](https://github.com/ChainSafe/lodestar-z/commit/5e82cc438a4fac37c618820ec8fb7b8f3e71c6e4))
* bound bitlist hashing workspace ([#678](https://github.com/ChainSafe/lodestar-z/issues/678)) ([0ece146](https://github.com/ChainSafe/lodestar-z/commit/0ece14665dcae47082092e55989e77891d3bdc96))
* bound progressive builder scratch ([#687](https://github.com/ChainSafe/lodestar-z/issues/687)) ([52a9736](https://github.com/ChainSafe/lodestar-z/commit/52a97361212e64f1a0ebb58fc645ed74b50ada07))
* bound progressive merkleization workspace ([#685](https://github.com/ChainSafe/lodestar-z/issues/685)) ([c243df8](https://github.com/ChainSafe/lodestar-z/commit/c243df8df330dd52d1b4dac016eefa1f6e3127f4))
* overlap Fulu shuffling with epoch processing ([#727](https://github.com/ChainSafe/lodestar-z/issues/727)) ([3d978b8](https://github.com/ChainSafe/lodestar-z/commit/3d978b8cca281d4b273637366ad6e35c29b880d4))
* shuffle compact validator positions ([#734](https://github.com/ChainSafe/lodestar-z/issues/734)) ([ea963b1](https://github.com/ChainSafe/lodestar-z/commit/ea963b101ca50ffcaf544e969531293721382ccc))
* **state-transition:** diff-synced flat validator cache ([#736](https://github.com/ChainSafe/lodestar-z/issues/736)) ([d7282c7](https://github.com/ChainSafe/lodestar-z/commit/d7282c7a751d0b8c56b3e525af007bebaaee119b))
* stream bitlist tree reads ([#679](https://github.com/ChainSafe/lodestar-z/issues/679)) ([02d61c2](https://github.com/ChainSafe/lodestar-z/commit/02d61c2b9c9ca7361ea852b8f5458854f8522197))
* stream compact proof generation ([#683](https://github.com/ChainSafe/lodestar-z/issues/683)) ([57022b4](https://github.com/ChainSafe/lodestar-z/commit/57022b4bdd6a2c054d3eed2343b16e1e05596272))
* stream progressive hashing ([#744](https://github.com/ChainSafe/lodestar-z/issues/744)) ([1ceb7ca](https://github.com/ChainSafe/lodestar-z/commit/1ceb7ca7d14e3aa0d6195124c626fc5cb7866e38))
* stream progressive tree serialization ([#686](https://github.com/ChainSafe/lodestar-z/issues/686)) ([0f63529](https://github.com/ChainSafe/lodestar-z/commit/0f6352928bdf776384a03acd42afc0eb3cb23eff))


### Code Refactoring

* bound fixed vector hashing ([#681](https://github.com/ChainSafe/lodestar-z/issues/681)) ([0d04988](https://github.com/ChainSafe/lodestar-z/commit/0d04988234a116de40f3a1bcc74efdb9bf7c1d32))
* bound variable vector hashing ([#682](https://github.com/ChainSafe/lodestar-z/issues/682)) ([3da79f3](https://github.com/ChainSafe/lodestar-z/commit/3da79f3ef34a8a229092ccf284eff03bc7baf9bf))
* **epoch-cache:** make effectiveBalanceIncrementsSet append instead ([#721](https://github.com/ChainSafe/lodestar-z/issues/721)) ([bc748d8](https://github.com/ChainSafe/lodestar-z/commit/bc748d841e539494e12ecceeaef3578a648449a3))
* extract bit array module ([#693](https://github.com/ChainSafe/lodestar-z/issues/693)) ([f81415c](https://github.com/ChainSafe/lodestar-z/commit/f81415c9f1e53c1e9861b31263c756fdbf947139))
* iterate compact proof reconstruction ([#684](https://github.com/ChainSafe/lodestar-z/issues/684)) ([4051fcc](https://github.com/ChainSafe/lodestar-z/commit/4051fcc71d8e3af5e9d637e58af629879cbb4349))
* migrate deprecated zig std APIs ([#742](https://github.com/ChainSafe/lodestar-z/issues/742)) ([18aa0b6](https://github.com/ChainSafe/lodestar-z/commit/18aa0b6261ee740177e60d67ed13acee55ca778b))
* remove unused view reads ([#739](https://github.com/ChainSafe/lodestar-z/issues/739)) ([5015e0c](https://github.com/ChainSafe/lodestar-z/commit/5015e0cb55c1ce5ee70de4aa755ba6c19ee056d3))
* retain view roots last ([#738](https://github.com/ChainSafe/lodestar-z/issues/738)) ([77ad664](https://github.com/ChainSafe/lodestar-z/commit/77ad664a86e8261caa0d48aad487208d4946f6b4))
* **ssz:** centralize chunked-leaf mutation bookkeeping ([#690](https://github.com/ChainSafe/lodestar-z/issues/690)) ([9c478c7](https://github.com/ChainSafe/lodestar-z/commit/9c478c7ce5a63691fe1d90b73e128cf5d9d1318e))
* **state-transition:** remove reused cache lock ([#750](https://github.com/ChainSafe/lodestar-z/issues/750)) ([8b3dcc0](https://github.com/ChainSafe/lodestar-z/commit/8b3dcc0abe7dea809af59469148fa56a43e534ef))
* **stf:** make allocator ownership explicit ([#722](https://github.com/ChainSafe/lodestar-z/issues/722)) ([2439ca1](https://github.com/ChainSafe/lodestar-z/commit/2439ca1bf88c9ae4a5867d4c947f54eda9b0c1d3))
* **stf:** replace load-state recursive diff with linear scan ([#741](https://github.com/ChainSafe/lodestar-z/issues/741)) ([ddaca79](https://github.com/ChainSafe/lodestar-z/commit/ddaca79cddee60791b128a3edaa8a6667c877661))
* **stf:** retire the no-op post-state metrics hook ([#707](https://github.com/ChainSafe/lodestar-z/issues/707)) ([0300a13](https://github.com/ChainSafe/lodestar-z/commit/0300a138480fcd21f4cd56ea9b3bb5bc293b36e3))
* **stf:** use fixed tail for new validator flags ([#733](https://github.com/ChainSafe/lodestar-z/issues/733)) ([367b69f](https://github.com/ChainSafe/lodestar-z/commit/367b69f0e88175369e651e70400b6abaf9ec772b))
* write error values as error.Name ([#718](https://github.com/ChainSafe/lodestar-z/issues/718)) ([36a8b7c](https://github.com/ChainSafe/lodestar-z/commit/36a8b7c1a1fdafcb5199655a88bd28e62ef8e7f2))


### Miscellaneous Chores

* **deps:** bump hashtree revision ([#743](https://github.com/ChainSafe/lodestar-z/issues/743)) ([fa50568](https://github.com/ChainSafe/lodestar-z/commit/fa5056811dab729ccdf10f54898bab68a7af9bd5))
* remove benchmark CI ([#715](https://github.com/ChainSafe/lodestar-z/issues/715)) ([561193b](https://github.com/ChainSafe/lodestar-z/commit/561193b16b03806fe36b411ecad384303b48c2e9))


### Documentation

* call a source file a file, not a module ([#719](https://github.com/ChainSafe/lodestar-z/issues/719)) ([31f4975](https://github.com/ChainSafe/lodestar-z/commit/31f49753e501e6e871ee0c70ebb56382b08c435c))
* retire security implementation map ([#696](https://github.com/ChainSafe/lodestar-z/issues/696)) ([f3e8ad1](https://github.com/ChainSafe/lodestar-z/commit/f3e8ad13264af6dfc047fe4a46d1cbfcf12eac8f))

## [1.1.0](https://github.com/ChainSafe/lodestar-z/compare/v1.0.0...v1.1.0) (2026-09-11)


### Features

* **metrics:** record exported but unset state transition gauges ([#662](https://github.com/ChainSafe/lodestar-z/issues/662)) ([d57e89a](https://github.com/ChainSafe/lodestar-z/commit/d57e89a4e05290615fbceeebd14b83a7f903ae98))
* **metrics:** report proposer rewards per type ([#689](https://github.com/ChainSafe/lodestar-z/issues/689)) ([d2eaabe](https://github.com/ChainSafe/lodestar-z/commit/d2eaabe75d21a816705acb62923a941d237d378f))
* **napi:** expose forkSeq on BeaconStateView binding ([#635](https://github.com/ChainSafe/lodestar-z/issues/635)) ([213a732](https://github.com/ChainSafe/lodestar-z/commit/213a732db5f68476a0ffefc556d9aac5307c3617))
* **shuffle:** add ./shuffle subpath export ([#612](https://github.com/ChainSafe/lodestar-z/issues/612)) ([c9655c4](https://github.com/ChainSafe/lodestar-z/commit/c9655c41176a0f657384f0ada9342be51d76ee74))
* **shuffle:** add PTC sampling ([#563](https://github.com/ChainSafe/lodestar-z/issues/563)) ([ab56ddf](https://github.com/ChainSafe/lodestar-z/commit/ab56ddfb2f50d3a97aae23e82e4ede0df279a9f0))
* **ssz:** add Progressive List, Progressive BitList, ProgressiveContainer, CompatibleUnion  ([#99](https://github.com/ChainSafe/lodestar-z/issues/99)) ([1e43f5e](https://github.com/ChainSafe/lodestar-z/commit/1e43f5e9336b574ffeab870c54e2ee0ef797f365))


### Bug Fixes

* avoid duplicate phase0 pending-attestation participants ([#659](https://github.com/ChainSafe/lodestar-z/issues/659)) ([bdc0cd0](https://github.com/ChainSafe/lodestar-z/commit/bdc0cd06376ff9de7bbc521713ea4e6f32b92cee))
* **bench:** stabilize committee benchmark inputs ([#606](https://github.com/ChainSafe/lodestar-z/issues/606)) ([5b2c3b1](https://github.com/ChainSafe/lodestar-z/commit/5b2c3b13dd4326c2fe0b64dd9ba7f93d634d933b))
* **bindings:** expose explicit state view disposal ([#649](https://github.com/ChainSafe/lodestar-z/issues/649)) ([cb42fa0](https://github.com/ChainSafe/lodestar-z/commit/cb42fa061f44d78371ea14eafc6caf2cc924e6d8))
* **bindings:** support blinded state transitions ([#628](https://github.com/ChainSafe/lodestar-z/issues/628)) ([3fdb5aa](https://github.com/ChainSafe/lodestar-z/commit/3fdb5aabf98552d809532e790bbbd8c4ec3a283c))
* hash block body when converting to header ([#657](https://github.com/ChainSafe/lodestar-z/issues/657)) ([692dd5b](https://github.com/ChainSafe/lodestar-z/commit/692dd5b9b667c9106f8af980e620e1ed7baa278c))
* **pmt:** reclaim grouped intermediate roots ([#599](https://github.com/ChainSafe/lodestar-z/issues/599)) ([f7e9a8b](https://github.com/ChainSafe/lodestar-z/commit/f7e9a8bd97f4a50e556953b7e987a0626020f046))
* **pmt:** reclaim partial compact proof nodes ([#609](https://github.com/ChainSafe/lodestar-z/issues/609)) ([c99eff3](https://github.com/ChainSafe/lodestar-z/commit/c99eff343d4fa6acd04c25616440597038158f52))
* **pmt:** reject empty compact proof leaves ([#610](https://github.com/ChainSafe/lodestar-z/issues/610)) ([5bc9297](https://github.com/ChainSafe/lodestar-z/commit/5bc9297feaa30a88c69f506c6f7d7c438e06edc2))
* preserve participation view ownership on rotation failure ([#643](https://github.com/ChainSafe/lodestar-z/issues/643)) ([660434c](https://github.com/ChainSafe/lodestar-z/commit/660434cfd9953485ce31e1a008bd5a0937cc0791))
* preserve sync committee ownership on rotation OOM ([#652](https://github.com/ChainSafe/lodestar-z/issues/652)) ([3a3b497](https://github.com/ChainSafe/lodestar-z/commit/3a3b497ffc560d28d1844ea5bad8eeb6d8730d1a))
* prevent duplicate Altair sync cache cleanup ([#651](https://github.com/ChainSafe/lodestar-z/issues/651)) ([eb23182](https://github.com/ChainSafe/lodestar-z/commit/eb2318223dcacb1dc747322d174f2f2c907e2de8))
* reject short seed validator bytes ([#653](https://github.com/ChainSafe/lodestar-z/issues/653)) ([5cd576b](https://github.com/ChainSafe/lodestar-z/commit/5cd576b144e73d8d3f6694e2c8d04de0d5efdd29))
* reject withdrawal count mismatches ([#619](https://github.com/ChainSafe/lodestar-z/issues/619)) ([3add44d](https://github.com/ChainSafe/lodestar-z/commit/3add44d371cda2b929049895da810e3c3e2aa0be))
* release benchmark hasher scratch ([#688](https://github.com/ChainSafe/lodestar-z/issues/688)) ([8628415](https://github.com/ChainSafe/lodestar-z/commit/8628415b9ce745035a0a1a0861852821cadffb36))
* release bitlist json scratch ([#677](https://github.com/ChainSafe/lodestar-z/issues/677)) ([acef3e7](https://github.com/ChainSafe/lodestar-z/commit/acef3e7e059fed813d66ff8c50b826f95f6efa51))
* report proposer rewards from block transitions ([#655](https://github.com/ChainSafe/lodestar-z/issues/655)) ([2f0755f](https://github.com/ChainSafe/lodestar-z/commit/2f0755fade578fd3c3fcb72e5f99be2b66e67a7e))
* split tests in variable element iterator ([#650](https://github.com/ChainSafe/lodestar-z/issues/650)) ([747b321](https://github.com/ChainSafe/lodestar-z/commit/747b321cd138357a75a6f15f7e713403ecc51886))
* **ssz:** clean up partially decoded blocks ([#596](https://github.com/ChainSafe/lodestar-z/issues/596)) ([e77358e](https://github.com/ChainSafe/lodestar-z/commit/e77358e7f67fdfc9a3ed12550b732a59b9b79d95))
* **ssz:** clean up partially initialized tree view values ([#579](https://github.com/ChainSafe/lodestar-z/issues/579)) ([5de24e2](https://github.com/ChainSafe/lodestar-z/commit/5de24e2f1999f987111b8559493450ee81ef35d8))
* **ssz:** clean up recursive hasher initialization ([#592](https://github.com/ChainSafe/lodestar-z/issues/592)) ([ffa29f8](https://github.com/ChainSafe/lodestar-z/commit/ffa29f82fbe4e746d7a632487601e19aef0199ce))
* **ssz:** free variable list offsets on decode errors ([#595](https://github.com/ChainSafe/lodestar-z/issues/595)) ([32e1d14](https://github.com/ChainSafe/lodestar-z/commit/32e1d141d3599ca2678a7540e20b1f5cd50ffe65))
* **ssz:** hash boolean lists as basic lists ([#602](https://github.com/ChainSafe/lodestar-z/issues/602)) ([e2b9598](https://github.com/ChainSafe/lodestar-z/commit/e2b959824820651ad8bbeefccc6da175f585de6c))
* **ssz:** instantiate variable vector tree views ([#600](https://github.com/ChainSafe/lodestar-z/issues/600)) ([5f7beaf](https://github.com/ChainSafe/lodestar-z/commit/5f7beaf8a2042dd461830a5412e91deb0291a32e))
* **ssz:** keep clone destinations deinit-safe ([#614](https://github.com/ChainSafe/lodestar-z/issues/614)) ([8917c51](https://github.com/ChainSafe/lodestar-z/commit/8917c51f6d660dc82190a15586389a72d01ca307))
* **ssz:** make container commits failure-atomic ([#567](https://github.com/ChainSafe/lodestar-z/issues/567)) ([cbfadb9](https://github.com/ChainSafe/lodestar-z/commit/cbfadb9640751e8f7533be6e709962ab92f033a4))
* **ssz:** make tree view publication atomic ([#574](https://github.com/ChainSafe/lodestar-z/issues/574)) ([9c98cb2](https://github.com/ChainSafe/lodestar-z/commit/9c98cb2e1b2dc0979e0d7830ec3cac32499c9941))
* **ssz:** preserve container view state after failed child reads ([#646](https://github.com/ChainSafe/lodestar-z/issues/646)) ([966bdc8](https://github.com/ChainSafe/lodestar-z/commit/966bdc8ddc34305ff2989a6393156256a21f6de7))
* **ssz:** reclaim partial byte and bit vector trees ([#594](https://github.com/ChainSafe/lodestar-z/issues/594)) ([f4c81d0](https://github.com/ChainSafe/lodestar-z/commit/f4c81d0465852791eebb05e041f0501060d8e9d4))
* **ssz:** reject invalid list growth lengths ([#604](https://github.com/ChainSafe/lodestar-z/issues/604)) ([0fa8e7c](https://github.com/ChainSafe/lodestar-z/commit/0fa8e7c9452f4cedb6de11b177c771bf1644a42c))
* **ssz:** reject noncanonical booleans in list and vector trees ([#645](https://github.com/ChainSafe/lodestar-z/issues/645)) ([2e5aba3](https://github.com/ChainSafe/lodestar-z/commit/2e5aba3b5680ab7b58d5de3353e9f95afa38c015))
* **ssz:** reject overflowing bit list indexes ([#603](https://github.com/ChainSafe/lodestar-z/issues/603)) ([7d3ba65](https://github.com/ChainSafe/lodestar-z/commit/7d3ba656bb9b80284f3df3e45ebfe6328052b73f))
* **ssz:** validate bit list length before hashing ([#608](https://github.com/ChainSafe/lodestar-z/issues/608)) ([a038e86](https://github.com/ChainSafe/lodestar-z/commit/a038e86e3c9b5d902b8d1a0a6a5b2e92d07da8eb))
* stabilize ptc benchmark seeds ([#674](https://github.com/ChainSafe/lodestar-z/issues/674)) ([2e1c781](https://github.com/ChainSafe/lodestar-z/commit/2e1c781d7746a1e50a6e3b47c36d44d796e399c4))
* **state_transition:** reuse shared shuffled index cache ([#638](https://github.com/ChainSafe/lodestar-z/issues/638)) ([807bae3](https://github.com/ChainSafe/lodestar-z/commit/807bae379eb01e7b009ae955e939c9acf0e4b98b))
* **state-transition:** clean up upgraded payload headers ([#597](https://github.com/ChainSafe/lodestar-z/issues/597)) ([e47028d](https://github.com/ChainSafe/lodestar-z/commit/e47028dd3b44de972790d015d2b3dd2569996660))
* **state-transition:** count validator filling withdrawal payload ([#656](https://github.com/ChainSafe/lodestar-z/issues/656)) ([22eea7e](https://github.com/ChainSafe/lodestar-z/commit/22eea7e188dd380bc382115f58e9f89cff48d5e6))
* **state-transition:** prevent next-shuffling ownership corruption on decision-root failure ([#634](https://github.com/ChainSafe/lodestar-z/issues/634)) ([c62cd29](https://github.com/ChainSafe/lodestar-z/commit/c62cd292973c6203c8a177caaba50f09f45403b9))
* **stf:** allocate epoch cache clone before refs ([#639](https://github.com/ChainSafe/lodestar-z/issues/639)) ([9076673](https://github.com/ChainSafe/lodestar-z/commit/90766733cd8721e35150a331ba1cd8686fecfcde))
* **stf:** cleanup sync committee indices on init OOM path ([#631](https://github.com/ChainSafe/lodestar-z/issues/631)) ([58a9fcb](https://github.com/ChainSafe/lodestar-z/commit/58a9fcbc1364b4a175b533990f36741a9b03767f))
* **stf:** fix epochshuffling slot committee slice leaks ([#636](https://github.com/ChainSafe/lodestar-z/issues/636)) ([c61367d](https://github.com/ChainSafe/lodestar-z/commit/c61367d897aa156af74e46d60b894281d7900efc))
* **stf:** justify exact two-thirds participation ([#623](https://github.com/ChainSafe/lodestar-z/issues/623)) ([7e4e322](https://github.com/ChainSafe/lodestar-z/commit/7e4e322c978c1c1504b3e004694f8d8ca083ae38))
* **stf:** keep expected withdrawals query read-only ([#620](https://github.com/ChainSafe/lodestar-z/issues/620)) ([e646cf0](https://github.com/ChainSafe/lodestar-z/commit/e646cf0349bb8c49bab118abbdce67016bf7988a))
* **stf:** safe pending withdrawal map reads with get ([#630](https://github.com/ChainSafe/lodestar-z/issues/630)) ([4f29bbb](https://github.com/ChainSafe/lodestar-z/commit/4f29bbbc95b5d89f409e167116b5bdd530ffc18f))
* **stf:** treat Capella as post-merge ([#624](https://github.com/ChainSafe/lodestar-z/issues/624)) ([057310e](https://github.com/ChainSafe/lodestar-z/commit/057310e17688c62557196072cc8bf1128415eba0))
* use integer square root for Phase0 rewards ([#654](https://github.com/ChainSafe/lodestar-z/issues/654)) ([ba63288](https://github.com/ChainSafe/lodestar-z/commit/ba6328898f7411db4a5be93f1ebe98dbb9f99963))


### Performance Improvements

* allocate epoch scratch buffers on demand ([#665](https://github.com/ChainSafe/lodestar-z/issues/665)) ([fc4e50b](https://github.com/ChainSafe/lodestar-z/commit/fc4e50b15ba7f0ea081f2ebc1391aea13a808e6b))
* fill reusable participation buffers directly ([#660](https://github.com/ChainSafe/lodestar-z/issues/660)) ([7a1b16f](https://github.com/ChainSafe/lodestar-z/commit/7a1b16f47c6907797acd4789f705be083d3b0496))
* **ssz:** avoid scratch allocation in chunked list serialization ([#642](https://github.com/ChainSafe/lodestar-z/issues/642)) ([f16981b](https://github.com/ChainSafe/lodestar-z/commit/f16981bd97898380897853f6f114de0f205df187))
* **ssz:** bound list hashing scratch with batched accumulation ([#672](https://github.com/ChainSafe/lodestar-z/issues/672)) ([ef82b72](https://github.com/ChainSafe/lodestar-z/commit/ef82b724021cddc63749fe4d1f8717ab1e2375ed))
* **ssz:** hash dirty basic field roots directly ([#615](https://github.com/ChainSafe/lodestar-z/issues/615)) ([a859403](https://github.com/ChainSafe/lodestar-z/commit/a8594031c141067c8dfe7a60b3390f8d1b68d81e))
* **ssz:** size progressive fixed lists without materializing values ([#641](https://github.com/ChainSafe/lodestar-z/issues/641)) ([f3dc6ff](https://github.com/ChainSafe/lodestar-z/commit/f3dc6ff88d1b1f48d2021758eda2d6ab2f4a21a7))
* **ssz:** stream list tree reads into output values ([#671](https://github.com/ChainSafe/lodestar-z/issues/671)) ([1ac2e51](https://github.com/ChainSafe/lodestar-z/commit/1ac2e518eb67bdb192a31373d28ab5274c195ddc))
* **state-transition:** optimize slashing penalties ([#676](https://github.com/ChainSafe/lodestar-z/issues/676)) ([b01424a](https://github.com/ChainSafe/lodestar-z/commit/b01424a11f647eeb3b6087850d47b9c36f6d251d))
* use branchless swaps in shuffle ([#661](https://github.com/ChainSafe/lodestar-z/issues/661)) ([e18fb84](https://github.com/ChainSafe/lodestar-z/commit/e18fb8407ad6bd3668bcf023aa25382bb2ac9866))


### Code Refactoring

* extract tests to _test.zig, add tidy lint ([#625](https://github.com/ChainSafe/lodestar-z/issues/625)) ([bb485bb](https://github.com/ChainSafe/lodestar-z/commit/bb485bbc02714bb0e53ade32302952c75a50a794))
* **metrics:** drop SSZ node-cache metrics ([#666](https://github.com/ChainSafe/lodestar-z/issues/666)) ([5d35494](https://github.com/ChainSafe/lodestar-z/commit/5d35494f154087d092f2eee2a37f0c47ee89fa46))
* **pmt:** bound lazy hashing and compact proof depth ([#647](https://github.com/ChainSafe/lodestar-z/issues/647)) ([52f5113](https://github.com/ChainSafe/lodestar-z/commit/52f5113c5b3b7d78e5bfca5f424f0a8eacd9fdf2))
* **pmt:** compute proof descriptors with integer paths ([#644](https://github.com/ChainSafe/lodestar-z/issues/644)) ([d4cc6b9](https://github.com/ChainSafe/lodestar-z/commit/d4cc6b9e9b75c82315432b0b6d3794382051a7c3))
* **pmt:** make node pool non-growable ([#617](https://github.com/ChainSafe/lodestar-z/issues/617)) ([9827bf2](https://github.com/ChainSafe/lodestar-z/commit/9827bf2bb52fcaf5660aeb35c92d64fc9fe8023b))
* **pubkeys:** drop deserialized lookup wrappers ([#584](https://github.com/ChainSafe/lodestar-z/issues/584)) ([8ec2897](https://github.com/ChainSafe/lodestar-z/commit/8ec28977146f02a1b075740d4d99a7e1a5993c37))
* remove redundant epoch benchmark reward synchronization ([#668](https://github.com/ChainSafe/lodestar-z/issues/668)) ([947e828](https://github.com/ChainSafe/lodestar-z/commit/947e828f9f94a43a15b58f6c8c641a62fdb1eef8))
* share bytelist tree conversion ([#680](https://github.com/ChainSafe/lodestar-z/issues/680)) ([cfc90f4](https://github.com/ChainSafe/lodestar-z/commit/cfc90f4a86baf4167d7b776c961e22dd82e29665))
* **shuffle:** drop JS signature comments and fix balance param name ([#577](https://github.com/ChainSafe/lodestar-z/issues/577)) ([be598b1](https://github.com/ChainSafe/lodestar-z/commit/be598b1165a9e35892d9aa0eb024ef27d12ef07b))
* **ssz:** rewrite offset iteration for variable element iteration ([#598](https://github.com/ChainSafe/lodestar-z/issues/598)) ([af63364](https://github.com/ChainSafe/lodestar-z/commit/af63364e1c3cf968508a32dfd2a68f33d38e8ac4))
* **ssz:** share byte-list hashing with generic uint8 lists ([#673](https://github.com/ChainSafe/lodestar-z/issues/673)) ([34cdddd](https://github.com/ChainSafe/lodestar-z/commit/34cdddd7c8b7ed5bb7b65dab0e4781e2baa81437))
* **ssz:** simplify progressive bit list type ([#637](https://github.com/ChainSafe/lodestar-z/issues/637)) ([abb41fa](https://github.com/ChainSafe/lodestar-z/commit/abb41faf13e3164940714c20a7f6be6d8df7368c))
* **stf:** remove unused epoch transition cache options ([#667](https://github.com/ChainSafe/lodestar-z/issues/667)) ([31cc99e](https://github.com/ChainSafe/lodestar-z/commit/31cc99ecfdc5cf005458d67d5d8d8e7425224174))


### Miscellaneous Chores

* **docs:** document bls/pk cache trust assumptions ([#585](https://github.com/ChainSafe/lodestar-z/issues/585)) ([66ecb23](https://github.com/ChainSafe/lodestar-z/commit/66ecb2315943f7a0ea2d1a718575be415a4328ae))
* **docs:** readme housekeeping + add contributing doc ([#560](https://github.com/ChainSafe/lodestar-z/issues/560)) ([f780208](https://github.com/ChainSafe/lodestar-z/commit/f7802080467fb2bde6f63a3a1d55d525d775b328))


### Documentation

* add PR title and description guidelines ([#640](https://github.com/ChainSafe/lodestar-z/issues/640)) ([33a3f2f](https://github.com/ChainSafe/lodestar-z/commit/33a3f2fbebd14ecb083f57290721f4992d3fcadd))

## [1.0.0](https://github.com/ChainSafe/lodestar-z/compare/v0.1.2...v1.0.0) (2026-08-19)


### Features

* add `state.getBuildersLength()` binding ([#472](https://github.com/ChainSafe/lodestar-z/issues/472)) ([be2b5ab](https://github.com/ChainSafe/lodestar-z/commit/be2b5ab2a3cfdab76abe90ce1404f51cd1ecfedc))
* **beacon-node:** add block state cache and checkpoint datastore ([#452](https://github.com/ChainSafe/lodestar-z/issues/452)) ([2145faa](https://github.com/ChainSafe/lodestar-z/commit/2145faab40bdb33da418956facbd377572ac9c80))
* bindings to `getExpectedWithdrawals` and native tweaks ([#350](https://github.com/ChainSafe/lodestar-z/issues/350)) ([f47bc66](https://github.com/ChainSafe/lodestar-z/commit/f47bc66eb882a052cfbe0606c11507fae0dadc83))
* **bindings:** add pubkey cache syncPubkeys ([#537](https://github.com/ChainSafe/lodestar-z/issues/537)) ([542779f](https://github.com/ChainSafe/lodestar-z/commit/542779fc84efe7395cbc0c908802dc586337d131))
* **bindings:** aggregate cached public keys by validator index ([#397](https://github.com/ChainSafe/lodestar-z/issues/397)) ([2f90603](https://github.com/ChainSafe/lodestar-z/commit/2f90603c1bd67abeeeae442991906b656ba7718e))
* **bindings:** align `BeaconStateView` with `IBeaconStateView` ([#347](https://github.com/ChainSafe/lodestar-z/issues/347)) ([b8ec273](https://github.com/ChainSafe/lodestar-z/commit/b8ec27350b3ca64e04bb9e332552a9f629f39d8c))
* **bindings:** configurable pubkey cache growth step ([#481](https://github.com/ChainSafe/lodestar-z/issues/481)) ([133ef24](https://github.com/ChainSafe/lodestar-z/commit/133ef248a5e6dec11dac8f3dfd6879920e217834))
* **bindings:** expose more APIs for STF ([#444](https://github.com/ChainSafe/lodestar-z/issues/444)) ([7fe2609](https://github.com/ChainSafe/lodestar-z/commit/7fe260909a0ff75d34176a761029dbb55fa09c48))
* **bls:** add small MSM for npoints &lt; 32 ([#393](https://github.com/ChainSafe/lodestar-z/issues/393)) ([b430638](https://github.com/ChainSafe/lodestar-z/commit/b430638132545c9714c51146c41d3a4b0b3d19ac))
* **blst:** use external buffers for blst operations ([#358](https://github.com/ChainSafe/lodestar-z/issues/358)) ([78e4678](https://github.com/ChainSafe/lodestar-z/commit/78e4678df2429cbd412956a14ebc4778438d3b32))
* **ci:** conditionally publish bindings with tag ([#355](https://github.com/ChainSafe/lodestar-z/issues/355)) ([ea77919](https://github.com/ChainSafe/lodestar-z/commit/ea7791983dbc280e17579b9ca73e4f62c937ae4f))
* **clock:** add clock module for slot/epoch timing ([#354](https://github.com/ChainSafe/lodestar-z/issues/354)) ([385b077](https://github.com/ChainSafe/lodestar-z/commit/385b077bff15198c27bc410bb1c52543a670a48c))
* **fork_choice:** add Prometheus metrics module ([#309](https://github.com/ChainSafe/lodestar-z/issues/309)) ([cbc9d8d](https://github.com/ChainSafe/lodestar-z/commit/cbc9d8d23e9755b9f1533e10194699fd6a5b6862))
* **forkchoice:** implement the forkchoice module ([#246](https://github.com/ChainSafe/lodestar-z/issues/246)) ([7c62a9b](https://github.com/ChainSafe/lodestar-z/commit/7c62a9b3bf1ebf1bb52f3b904f746c9cdab8aec7))
* getSyncCommitteesWitness ([#367](https://github.com/ChainSafe/lodestar-z/issues/367)) ([ef77649](https://github.com/ChainSafe/lodestar-z/commit/ef77649c5620837773ce010b42c07d67c4904a67))
* implement `loadState` API and binding ([#165](https://github.com/ChainSafe/lodestar-z/issues/165)) ([f903519](https://github.com/ChainSafe/lodestar-z/commit/f90351969227e83a2f23b3129ca78dcfab11b890)), closes [#159](https://github.com/ChainSafe/lodestar-z/issues/159)
* **metrics:** metrics bindings ([#455](https://github.com/ChainSafe/lodestar-z/issues/455)) ([dd41999](https://github.com/ChainSafe/lodestar-z/commit/dd41999540f280f927c68e488c16540172331b23))
* migrate blst,pubkeys to use zapi js dsl ([#331](https://github.com/ChainSafe/lodestar-z/issues/331)) ([fcd26ca](https://github.com/ChainSafe/lodestar-z/commit/fcd26caf6c36f8aecfea9ed9c7b5a36e27293bcb))
* **pubkeys:** add getPubkeyBytes binding ([#555](https://github.com/ChainSafe/lodestar-z/issues/555)) ([4ca51cf](https://github.com/ChainSafe/lodestar-z/commit/4ca51cf972ab0e1665e014afc7950a2edc85303c))
* publish ARM64 musl bindings ([#482](https://github.com/ChainSafe/lodestar-z/issues/482)) ([ac764c9](https://github.com/ChainSafe/lodestar-z/commit/ac764c92c9fcb326e64c518c21880655f3efc8d9))
* **shuffle:** add swap-or-not shuffling module and binding ([#559](https://github.com/ChainSafe/lodestar-z/issues/559)) ([c2db37c](https://github.com/ChainSafe/lodestar-z/commit/c2db37ce1b405e2d39e6180b3f45a24d7c312ca4))
* split nextValue fn ([#464](https://github.com/ChainSafe/lodestar-z/issues/464)) ([b47faeb](https://github.com/ChainSafe/lodestar-z/commit/b47faeb683e4c5cbffb1292786e6c06111fa3a5d))
* support getLatestWeakSubjectivityCheckpointEpoch ([#366](https://github.com/ChainSafe/lodestar-z/issues/366)) ([dcf3883](https://github.com/ChainSafe/lodestar-z/commit/dcf3883e49bf47f0804fdfb649e328ce98b0f84d))
* update fulu deposit processing ([#442](https://github.com/ChainSafe/lodestar-z/issues/442)) ([064335c](https://github.com/ChainSafe/lodestar-z/commit/064335c0dc51f09c8ed96384f296721f50f14f88))


### Bug Fixes

* avoid set ([#484](https://github.com/ChainSafe/lodestar-z/issues/484)) ([2e25d97](https://github.com/ChainSafe/lodestar-z/commit/2e25d97fadfbf170647c21799550c37502639f1c))
* better generation of rand scalar ([#388](https://github.com/ChainSafe/lodestar-z/issues/388)) ([74dce77](https://github.com/ChainSafe/lodestar-z/commit/74dce77656a74745601c964eeb493e0a8b2a67e1))
* **bindings:** accept `dontTransferCache` in processSlots for backward compatibility ([#460](https://github.com/ChainSafe/lodestar-z/issues/460)) ([65df5af](https://github.com/ChainSafe/lodestar-z/commit/65df5aff04cc557ad0208773d4dbc840a239a236))
* **bindings:** check signature infinity by default ([#509](https://github.com/ChainSafe/lodestar-z/issues/509)) ([2f5f281](https://github.com/ChainSafe/lodestar-z/commit/2f5f281ccc6710630fcf0cb8e23c2eda3629974c))
* **bindings:** clean up failed async BLS work ([#527](https://github.com/ChainSafe/lodestar-z/issues/527)) ([1111b00](https://github.com/ChainSafe/lodestar-z/commit/1111b009b51609a92a925537020deb899fc91463))
* **bindings:** free metrics writer on scrape failure ([#529](https://github.com/ChainSafe/lodestar-z/issues/529)) ([4c8d94a](https://github.com/ChainSafe/lodestar-z/commit/4c8d94a8331065e2c0cc59f39dd433cb39440265))
* **bindings:** harden random aggregate scalars ([#528](https://github.com/ChainSafe/lodestar-z/issues/528)) ([8e89a63](https://github.com/ChainSafe/lodestar-z/commit/8e89a634103e5ff7597904766abb343ece4a4ce4))
* **bindings:** log level for missing fields ([#435](https://github.com/ChainSafe/lodestar-z/issues/435)) ([08faf41](https://github.com/ChainSafe/lodestar-z/commit/08faf41c03ebd54ee5149573f984433d721343d7))
* **bindings:** misordering of print for cpu count ([#381](https://github.com/ChainSafe/lodestar-z/issues/381)) ([752a972](https://github.com/ChainSafe/lodestar-z/commit/752a97294d5c4613edfae75909ff21d21b7cdb48))
* **bindings:** populate epoch participation for test fixtures ([#436](https://github.com/ChainSafe/lodestar-z/issues/436)) ([8dbdd2e](https://github.com/ChainSafe/lodestar-z/commit/8dbdd2ed87c2f58cf1b5415f4e031c4e4da9a451))
* **bindings:** refcount Pool to fix teardown panic ([#352](https://github.com/ChainSafe/lodestar-z/issues/352)) ([23b2f68](https://github.com/ChainSafe/lodestar-z/commit/23b2f68fb6f5f0dd3d91f3f40184fe88e601612f))
* **bindings:** roll back partial N-API initialization ([#491](https://github.com/ChainSafe/lodestar-z/issues/491)) ([31c5ebb](https://github.com/ChainSafe/lodestar-z/commit/31c5ebb5710e0025d64070a258547727baed4d37))
* **bindings:** size BLS thread pool by cgroup-aware CPU count ([#386](https://github.com/ChainSafe/lodestar-z/issues/386)) ([3ae9522](https://github.com/ChainSafe/lodestar-z/commit/3ae95226b31a0094f56b2294c198acd23479c625))
* **bindings:** validate class types before unwrap ([#514](https://github.com/ChainSafe/lodestar-z/issues/514)) ([2fd2ad5](https://github.com/ChainSafe/lodestar-z/commit/2fd2ad57be7a3c5207bb6b953ebe2d6f8a07d605))
* **bindings:** validate secret key hex length ([#517](https://github.com/ChainSafe/lodestar-z/issues/517)) ([136e415](https://github.com/ChainSafe/lodestar-z/commit/136e415d69fe41fffd032a106b1b5b4a16f0a1ed))
* **bls:** align PublicKey.uncompress validation with Signature.uncompress ([#508](https://github.com/ChainSafe/lodestar-z/issues/508)) ([5a8dbe9](https://github.com/ChainSafe/lodestar-z/commit/5a8dbe951ab45f578d8f7ac8d794c9c72022e79f))
* **bls:** bound randomized aggregation inputs ([#548](https://github.com/ChainSafe/lodestar-z/issues/548)) ([779d0bf](https://github.com/ChainSafe/lodestar-z/commit/779d0bf084154698cfeab84c4016785db5cde2f2)), closes [#542](https://github.com/ChainSafe/lodestar-z/issues/542)
* **bls:** clean up partial thread pool initialization ([#490](https://github.com/ChainSafe/lodestar-z/issues/490)) ([d55e598](https://github.com/ChainSafe/lodestar-z/commit/d55e598e1269be3de095c86be64ee196891cfbfb))
* **bls:** convert pippenger scratch bytes to element counts ([#513](https://github.com/ChainSafe/lodestar-z/issues/513)) ([a12ca92](https://github.com/ChainSafe/lodestar-z/commit/a12ca929e592257403457e0b71bbe6992a1863b8))
* **bls:** enforce 32-byte signing roots ([#545](https://github.com/ChainSafe/lodestar-z/issues/545)) ([72fd308](https://github.com/ChainSafe/lodestar-z/commit/72fd308f695ff50bcb61c88e1be6265d34bbffe3))
* **bls:** make batch cardinality structural ([#547](https://github.com/ChainSafe/lodestar-z/issues/547)) ([a06d8b2](https://github.com/ChainSafe/lodestar-z/commit/a06d8b28325c2e4e3879b50792fc979efd8dacd3))
* **bls:** preserve aggregate outputs on failure ([#521](https://github.com/ChainSafe/lodestar-z/issues/521)) ([e0b6dd1](https://github.com/ChainSafe/lodestar-z/commit/e0b6dd1f975f46d6f572851084ecb4656c013931))
* **bls:** reject empty keygen salts ([#524](https://github.com/ChainSafe/lodestar-z/issues/524)) ([d2a9c86](https://github.com/ChainSafe/lodestar-z/commit/d2a9c86cab29e1c2654237f08cb576695c3cf6a1))
* **bls:** reject unknown BLST error codes ([#525](https://github.com/ChainSafe/lodestar-z/issues/525)) ([9e4a6ad](https://github.com/ChainSafe/lodestar-z/commit/9e4a6ad4794af7bfdb60c4f7ced7a7f4000d8377))
* **bls:** size pairing buffers for 32-bit targets ([#531](https://github.com/ChainSafe/lodestar-z/issues/531)) ([dc64a27](https://github.com/ChainSafe/lodestar-z/commit/dc64a27e546920ebb34686cdb5fbc8b62dd38a0a))
* **blst:** default signature infinity check to true if not provided ([#387](https://github.com/ChainSafe/lodestar-z/issues/387)) ([021cdcb](https://github.com/ChainSafe/lodestar-z/commit/021cdcb4a37d7c45a0be86d3ba19cad7be600501))
* **build:** remove `zig-out` from `files` ([#360](https://github.com/ChainSafe/lodestar-z/issues/360)) ([c52af09](https://github.com/ChainSafe/lodestar-z/commit/c52af099ca5d8046d61ccef192dc46e3f79d3b07))
* **ci:** fix caching spec test version ([#439](https://github.com/ChainSafe/lodestar-z/issues/439)) ([96885a1](https://github.com/ChainSafe/lodestar-z/commit/96885a101cabbc7b70d58823778db6f3dd57fa42))
* dangling state pointer in loadOtherState ([#450](https://github.com/ChainSafe/lodestar-z/issues/450)) ([81cbd5f](https://github.com/ChainSafe/lodestar-z/commit/81cbd5f221e7b7c5eb20e681190bfd98e04e1f92))
* **epoch_cache:** compute missing `next_proposers` ([#447](https://github.com/ChainSafe/lodestar-z/issues/447)) ([0088a29](https://github.com/ChainSafe/lodestar-z/commit/0088a2988d7712a38d470a617fdaab1ea0ae7736))
* **epoch_cache:** populate decision roots in afterProcessEpoch ([#453](https://github.com/ChainSafe/lodestar-z/issues/453)) ([4b70a5e](https://github.com/ChainSafe/lodestar-z/commit/4b70a5edcd1dd65871567b306e8d0a8d8a25a8d4))
* export asyncAggregateWithRandomness through napi binding ([#371](https://github.com/ChainSafe/lodestar-z/issues/371)) ([1d04c2b](https://github.com/ChainSafe/lodestar-z/commit/1d04c2b00f90d340abc543427c35467b3622826b))
* harden memory safety across PMT, SSZ tree views, and state transition ([#377](https://github.com/ChainSafe/lodestar-z/issues/377)) ([d6f5897](https://github.com/ChainSafe/lodestar-z/commit/d6f5897a065e0fab91915a90567204299936b374))
* improve atomic ordering in ThreadPool and NAPI init ([#310](https://github.com/ChainSafe/lodestar-z/issues/310)) ([4b0a1cc](https://github.com/ChainSafe/lodestar-z/commit/4b0a1cc1b204b777e6df364949cafe093ca144e6))
* interface compatbility with NativeBeaconStateView ([#445](https://github.com/ChainSafe/lodestar-z/issues/445)) ([89e13d1](https://github.com/ChainSafe/lodestar-z/commit/89e13d1847dd54db476ae80764a627649de7bd0e))
* missing deinits in loadOtherState ([#459](https://github.com/ChainSafe/lodestar-z/issues/459)) ([094d278](https://github.com/ChainSafe/lodestar-z/commit/094d27855a549927857da8a996821a4a269b2291))
* missing state commits ([#454](https://github.com/ChainSafe/lodestar-z/issues/454)) ([a432b55](https://github.com/ChainSafe/lodestar-z/commit/a432b55eaef87f3d067d4ccf0de732a726040468))
* no-op when syncPubkeys run on a pk cache with shrinking validator set ([#432](https://github.com/ChainSafe/lodestar-z/issues/432)) ([ed05a99](https://github.com/ChainSafe/lodestar-z/commit/ed05a9979518746466f3c197b828c91cd34edbe5))
* param order in BeaconBlockBody ([#348](https://github.com/ChainSafe/lodestar-z/issues/348)) ([d8b9c06](https://github.com/ChainSafe/lodestar-z/commit/d8b9c06992d479c278d046813e398301c5a67c47))
* pendingConsolidations bindings ([#449](https://github.com/ChainSafe/lodestar-z/issues/449)) ([b9c497e](https://github.com/ChainSafe/lodestar-z/commit/b9c497e8ec058f7ce31f0014c5f2e3383be4c512))
* **pmt,ssz:** harden chunked-leaf and zero-copy tree-view memory safety ([#400](https://github.com/ChainSafe/lodestar-z/issues/400)) ([de50c53](https://github.com/ChainSafe/lodestar-z/commit/de50c538026156ca3ce9a013d69af546582fac3a))
* populate cache balances during rewards/penalties processing ([#474](https://github.com/ChainSafe/lodestar-z/issues/474)) ([5bf23dc](https://github.com/ChainSafe/lodestar-z/commit/5bf23dc4a664d84dcb91d14234128cc89c53b934))
* re-expose sizes ([#369](https://github.com/ChainSafe/lodestar-z/issues/369)) ([64b81f3](https://github.com/ChainSafe/lodestar-z/commit/64b81f34e346dbca9cc05697f0b59977cab2bff4))
* remove `slashValidator` gating on active status ([#448](https://github.com/ChainSafe/lodestar-z/issues/448)) ([d319a0d](https://github.com/ChainSafe/lodestar-z/commit/d319a0d2dbd2fa52ddc75b17eefda71e23c03b2f))
* **ssz:** drop redundant default-init pass in fixed-list decode ([#468](https://github.com/ChainSafe/lodestar-z/issues/468)) ([0c757be](https://github.com/ChainSafe/lodestar-z/commit/0c757be3f4a3d24b92e227660bfd05dca704618b))
* **ssz:** publish child cache entries after lookup ([#565](https://github.com/ChainSafe/lodestar-z/issues/565)) ([21e78c9](https://github.com/ChainSafe/lodestar-z/commit/21e78c985349ef2f9e2af4c8d3d34ba9bf3cfbd7))
* state transition binding exports ([#456](https://github.com/ChainSafe/lodestar-z/issues/456)) ([895982c](https://github.com/ChainSafe/lodestar-z/commit/895982cf1b9002c8e72a8ca83b8daeddcb862a6a))
* **state-transition:** group-check signature sets ([#515](https://github.com/ChainSafe/lodestar-z/issues/515)) ([42774e9](https://github.com/ChainSafe/lodestar-z/commit/42774e9b1cf652203acc46bf10edf21910fcd309)), closes [#502](https://github.com/ChainSafe/lodestar-z/issues/502)
* **state-transition:** isolate epoch step cache mutations ([#535](https://github.com/ChainSafe/lodestar-z/issues/535)) ([a83741a](https://github.com/ChainSafe/lodestar-z/commit/a83741afca96590a6639ffa0b0c515f29619086b))
* **state-transition:** repair Pool.init call broken by [#346](https://github.com/ChainSafe/lodestar-z/issues/346)×[#367](https://github.com/ChainSafe/lodestar-z/issues/367) merge skew ([#394](https://github.com/ChainSafe/lodestar-z/issues/394)) ([b42944f](https://github.com/ChainSafe/lodestar-z/commit/b42944fb199ff12a29e5debeae5189eadcd09b50))
* various fixes around config ([#433](https://github.com/ChainSafe/lodestar-z/issues/433)) ([c4f082c](https://github.com/ChainSafe/lodestar-z/commit/c4f082c00c30933ec97072bcff9966a1aa62694d))


### Performance Improvements

* **bindings:** drop TS BLS comparison benches and report benchmarks on PRs ([#552](https://github.com/ChainSafe/lodestar-z/issues/552)) ([c909c6f](https://github.com/ChainSafe/lodestar-z/commit/c909c6f7a40a30eb42071e2b58686f800c45c8bd))
* **bls:** add cache-aware signature verifier ([#562](https://github.com/ChainSafe/lodestar-z/issues/562)) ([063857e](https://github.com/ChainSafe/lodestar-z/commit/063857ef108d758f246382afb418fe2c33cc47b6))
* **bls:** bypass worker queue for small batches ([#553](https://github.com/ChainSafe/lodestar-z/issues/553)) ([3f8a6df](https://github.com/ChainSafe/lodestar-z/commit/3f8a6dfb83cd73679f748f0f50504fccfdc37584))
* **epoch:** replace AutoHashMap with array lookup in reward/penalty caches ([#286](https://github.com/ChainSafe/lodestar-z/issues/286)) ([e4e181b](https://github.com/ChainSafe/lodestar-z/commit/e4e181b65bd690a026abe6dffdb121a324a06266)), closes [#243](https://github.com/ChainSafe/lodestar-z/issues/243)
* **pmt:** chunked-leaf packing for basic lists and container_struct ([#346](https://github.com/ChainSafe/lodestar-z/issues/346)) ([ba156c4](https://github.com/ChainSafe/lodestar-z/commit/ba156c4385416a0b12aec6ce4ac91144326a762a))


### Code Refactoring

* allocate `AsyncAggRandData` in one obj ([#384](https://github.com/ChainSafe/lodestar-z/issues/384)) ([459750f](https://github.com/ChainSafe/lodestar-z/commit/459750fecfa8288519371080b57fd664d1fad57d))
* **bindings/pubkeys:** simplify allocation strategy for aggregate ([#518](https://github.com/ChainSafe/lodestar-z/issues/518)) ([b82750f](https://github.com/ChainSafe/lodestar-z/commit/b82750f6c3ec3d57ed63fe31c2f968d4527ce0a5))
* **bindings:** rename blst Lifecycle to State ([#516](https://github.com/ChainSafe/lodestar-z/issues/516)) ([0a9c179](https://github.com/ChainSafe/lodestar-z/commit/0a9c179af299a5408d837e0347e43a1e6e1e76ca))
* **bindings:** use zapi js.io() instead of local io module ([#469](https://github.com/ChainSafe/lodestar-z/issues/469)) ([2b34cc0](https://github.com/ChainSafe/lodestar-z/commit/2b34cc02fb1df10af308196c552a4965937e66c4))
* **bindings:** wake only required number of workers ([#383](https://github.com/ChainSafe/lodestar-z/issues/383)) ([1db57f1](https://github.com/ChainSafe/lodestar-z/commit/1db57f1ec426112065aa5d06b4ab64ae2da508ca))
* **bls:** allocations around VMAS ([#395](https://github.com/ChainSafe/lodestar-z/issues/395)) ([dfda58c](https://github.com/ChainSafe/lodestar-z/commit/dfda58c32c2b08b716923cd50acfc0c4978c3fb3))
* **bls:** clean up bls ([#398](https://github.com/ChainSafe/lodestar-z/issues/398)) ([e0f3b9b](https://github.com/ChainSafe/lodestar-z/commit/e0f3b9baa8e43bc9234156e48cac9768b14ff7a3))
* **bls:** remove need for tracking results for verifyMultipleAggregateSignatures ([#389](https://github.com/ChainSafe/lodestar-z/issues/389)) ([6fe5c3f](https://github.com/ChainSafe/lodestar-z/commit/6fe5c3fb4fdc641632cdb671a3c45c934b4dc6a4))
* **bls:** remove single-threaded fallback ([#390](https://github.com/ChainSafe/lodestar-z/issues/390)) ([e057713](https://github.com/ChainSafe/lodestar-z/commit/e0577138e14884134ff29f2ebb80b5232ddf3a4e))
* **clock:** single public Clock; internalize SlotClock ([#463](https://github.com/ChainSafe/lodestar-z/issues/463)) ([fbab1fa](https://github.com/ChainSafe/lodestar-z/commit/fbab1fa1f12cbd670005cec7ee6d780cfa7eb80e))
* make XXXDecisionRoot fns return `js.String` ([#342](https://github.com/ChainSafe/lodestar-z/issues/342)) ([aef4420](https://github.com/ChainSafe/lodestar-z/commit/aef44205b31dd48916c43cc3d47b918434e4901d))
* move shuffle into swap_or_not_shuffle module ([#558](https://github.com/ChainSafe/lodestar-z/issues/558)) ([e56efb2](https://github.com/ChainSafe/lodestar-z/commit/e56efb2ddf0577aefdd2102f06f81416972329ae))
* **pubkeys:** centralize the process-wide cache ([#522](https://github.com/ChainSafe/lodestar-z/issues/522)) ([dc9669d](https://github.com/ChainSafe/lodestar-z/commit/dc9669dbbe131aeee56605e785d46108a87d4e82))


### Miscellaneous Chores

* avoid slow tests in AGENTS.md ([#546](https://github.com/ChainSafe/lodestar-z/issues/546)) ([c60f2a9](https://github.com/ChainSafe/lodestar-z/commit/c60f2a9dae9b131b716e802e22c6d37c850d6dd8))
* bump zapi to include musl build ([#485](https://github.com/ChainSafe/lodestar-z/issues/485)) ([0b488cc](https://github.com/ChainSafe/lodestar-z/commit/0b488cccadbce6d09a31f9a874be868f9ffbe3ec))
* **ci:** pin github actions with sha hashes ([#507](https://github.com/ChainSafe/lodestar-z/issues/507)) ([167b8f5](https://github.com/ChainSafe/lodestar-z/commit/167b8f5cb484c2d3e23d2a75f42c96a92e178bcb))
* deprecate unused blst APIs ([#575](https://github.com/ChainSafe/lodestar-z/issues/575)) ([7b547fa](https://github.com/ChainSafe/lodestar-z/commit/7b547fa29377a8f7f457448418b0c24ce57126af))
* **deps:** bump zapi v2.1.0 -&gt; v2.2.0 ([#376](https://github.com/ChainSafe/lodestar-z/issues/376)) ([0c240d8](https://github.com/ChainSafe/lodestar-z/commit/0c240d864596971c6aa00151ce0efdfe75c41de6))
* **deps:** bump zbuild ([#403](https://github.com/ChainSafe/lodestar-z/issues/403)) ([e2545de](https://github.com/ChainSafe/lodestar-z/commit/e2545de171f74206456a50b983f1153399c00988))
* **deps:** compile blst with ReleaseFast ([#391](https://github.com/ChainSafe/lodestar-z/issues/391)) ([753a896](https://github.com/ChainSafe/lodestar-z/commit/753a896e88e41acb4508a0834ac1408629375377))
* **deps:** update zapi to 3.1.0 ([#483](https://github.com/ChainSafe/lodestar-z/issues/483)) ([f3e5827](https://github.com/ChainSafe/lodestar-z/commit/f3e582759985347440acee620f8535c402b1daee))
* **deps:** use zapi v2.1.0 ([#372](https://github.com/ChainSafe/lodestar-z/issues/372)) ([88f403a](https://github.com/ChainSafe/lodestar-z/commit/88f403aba0e380523b695d169c92fd8e32963c6d))
* disable gemini auto code review ([#382](https://github.com/ChainSafe/lodestar-z/issues/382)) ([63e42a4](https://github.com/ChainSafe/lodestar-z/commit/63e42a4224c09b7c6b241cd802bccbf6b6951a89)), closes [#380](https://github.com/ChainSafe/lodestar-z/issues/380)
* **docs:** add comments section in AGENTS.md ([#566](https://github.com/ChainSafe/lodestar-z/issues/566)) ([0c09750](https://github.com/ChainSafe/lodestar-z/commit/0c0975098fd97ba02a447a8cdec736c91a3e806f))
* move state clones out of benchmark run functions ([#324](https://github.com/ChainSafe/lodestar-z/issues/324)) ([e4035de](https://github.com/ChainSafe/lodestar-z/commit/e4035dedcb88d8ea77f1b77db5a661c4f3ffab6d))
* prepare 1.0.0 release ([#576](https://github.com/ChainSafe/lodestar-z/issues/576)) ([20b657b](https://github.com/ChainSafe/lodestar-z/commit/20b657b34ee9f0b643590496e7c212481909d51d))
* release v0.1.2-rc.3 ([#370](https://github.com/ChainSafe/lodestar-z/issues/370)) ([e4fc551](https://github.com/ChainSafe/lodestar-z/commit/e4fc551c42cb9ee1280f9dc1b576e0b4c790ee34))
* **release:** 0.1.2-rc.2 ([#365](https://github.com/ChainSafe/lodestar-z/issues/365)) ([7046128](https://github.com/ChainSafe/lodestar-z/commit/7046128439880284b88b69ca78869fc5c976e977))
* **release:** v0.1.2-rc.10 ([#477](https://github.com/ChainSafe/lodestar-z/issues/477)) ([9a4fad5](https://github.com/ChainSafe/lodestar-z/commit/9a4fad55533aefcaccef67fe45d48a747c6f82a4))
* **release:** v0.1.2-rc.4 ([#373](https://github.com/ChainSafe/lodestar-z/issues/373)) ([09468f1](https://github.com/ChainSafe/lodestar-z/commit/09468f1c652318df06e461fa82f078e9b613c324))
* **release:** v0.1.2-rc.5 ([#374](https://github.com/ChainSafe/lodestar-z/issues/374)) ([f344efa](https://github.com/ChainSafe/lodestar-z/commit/f344efa74df756581f8d1dfea62f1d19ec668fd8))
* **release:** v0.1.2-rc.6 ([#375](https://github.com/ChainSafe/lodestar-z/issues/375)) ([bdf5b67](https://github.com/ChainSafe/lodestar-z/commit/bdf5b67cefd382f0409c1e1e80ca3d9abb7e0e59))
* **release:** v0.1.2-rc.8 ([#401](https://github.com/ChainSafe/lodestar-z/issues/401)) ([06f91c2](https://github.com/ChainSafe/lodestar-z/commit/06f91c26dc7b6b3d00ad35726812f6770787ea07))
* **release:** v0.1.2-rc.9 ([#404](https://github.com/ChainSafe/lodestar-z/issues/404)) ([6024800](https://github.com/ChainSafe/lodestar-z/commit/602480070524c0fe3e6099d7aae94ad5568d2d83))
* remove merge transition code ([#359](https://github.com/ChainSafe/lodestar-z/issues/359)) ([09b175d](https://github.com/ChainSafe/lodestar-z/commit/09b175d3e41ac63cb1c086b66606fc6be20fcaa0))
* remove stale epoch cache TODOs ([#534](https://github.com/ChainSafe/lodestar-z/issues/534)) ([27a547a](https://github.com/ChainSafe/lodestar-z/commit/27a547a8fece842f67e165e2d1ceffe43db3716d))
* rename era shortHistoricalRoot to shortEraRoot ([#473](https://github.com/ChainSafe/lodestar-z/issues/473)) ([c75a4d3](https://github.com/ChainSafe/lodestar-z/commit/c75a4d3837fc7a6e06d1619b888cdc68296435a6))
* **scripts:** build bindings with preset ([#434](https://github.com/ChainSafe/lodestar-z/issues/434)) ([a1b5ef7](https://github.com/ChainSafe/lodestar-z/commit/a1b5ef770534e1446744bb12d4bbc8469aabccc7))
* silence debug log when used in release builds ([#486](https://github.com/ChainSafe/lodestar-z/issues/486)) ([c5377d7](https://github.com/ChainSafe/lodestar-z/commit/c5377d7a1f6d7e97c0cdf78b97219e7484f97613))
* support dev workflow ([#364](https://github.com/ChainSafe/lodestar-z/issues/364)) ([fcb9a78](https://github.com/ChainSafe/lodestar-z/commit/fcb9a78dc10bdbe22b7d9a74e6db5100c1be21ca))
* update gloas types to align with the latest specs ([#431](https://github.com/ChainSafe/lodestar-z/issues/431)) ([1f065b5](https://github.com/ChainSafe/lodestar-z/commit/1f065b5a6db119fe7e61906b6fbf09fcc902b7f9))
* update spec test version to v1.7.0-alpha.11 ([#451](https://github.com/ChainSafe/lodestar-z/issues/451)) ([5875660](https://github.com/ChainSafe/lodestar-z/commit/5875660fa56f41f9c6072e16dfa4f58cabee3fba))
* update spec-test-version: v1.6.0-beta.2 -&gt; v1.7.0-alpha.10 ([#441](https://github.com/ChainSafe/lodestar-z/issues/441)) ([f932b1c](https://github.com/ChainSafe/lodestar-z/commit/f932b1cc777f240fc5cf821c488e9d45c439f660))
* update zapi to 4.0.0 ([#571](https://github.com/ChainSafe/lodestar-z/issues/571)) ([de8e3fd](https://github.com/ChainSafe/lodestar-z/commit/de8e3fd1da17ab9e9feb8a2521c8027f284254a3))


### Documentation

* document security threat model ([#557](https://github.com/ChainSafe/lodestar-z/issues/557)) ([e678b87](https://github.com/ChainSafe/lodestar-z/commit/e678b87c81783f9318dbb692015318ed85f3e6f8))
* more comprehensive AGENTS.md ([#520](https://github.com/ChainSafe/lodestar-z/issues/520)) ([c74b386](https://github.com/ChainSafe/lodestar-z/commit/c74b38612689df56d2e64c4bc0be029be02ed275))
* **pkix:** document load provenance requirement ([#556](https://github.com/ChainSafe/lodestar-z/issues/556)) ([37e0aa2](https://github.com/ChainSafe/lodestar-z/commit/37e0aa2beeadfbeb558a30b15e72aa4e297bad83))

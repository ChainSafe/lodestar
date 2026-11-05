# Changelog

Historical issue numbers refer to the retired source repository. Commit and comparison
links use the history preserved in Lodestar.

## [2.2.0](https://github.com/ChainSafe/lodestar/compare/2d1f6fe707c7c188091cc51f4ebcfa19978cfe31...b8ca543b9babc4f9ae4e2241623739f76d20c6fa) (2026-10-26)


### Features

* add basic heze support (legacy issue #799) ([5cbf8db](https://github.com/ChainSafe/lodestar/commit/5cbf8db38b07660cfac1105b12b9390683596140))


### Bug Fixes

* build fuzz harnesses in ReleaseSafe (legacy issue #805) ([5d6fd73](https://github.com/ChainSafe/lodestar/commit/5d6fd73c206f4343f8b02a435049a65320f12730))
* use sha256 wrapper in sync committee rotation (legacy issue #802) ([9989f29](https://github.com/ChainSafe/lodestar/commit/9989f297805a81291c1bed653869f2294272e7be))


### Performance Improvements

* select shuffle sha256 at runtime (legacy issue #774) ([4167cfe](https://github.com/ChainSafe/lodestar/commit/4167cfeae2eca69a1c9e2ec2e3fb8813708f56c7))
* speed up sync committee rotation (legacy issue #778) ([78da4e7](https://github.com/ChainSafe/lodestar/commit/78da4e7b9512eb8df1eaf37de089d5dde2616583))

## [2.1.0](https://github.com/ChainSafe/lodestar/compare/33b4110b91fda5e67b8604345dc9b02114e8c6d3...2d1f6fe707c7c188091cc51f4ebcfa19978cfe31) (2026-10-20)


### Features

* add `bench_ssz` step (legacy issue #318) ([874de23](https://github.com/ChainSafe/lodestar/commit/874de23c5f0c7937c3b15b09f97be7948922e9f8))
* add gloas state transition (legacy issue #764) ([f7493b7](https://github.com/ChainSafe/lodestar/commit/f7493b715041b5493ffdfaa8cc168de077b2e20c))
* add gnosis preset (legacy issue #791) ([ba4f89e](https://github.com/ChainSafe/lodestar/commit/ba4f89e967bdb498f1d856f699f1ba2b863be330))
* add heze timing configuration (legacy issue #794) ([906ea62](https://github.com/ChainSafe/lodestar/commit/906ea627245c28d4e7e1bbf941a4436945462fd1))
* add struct progressive container (legacy issue #777) ([1de4ebd](https://github.com/ChainSafe/lodestar/commit/1de4ebd92f9f2a79404be05dae0ca1d09d9d2cee))
* **metrics:** add sub-second epoch transition histogram buckets (legacy issue #759) ([bf96e24](https://github.com/ChainSafe/lodestar/commit/bf96e24bceccf443f04162873fc4cc88b59fc680))
* **metrics:** label state transitions by source (legacy issue #772) ([65dc676](https://github.com/ChainSafe/lodestar/commit/65dc6761129bb8d39759ba313ee493158fae63d5))
* support progressive ssz views (legacy issue #793) ([91d03b3](https://github.com/ChainSafe/lodestar/commit/91d03b3dac363b02a320af19af6938c72ec16a3d))
* verify EIP-8025 execution proofs through ere's C verifier (legacy issue #760) ([f069a4d](https://github.com/ChainSafe/lodestar/commit/f069a4dd5aaf24e2a10e7760bb95869528648dd2))


### Bug Fixes

* include commit in block timing (legacy issue #767) ([88a968b](https://github.com/ChainSafe/lodestar/commit/88a968b0145cfb50e75fb45bbebf4aa4021fd014))
* include histogram upper bounds (legacy issue #766) ([f6fbe20](https://github.com/ChainSafe/lodestar/commit/f6fbe2069c209643a69bf1893ee399d5f64f22f4))
* prepare state before rewards (legacy issue #755) ([a1361f0](https://github.com/ChainSafe/lodestar/commit/a1361f038bd1c4101483307f9f70c6e100f31e8d))
* preserve shuffling input ownership (legacy issue #753) ([589e23a](https://github.com/ChainSafe/lodestar/commit/589e23a2283474b91e58d6687573e7e5733c00b0))
* release failed batch parents (legacy issue #790) ([24a8e4a](https://github.com/ChainSafe/lodestar/commit/24a8e4ac800bd1b20c6ee229db05dcbf4299d0cd))
* support serialized transaction lists (legacy issue #796) ([24c5630](https://github.com/ChainSafe/lodestar/commit/24c5630788944b8c2f4a229bbc404375b5b8a54f))


### Performance Improvements

* expose sync committee indices (legacy issue #768) ([79032c5](https://github.com/ChainSafe/lodestar/commit/79032c552fe11947876e42ae0a8dc2d315343313))
* store shuffling indices as u32 (legacy issue #797) ([c17d132](https://github.com/ChainSafe/lodestar/commit/c17d1328587505473d302918e0862616382d75a0))
* stream progressive tree construction (legacy issue #746) ([41fa6dd](https://github.com/ChainSafe/lodestar/commit/41fa6dde7d560c9c673fcf1621fef4a76ed3c152))
* stream progressive tree reads (legacy issue #745) ([5fbb0e2](https://github.com/ChainSafe/lodestar/commit/5fbb0e23a64c9a3e3670135787dd750f573630ec))
* vectorize shuffle swap loop (legacy issue #769) ([40194cb](https://github.com/ChainSafe/lodestar/commit/40194cba93f7a058046da00d7bb49bdb9fa27712))


### Code Refactoring

* clarify progressive decode ownership (legacy issue #771) ([0221893](https://github.com/ChainSafe/lodestar/commit/0221893a6189755723787df11124e7a982a34e81))
* leave decode cleanup to callers (legacy issue #761) ([9561036](https://github.com/ChainSafe/lodestar/commit/95610364dd4cfd481eacc82230f3c39f7f278d4e))


### Miscellaneous Chores

* add apache-2.0 license (legacy issue #781) ([964fefc](https://github.com/ChainSafe/lodestar/commit/964fefc332e39e907e35c2acdfbf623e603d2ee0))


### Documentation

* bench with the baseline cpu like release bindings (legacy issue #786) ([0b36087](https://github.com/ChainSafe/lodestar/commit/0b36087874cf566b931a101cb692c2cf32206ae9))
* use ReleaseSafe in bench run instructions (legacy issue #785) ([b1751bf](https://github.com/ChainSafe/lodestar/commit/b1751bf0fb8a9f0f3ac574da68a987acdd335952))

## [2.0.0](https://github.com/ChainSafe/lodestar/compare/5fac7c11c17548cca8af6c9fca99d0e22ff9e818...33b4110b91fda5e67b8604345dc9b02114e8c6d3) (2026-10-05)


### ⚠ BREAKING CHANGES

* **bindings:** `bindings.config.set()` is removed. Construct a `BeaconConfig(chainConfig, genesisValidatorsRoot)` and pass it to `BeaconStateView.createFromBytes(bytes, config)`. `ExecutionPayloadHeader.blobGasUsed` and `excessBlobGas` are now `bigint`.
* **bindings:** `getBeaconCommittee(slot, index)` returns `Uint32Array` instead of `number[]`.
* **bindings:** `Eth1Data.depositCount` is now `bigint`, including in `eth1Data`, `eth1DataVotes` and `toValue()` output.
* **bindings:** `computeBlockRewards(signedBlockBytes, isBlinded, proposerRewards?)` now takes serialized block bytes and returns `BlockRewards` synchronously instead of a Promise.

### Features

* add typed stf diagnostics (legacy issue #694) ([d143920](https://github.com/ChainSafe/lodestar/commit/d1439208b1c57c70ae3e7341d22ab4db764b2c82))
* **bindings:** implement computeBlockRewards ([1ec864e](https://github.com/ChainSafe/lodestar/commit/1ec864e52ee6c33c67d146c6a75e897c2009cd9a))
* **bindings:** implement remaining rewards apis (legacy issue #731) ([3cdf9ea](https://github.com/ChainSafe/lodestar/commit/3cdf9ea4501baf4af086eda085280ddc4b7d1eb6))
* **metrics:** track block transition steps (legacy issue #737) ([697d390](https://github.com/ChainSafe/lodestar/commit/697d390eadd29e5b07ba5f4bb76a7776e8ddf1e4))
* partial validator monitor (legacy issue #475) ([2c595d3](https://github.com/ChainSafe/lodestar/commit/2c595d330101b6b32ab811de179f315c85443003))
* **stf:** zero-alloc `processSyncAggregate` (legacy issue #269) ([bd68732](https://github.com/ChainSafe/lodestar/commit/bd6873289731f9cef133c0a667fbd5ad6f222ea5))


### Bug Fixes

* accept bigint proof indices (legacy issue #699) ([0a528a4](https://github.com/ChainSafe/lodestar/commit/0a528a444f72dbda978b03224032b69b45c19393))
* **bindings:** declare sync-committee index map values as Uint32Array (legacy issue #706) ([175c080](https://github.com/ChainSafe/lodestar/commit/175c080834ecab77a0005077b0812ddb21185832))
* **bindings:** depositCount as bigint ([6133ed0](https://github.com/ChainSafe/lodestar/commit/6133ed0aba77ef557cfbe6da9c1c047c470bcfa8))
* **bindings:** emit eth1Data.depositCount as bigint (legacy issue #730) ([bd746f5](https://github.com/ChainSafe/lodestar/commit/bd746f587a66f753455c52776edff3469e232f92))
* **bindings:** make native STF setup and memory ownership safe ([ef6c313](https://github.com/ChainSafe/lodestar/commit/ef6c313cf1ad8a127cc53ba96cf5c4887c89ea14))
* **bindings:** preserve eth1 bigint values (legacy issue #735) ([dd6e0d3](https://github.com/ChainSafe/lodestar/commit/dd6e0d30a610eb4e4cb7c3337f4a23a000a2da81))
* **bindings:** return beacon committee as Uint32Array ([0f7ce2d](https://github.com/ChainSafe/lodestar/commit/0f7ce2d2fe45430d728c748644249c4e01e7e132))
* **bindings:** return sync committee index maps (legacy issue #691) ([2f1a177](https://github.com/ChainSafe/lodestar/commit/2f1a177a10171c1a9f5cead09f7ebb2d3b9aa7db))
* **bindings:** return sync committee positions as arrays (legacy issue #714) ([1696068](https://github.com/ChainSafe/lodestar/commit/1696068087567885e33c977de534721abe589506))
* **bindings:** use c_allocator for BeaconStateView outside Debug (legacy issue #732) ([f83914b](https://github.com/ChainSafe/lodestar/commit/f83914b3e360b2d903996ea940f84c2f85d3ce76))
* clean up inactivity scores (legacy issue #702) ([fca5032](https://github.com/ChainSafe/lodestar/commit/fca5032ff3116a407331bee31e72a57e49ee83bd))
* isolate binding benchmark suites in separate processes (legacy issue #708) ([0915ae7](https://github.com/ChainSafe/lodestar/commit/0915ae7d9a1c86ae02ce8c5eef4787a08ba6c3c9))
* preserve pending view nodes (legacy issue #740) ([8a3d024](https://github.com/ChainSafe/lodestar/commit/8a3d024f6be525d5a978756f4b9734196e904703))
* **ssz:** make progressive scratch mutable (legacy issue #725) ([495e5b2](https://github.com/ChainSafe/lodestar/commit/495e5b28892818bda16b44ad9a0bd8e055cb4444))
* stage composite child roots (legacy issue #747) ([b70e8f5](https://github.com/ChainSafe/lodestar/commit/b70e8f5662a08a0d177b2f7c96e2c16e5b1b6cce))
* **state-transition:** report withdrawal count mismatch (legacy issue #752) ([b5c1013](https://github.com/ChainSafe/lodestar/commit/b5c10138f84c58072d62d0abd806041ee69280a8))
* **state-transition:** use getReadonly for read-only validator access (legacy issue #712) ([daebcf1](https://github.com/ChainSafe/lodestar/commit/daebcf1beff537a0c9f39819362a31be57dccf6d))
* **stf:** clean up failed Altair participation translation (legacy issue #695) ([d8c06af](https://github.com/ChainSafe/lodestar/commit/d8c06af27fa2bf87fec37554089ffd0762051b38))
* **stf:** floor the sync-aggregate proposer penalty and guard phase0 lookups (legacy issue #705) ([407c60d](https://github.com/ChainSafe/lodestar/commit/407c60d39f7146d3cfa352736b2d10e7840693b1))
* **stf:** self-heal progressive balance drift (legacy issue #726) ([ede068a](https://github.com/ChainSafe/lodestar/commit/ede068af58d0fc8e56a17e140e051a217124b33a))
* **types:** correct Electra blinded attester slashing limit (legacy issue #698) ([15d3347](https://github.com/ChainSafe/lodestar/commit/15d33475436f9a3f05509702803b913e0b627827))


### Performance Improvements

* avoid proposer lookahead allocation (legacy issue #716) ([5e82cc4](https://github.com/ChainSafe/lodestar/commit/5e82cc438a4fac37c618820ec8fb7b8f3e71c6e4))
* bound bitlist hashing workspace (legacy issue #678) ([0ece146](https://github.com/ChainSafe/lodestar/commit/0ece14665dcae47082092e55989e77891d3bdc96))
* bound progressive builder scratch (legacy issue #687) ([52a9736](https://github.com/ChainSafe/lodestar/commit/52a97361212e64f1a0ebb58fc645ed74b50ada07))
* bound progressive merkleization workspace (legacy issue #685) ([c243df8](https://github.com/ChainSafe/lodestar/commit/c243df8df330dd52d1b4dac016eefa1f6e3127f4))
* overlap Fulu shuffling with epoch processing (legacy issue #727) ([3d978b8](https://github.com/ChainSafe/lodestar/commit/3d978b8cca281d4b273637366ad6e35c29b880d4))
* shuffle compact validator positions (legacy issue #734) ([ea963b1](https://github.com/ChainSafe/lodestar/commit/ea963b101ca50ffcaf544e969531293721382ccc))
* **state-transition:** diff-synced flat validator cache (legacy issue #736) ([d7282c7](https://github.com/ChainSafe/lodestar/commit/d7282c7a751d0b8c56b3e525af007bebaaee119b))
* stream bitlist tree reads (legacy issue #679) ([02d61c2](https://github.com/ChainSafe/lodestar/commit/02d61c2b9c9ca7361ea852b8f5458854f8522197))
* stream compact proof generation (legacy issue #683) ([57022b4](https://github.com/ChainSafe/lodestar/commit/57022b4bdd6a2c054d3eed2343b16e1e05596272))
* stream progressive hashing (legacy issue #744) ([1ceb7ca](https://github.com/ChainSafe/lodestar/commit/1ceb7ca7d14e3aa0d6195124c626fc5cb7866e38))
* stream progressive tree serialization (legacy issue #686) ([0f63529](https://github.com/ChainSafe/lodestar/commit/0f6352928bdf776384a03acd42afc0eb3cb23eff))


### Code Refactoring

* bound fixed vector hashing (legacy issue #681) ([0d04988](https://github.com/ChainSafe/lodestar/commit/0d04988234a116de40f3a1bcc74efdb9bf7c1d32))
* bound variable vector hashing (legacy issue #682) ([3da79f3](https://github.com/ChainSafe/lodestar/commit/3da79f3ef34a8a229092ccf284eff03bc7baf9bf))
* **epoch-cache:** make effectiveBalanceIncrementsSet append instead (legacy issue #721) ([bc748d8](https://github.com/ChainSafe/lodestar/commit/bc748d841e539494e12ecceeaef3578a648449a3))
* extract bit array module (legacy issue #693) ([f81415c](https://github.com/ChainSafe/lodestar/commit/f81415c9f1e53c1e9861b31263c756fdbf947139))
* iterate compact proof reconstruction (legacy issue #684) ([4051fcc](https://github.com/ChainSafe/lodestar/commit/4051fcc71d8e3af5e9d637e58af629879cbb4349))
* migrate deprecated zig std APIs (legacy issue #742) ([18aa0b6](https://github.com/ChainSafe/lodestar/commit/18aa0b6261ee740177e60d67ed13acee55ca778b))
* remove unused view reads (legacy issue #739) ([5015e0c](https://github.com/ChainSafe/lodestar/commit/5015e0cb55c1ce5ee70de4aa755ba6c19ee056d3))
* retain view roots last (legacy issue #738) ([77ad664](https://github.com/ChainSafe/lodestar/commit/77ad664a86e8261caa0d48aad487208d4946f6b4))
* **ssz:** centralize chunked-leaf mutation bookkeeping (legacy issue #690) ([9c478c7](https://github.com/ChainSafe/lodestar/commit/9c478c7ce5a63691fe1d90b73e128cf5d9d1318e))
* **state-transition:** remove reused cache lock (legacy issue #750) ([8b3dcc0](https://github.com/ChainSafe/lodestar/commit/8b3dcc0abe7dea809af59469148fa56a43e534ef))
* **stf:** make allocator ownership explicit (legacy issue #722) ([2439ca1](https://github.com/ChainSafe/lodestar/commit/2439ca1bf88c9ae4a5867d4c947f54eda9b0c1d3))
* **stf:** replace load-state recursive diff with linear scan (legacy issue #741) ([ddaca79](https://github.com/ChainSafe/lodestar/commit/ddaca79cddee60791b128a3edaa8a6667c877661))
* **stf:** retire the no-op post-state metrics hook (legacy issue #707) ([0300a13](https://github.com/ChainSafe/lodestar/commit/0300a138480fcd21f4cd56ea9b3bb5bc293b36e3))
* **stf:** use fixed tail for new validator flags (legacy issue #733) ([367b69f](https://github.com/ChainSafe/lodestar/commit/367b69f0e88175369e651e70400b6abaf9ec772b))
* write error values as error.Name (legacy issue #718) ([36a8b7c](https://github.com/ChainSafe/lodestar/commit/36a8b7c1a1fdafcb5199655a88bd28e62ef8e7f2))


### Miscellaneous Chores

* **deps:** bump hashtree revision (legacy issue #743) ([fa50568](https://github.com/ChainSafe/lodestar/commit/fa5056811dab729ccdf10f54898bab68a7af9bd5))
* remove benchmark CI (legacy issue #715) ([561193b](https://github.com/ChainSafe/lodestar/commit/561193b16b03806fe36b411ecad384303b48c2e9))


### Documentation

* call a source file a file, not a module (legacy issue #719) ([31f4975](https://github.com/ChainSafe/lodestar/commit/31f49753e501e6e871ee0c70ebb56382b08c435c))
* retire security implementation map (legacy issue #696) ([f3e8ad1](https://github.com/ChainSafe/lodestar/commit/f3e8ad13264af6dfc047fe4a46d1cbfcf12eac8f))

## [1.1.0](https://github.com/ChainSafe/lodestar/compare/a19d7462f339c729ee06ba89b91f29bf6a38047d...5fac7c11c17548cca8af6c9fca99d0e22ff9e818) (2026-09-11)


### Features

* **metrics:** record exported but unset state transition gauges (legacy issue #662) ([d57e89a](https://github.com/ChainSafe/lodestar/commit/d57e89a4e05290615fbceeebd14b83a7f903ae98))
* **metrics:** report proposer rewards per type (legacy issue #689) ([d2eaabe](https://github.com/ChainSafe/lodestar/commit/d2eaabe75d21a816705acb62923a941d237d378f))
* **napi:** expose forkSeq on BeaconStateView binding (legacy issue #635) ([213a732](https://github.com/ChainSafe/lodestar/commit/213a732db5f68476a0ffefc556d9aac5307c3617))
* **shuffle:** add ./shuffle subpath export (legacy issue #612) ([c9655c4](https://github.com/ChainSafe/lodestar/commit/c9655c41176a0f657384f0ada9342be51d76ee74))
* **shuffle:** add PTC sampling (legacy issue #563) ([ab56ddf](https://github.com/ChainSafe/lodestar/commit/ab56ddfb2f50d3a97aae23e82e4ede0df279a9f0))
* **ssz:** add Progressive List, Progressive BitList, ProgressiveContainer, CompatibleUnion  (legacy issue #99) ([1e43f5e](https://github.com/ChainSafe/lodestar/commit/1e43f5e9336b574ffeab870c54e2ee0ef797f365))


### Bug Fixes

* avoid duplicate phase0 pending-attestation participants (legacy issue #659) ([bdc0cd0](https://github.com/ChainSafe/lodestar/commit/bdc0cd06376ff9de7bbc521713ea4e6f32b92cee))
* **bench:** stabilize committee benchmark inputs (legacy issue #606) ([5b2c3b1](https://github.com/ChainSafe/lodestar/commit/5b2c3b13dd4326c2fe0b64dd9ba7f93d634d933b))
* **bindings:** expose explicit state view disposal (legacy issue #649) ([cb42fa0](https://github.com/ChainSafe/lodestar/commit/cb42fa061f44d78371ea14eafc6caf2cc924e6d8))
* **bindings:** support blinded state transitions (legacy issue #628) ([3fdb5aa](https://github.com/ChainSafe/lodestar/commit/3fdb5aabf98552d809532e790bbbd8c4ec3a283c))
* hash block body when converting to header (legacy issue #657) ([692dd5b](https://github.com/ChainSafe/lodestar/commit/692dd5b9b667c9106f8af980e620e1ed7baa278c))
* **pmt:** reclaim grouped intermediate roots (legacy issue #599) ([f7e9a8b](https://github.com/ChainSafe/lodestar/commit/f7e9a8bd97f4a50e556953b7e987a0626020f046))
* **pmt:** reclaim partial compact proof nodes (legacy issue #609) ([c99eff3](https://github.com/ChainSafe/lodestar/commit/c99eff343d4fa6acd04c25616440597038158f52))
* **pmt:** reject empty compact proof leaves (legacy issue #610) ([5bc9297](https://github.com/ChainSafe/lodestar/commit/5bc9297feaa30a88c69f506c6f7d7c438e06edc2))
* preserve participation view ownership on rotation failure (legacy issue #643) ([660434c](https://github.com/ChainSafe/lodestar/commit/660434cfd9953485ce31e1a008bd5a0937cc0791))
* preserve sync committee ownership on rotation OOM (legacy issue #652) ([3a3b497](https://github.com/ChainSafe/lodestar/commit/3a3b497ffc560d28d1844ea5bad8eeb6d8730d1a))
* prevent duplicate Altair sync cache cleanup (legacy issue #651) ([eb23182](https://github.com/ChainSafe/lodestar/commit/eb2318223dcacb1dc747322d174f2f2c907e2de8))
* reject short seed validator bytes (legacy issue #653) ([5cd576b](https://github.com/ChainSafe/lodestar/commit/5cd576b144e73d8d3f6694e2c8d04de0d5efdd29))
* reject withdrawal count mismatches (legacy issue #619) ([3add44d](https://github.com/ChainSafe/lodestar/commit/3add44d371cda2b929049895da810e3c3e2aa0be))
* release benchmark hasher scratch (legacy issue #688) ([8628415](https://github.com/ChainSafe/lodestar/commit/8628415b9ce745035a0a1a0861852821cadffb36))
* release bitlist json scratch (legacy issue #677) ([acef3e7](https://github.com/ChainSafe/lodestar/commit/acef3e7e059fed813d66ff8c50b826f95f6efa51))
* report proposer rewards from block transitions (legacy issue #655) ([2f0755f](https://github.com/ChainSafe/lodestar/commit/2f0755fade578fd3c3fcb72e5f99be2b66e67a7e))
* split tests in variable element iterator (legacy issue #650) ([747b321](https://github.com/ChainSafe/lodestar/commit/747b321cd138357a75a6f15f7e713403ecc51886))
* **ssz:** clean up partially decoded blocks (legacy issue #596) ([e77358e](https://github.com/ChainSafe/lodestar/commit/e77358e7f67fdfc9a3ed12550b732a59b9b79d95))
* **ssz:** clean up partially initialized tree view values (legacy issue #579) ([5de24e2](https://github.com/ChainSafe/lodestar/commit/5de24e2f1999f987111b8559493450ee81ef35d8))
* **ssz:** clean up recursive hasher initialization (legacy issue #592) ([ffa29f8](https://github.com/ChainSafe/lodestar/commit/ffa29f82fbe4e746d7a632487601e19aef0199ce))
* **ssz:** free variable list offsets on decode errors (legacy issue #595) ([32e1d14](https://github.com/ChainSafe/lodestar/commit/32e1d141d3599ca2678a7540e20b1f5cd50ffe65))
* **ssz:** hash boolean lists as basic lists (legacy issue #602) ([e2b9598](https://github.com/ChainSafe/lodestar/commit/e2b959824820651ad8bbeefccc6da175f585de6c))
* **ssz:** instantiate variable vector tree views (legacy issue #600) ([5f7beaf](https://github.com/ChainSafe/lodestar/commit/5f7beaf8a2042dd461830a5412e91deb0291a32e))
* **ssz:** keep clone destinations deinit-safe (legacy issue #614) ([8917c51](https://github.com/ChainSafe/lodestar/commit/8917c51f6d660dc82190a15586389a72d01ca307))
* **ssz:** make container commits failure-atomic (legacy issue #567) ([cbfadb9](https://github.com/ChainSafe/lodestar/commit/cbfadb9640751e8f7533be6e709962ab92f033a4))
* **ssz:** make tree view publication atomic (legacy issue #574) ([9c98cb2](https://github.com/ChainSafe/lodestar/commit/9c98cb2e1b2dc0979e0d7830ec3cac32499c9941))
* **ssz:** preserve container view state after failed child reads (legacy issue #646) ([966bdc8](https://github.com/ChainSafe/lodestar/commit/966bdc8ddc34305ff2989a6393156256a21f6de7))
* **ssz:** reclaim partial byte and bit vector trees (legacy issue #594) ([f4c81d0](https://github.com/ChainSafe/lodestar/commit/f4c81d0465852791eebb05e041f0501060d8e9d4))
* **ssz:** reject invalid list growth lengths (legacy issue #604) ([0fa8e7c](https://github.com/ChainSafe/lodestar/commit/0fa8e7c9452f4cedb6de11b177c771bf1644a42c))
* **ssz:** reject noncanonical booleans in list and vector trees (legacy issue #645) ([2e5aba3](https://github.com/ChainSafe/lodestar/commit/2e5aba3b5680ab7b58d5de3353e9f95afa38c015))
* **ssz:** reject overflowing bit list indexes (legacy issue #603) ([7d3ba65](https://github.com/ChainSafe/lodestar/commit/7d3ba656bb9b80284f3df3e45ebfe6328052b73f))
* **ssz:** validate bit list length before hashing (legacy issue #608) ([a038e86](https://github.com/ChainSafe/lodestar/commit/a038e86e3c9b5d902b8d1a0a6a5b2e92d07da8eb))
* stabilize ptc benchmark seeds (legacy issue #674) ([2e1c781](https://github.com/ChainSafe/lodestar/commit/2e1c781d7746a1e50a6e3b47c36d44d796e399c4))
* **state_transition:** reuse shared shuffled index cache (legacy issue #638) ([807bae3](https://github.com/ChainSafe/lodestar/commit/807bae379eb01e7b009ae955e939c9acf0e4b98b))
* **state-transition:** clean up upgraded payload headers (legacy issue #597) ([e47028d](https://github.com/ChainSafe/lodestar/commit/e47028dd3b44de972790d015d2b3dd2569996660))
* **state-transition:** count validator filling withdrawal payload (legacy issue #656) ([22eea7e](https://github.com/ChainSafe/lodestar/commit/22eea7e188dd380bc382115f58e9f89cff48d5e6))
* **state-transition:** prevent next-shuffling ownership corruption on decision-root failure (legacy issue #634) ([c62cd29](https://github.com/ChainSafe/lodestar/commit/c62cd292973c6203c8a177caaba50f09f45403b9))
* **stf:** allocate epoch cache clone before refs (legacy issue #639) ([9076673](https://github.com/ChainSafe/lodestar/commit/90766733cd8721e35150a331ba1cd8686fecfcde))
* **stf:** cleanup sync committee indices on init OOM path (legacy issue #631) ([58a9fcb](https://github.com/ChainSafe/lodestar/commit/58a9fcbc1364b4a175b533990f36741a9b03767f))
* **stf:** fix epochshuffling slot committee slice leaks (legacy issue #636) ([c61367d](https://github.com/ChainSafe/lodestar/commit/c61367d897aa156af74e46d60b894281d7900efc))
* **stf:** justify exact two-thirds participation (legacy issue #623) ([7e4e322](https://github.com/ChainSafe/lodestar/commit/7e4e322c978c1c1504b3e004694f8d8ca083ae38))
* **stf:** keep expected withdrawals query read-only (legacy issue #620) ([e646cf0](https://github.com/ChainSafe/lodestar/commit/e646cf0349bb8c49bab118abbdce67016bf7988a))
* **stf:** safe pending withdrawal map reads with get (legacy issue #630) ([4f29bbb](https://github.com/ChainSafe/lodestar/commit/4f29bbbc95b5d89f409e167116b5bdd530ffc18f))
* **stf:** treat Capella as post-merge (legacy issue #624) ([057310e](https://github.com/ChainSafe/lodestar/commit/057310e17688c62557196072cc8bf1128415eba0))
* use integer square root for Phase0 rewards (legacy issue #654) ([ba63288](https://github.com/ChainSafe/lodestar/commit/ba6328898f7411db4a5be93f1ebe98dbb9f99963))


### Performance Improvements

* allocate epoch scratch buffers on demand (legacy issue #665) ([fc4e50b](https://github.com/ChainSafe/lodestar/commit/fc4e50b15ba7f0ea081f2ebc1391aea13a808e6b))
* fill reusable participation buffers directly (legacy issue #660) ([7a1b16f](https://github.com/ChainSafe/lodestar/commit/7a1b16f47c6907797acd4789f705be083d3b0496))
* **ssz:** avoid scratch allocation in chunked list serialization (legacy issue #642) ([f16981b](https://github.com/ChainSafe/lodestar/commit/f16981bd97898380897853f6f114de0f205df187))
* **ssz:** bound list hashing scratch with batched accumulation (legacy issue #672) ([ef82b72](https://github.com/ChainSafe/lodestar/commit/ef82b724021cddc63749fe4d1f8717ab1e2375ed))
* **ssz:** hash dirty basic field roots directly (legacy issue #615) ([a859403](https://github.com/ChainSafe/lodestar/commit/a8594031c141067c8dfe7a60b3390f8d1b68d81e))
* **ssz:** size progressive fixed lists without materializing values (legacy issue #641) ([f3dc6ff](https://github.com/ChainSafe/lodestar/commit/f3dc6ff88d1b1f48d2021758eda2d6ab2f4a21a7))
* **ssz:** stream list tree reads into output values (legacy issue #671) ([1ac2e51](https://github.com/ChainSafe/lodestar/commit/1ac2e518eb67bdb192a31373d28ab5274c195ddc))
* **state-transition:** optimize slashing penalties (legacy issue #676) ([b01424a](https://github.com/ChainSafe/lodestar/commit/b01424a11f647eeb3b6087850d47b9c36f6d251d))
* use branchless swaps in shuffle (legacy issue #661) ([e18fb84](https://github.com/ChainSafe/lodestar/commit/e18fb8407ad6bd3668bcf023aa25382bb2ac9866))


### Code Refactoring

* extract tests to _test.zig, add tidy lint (legacy issue #625) ([bb485bb](https://github.com/ChainSafe/lodestar/commit/bb485bbc02714bb0e53ade32302952c75a50a794))
* **metrics:** drop SSZ node-cache metrics (legacy issue #666) ([5d35494](https://github.com/ChainSafe/lodestar/commit/5d35494f154087d092f2eee2a37f0c47ee89fa46))
* **pmt:** bound lazy hashing and compact proof depth (legacy issue #647) ([52f5113](https://github.com/ChainSafe/lodestar/commit/52f5113c5b3b7d78e5bfca5f424f0a8eacd9fdf2))
* **pmt:** compute proof descriptors with integer paths (legacy issue #644) ([d4cc6b9](https://github.com/ChainSafe/lodestar/commit/d4cc6b9e9b75c82315432b0b6d3794382051a7c3))
* **pmt:** make node pool non-growable (legacy issue #617) ([9827bf2](https://github.com/ChainSafe/lodestar/commit/9827bf2bb52fcaf5660aeb35c92d64fc9fe8023b))
* **pubkeys:** drop deserialized lookup wrappers (legacy issue #584) ([8ec2897](https://github.com/ChainSafe/lodestar/commit/8ec28977146f02a1b075740d4d99a7e1a5993c37))
* remove redundant epoch benchmark reward synchronization (legacy issue #668) ([947e828](https://github.com/ChainSafe/lodestar/commit/947e828f9f94a43a15b58f6c8c641a62fdb1eef8))
* share bytelist tree conversion (legacy issue #680) ([cfc90f4](https://github.com/ChainSafe/lodestar/commit/cfc90f4a86baf4167d7b776c961e22dd82e29665))
* **shuffle:** drop JS signature comments and fix balance param name (legacy issue #577) ([be598b1](https://github.com/ChainSafe/lodestar/commit/be598b1165a9e35892d9aa0eb024ef27d12ef07b))
* **ssz:** rewrite offset iteration for variable element iteration (legacy issue #598) ([af63364](https://github.com/ChainSafe/lodestar/commit/af63364e1c3cf968508a32dfd2a68f33d38e8ac4))
* **ssz:** share byte-list hashing with generic uint8 lists (legacy issue #673) ([34cdddd](https://github.com/ChainSafe/lodestar/commit/34cdddd7c8b7ed5bb7b65dab0e4781e2baa81437))
* **ssz:** simplify progressive bit list type (legacy issue #637) ([abb41fa](https://github.com/ChainSafe/lodestar/commit/abb41faf13e3164940714c20a7f6be6d8df7368c))
* **stf:** remove unused epoch transition cache options (legacy issue #667) ([31cc99e](https://github.com/ChainSafe/lodestar/commit/31cc99ecfdc5cf005458d67d5d8d8e7425224174))


### Miscellaneous Chores

* **docs:** document bls/pk cache trust assumptions (legacy issue #585) ([66ecb23](https://github.com/ChainSafe/lodestar/commit/66ecb2315943f7a0ea2d1a718575be415a4328ae))
* **docs:** readme housekeeping + add contributing doc (legacy issue #560) ([f780208](https://github.com/ChainSafe/lodestar/commit/f7802080467fb2bde6f63a3a1d55d525d775b328))


### Documentation

* add PR title and description guidelines (legacy issue #640) ([33a3f2f](https://github.com/ChainSafe/lodestar/commit/33a3f2fbebd14ecb083f57290721f4992d3fcadd))

## [1.0.0](https://github.com/ChainSafe/lodestar/compare/e2f66c80acbf148cfb507e3d6d8912c1dc2e51b7...a19d7462f339c729ee06ba89b91f29bf6a38047d) (2026-08-19)


### Features

* add `state.getBuildersLength()` binding (legacy issue #472) ([be2b5ab](https://github.com/ChainSafe/lodestar/commit/be2b5ab2a3cfdab76abe90ce1404f51cd1ecfedc))
* **beacon-node:** add block state cache and checkpoint datastore (legacy issue #452) ([2145faa](https://github.com/ChainSafe/lodestar/commit/2145faab40bdb33da418956facbd377572ac9c80))
* bindings to `getExpectedWithdrawals` and native tweaks (legacy issue #350) ([f47bc66](https://github.com/ChainSafe/lodestar/commit/f47bc66eb882a052cfbe0606c11507fae0dadc83))
* **bindings:** add pubkey cache syncPubkeys (legacy issue #537) ([542779f](https://github.com/ChainSafe/lodestar/commit/542779fc84efe7395cbc0c908802dc586337d131))
* **bindings:** aggregate cached public keys by validator index (legacy issue #397) ([2f90603](https://github.com/ChainSafe/lodestar/commit/2f90603c1bd67abeeeae442991906b656ba7718e))
* **bindings:** align `BeaconStateView` with `IBeaconStateView` (legacy issue #347) ([b8ec273](https://github.com/ChainSafe/lodestar/commit/b8ec27350b3ca64e04bb9e332552a9f629f39d8c))
* **bindings:** configurable pubkey cache growth step (legacy issue #481) ([133ef24](https://github.com/ChainSafe/lodestar/commit/133ef248a5e6dec11dac8f3dfd6879920e217834))
* **bindings:** expose more APIs for STF (legacy issue #444) ([7fe2609](https://github.com/ChainSafe/lodestar/commit/7fe260909a0ff75d34176a761029dbb55fa09c48))
* **bls:** add small MSM for npoints &lt; 32 (legacy issue #393) ([b430638](https://github.com/ChainSafe/lodestar/commit/b430638132545c9714c51146c41d3a4b0b3d19ac))
* **blst:** use external buffers for blst operations (legacy issue #358) ([78e4678](https://github.com/ChainSafe/lodestar/commit/78e4678df2429cbd412956a14ebc4778438d3b32))
* **ci:** conditionally publish bindings with tag (legacy issue #355) ([ea77919](https://github.com/ChainSafe/lodestar/commit/ea7791983dbc280e17579b9ca73e4f62c937ae4f))
* **clock:** add clock module for slot/epoch timing (legacy issue #354) ([385b077](https://github.com/ChainSafe/lodestar/commit/385b077bff15198c27bc410bb1c52543a670a48c))
* **fork_choice:** add Prometheus metrics module (legacy issue #309) ([cbc9d8d](https://github.com/ChainSafe/lodestar/commit/cbc9d8d23e9755b9f1533e10194699fd6a5b6862))
* **forkchoice:** implement the forkchoice module (legacy issue #246) ([7c62a9b](https://github.com/ChainSafe/lodestar/commit/7c62a9b3bf1ebf1bb52f3b904f746c9cdab8aec7))
* getSyncCommitteesWitness (legacy issue #367) ([ef77649](https://github.com/ChainSafe/lodestar/commit/ef77649c5620837773ce010b42c07d67c4904a67))
* implement `loadState` API and binding (legacy issue #165) ([f903519](https://github.com/ChainSafe/lodestar/commit/f90351969227e83a2f23b3129ca78dcfab11b890)), closes legacy issue #159
* **metrics:** metrics bindings (legacy issue #455) ([dd41999](https://github.com/ChainSafe/lodestar/commit/dd41999540f280f927c68e488c16540172331b23))
* migrate blst,pubkeys to use zapi js dsl (legacy issue #331) ([fcd26ca](https://github.com/ChainSafe/lodestar/commit/fcd26caf6c36f8aecfea9ed9c7b5a36e27293bcb))
* **pubkeys:** add getPubkeyBytes binding (legacy issue #555) ([4ca51cf](https://github.com/ChainSafe/lodestar/commit/4ca51cf972ab0e1665e014afc7950a2edc85303c))
* publish ARM64 musl bindings (legacy issue #482) ([ac764c9](https://github.com/ChainSafe/lodestar/commit/ac764c92c9fcb326e64c518c21880655f3efc8d9))
* **shuffle:** add swap-or-not shuffling module and binding (legacy issue #559) ([c2db37c](https://github.com/ChainSafe/lodestar/commit/c2db37ce1b405e2d39e6180b3f45a24d7c312ca4))
* split nextValue fn (legacy issue #464) ([b47faeb](https://github.com/ChainSafe/lodestar/commit/b47faeb683e4c5cbffb1292786e6c06111fa3a5d))
* support getLatestWeakSubjectivityCheckpointEpoch (legacy issue #366) ([dcf3883](https://github.com/ChainSafe/lodestar/commit/dcf3883e49bf47f0804fdfb649e328ce98b0f84d))
* update fulu deposit processing (legacy issue #442) ([064335c](https://github.com/ChainSafe/lodestar/commit/064335c0dc51f09c8ed96384f296721f50f14f88))


### Bug Fixes

* avoid set (legacy issue #484) ([2e25d97](https://github.com/ChainSafe/lodestar/commit/2e25d97fadfbf170647c21799550c37502639f1c))
* better generation of rand scalar (legacy issue #388) ([74dce77](https://github.com/ChainSafe/lodestar/commit/74dce77656a74745601c964eeb493e0a8b2a67e1))
* **bindings:** accept `dontTransferCache` in processSlots for backward compatibility (legacy issue #460) ([65df5af](https://github.com/ChainSafe/lodestar/commit/65df5aff04cc557ad0208773d4dbc840a239a236))
* **bindings:** check signature infinity by default (legacy issue #509) ([2f5f281](https://github.com/ChainSafe/lodestar/commit/2f5f281ccc6710630fcf0cb8e23c2eda3629974c))
* **bindings:** clean up failed async BLS work (legacy issue #527) ([1111b00](https://github.com/ChainSafe/lodestar/commit/1111b009b51609a92a925537020deb899fc91463))
* **bindings:** free metrics writer on scrape failure (legacy issue #529) ([4c8d94a](https://github.com/ChainSafe/lodestar/commit/4c8d94a8331065e2c0cc59f39dd433cb39440265))
* **bindings:** harden random aggregate scalars (legacy issue #528) ([8e89a63](https://github.com/ChainSafe/lodestar/commit/8e89a634103e5ff7597904766abb343ece4a4ce4))
* **bindings:** log level for missing fields (legacy issue #435) ([08faf41](https://github.com/ChainSafe/lodestar/commit/08faf41c03ebd54ee5149573f984433d721343d7))
* **bindings:** misordering of print for cpu count (legacy issue #381) ([752a972](https://github.com/ChainSafe/lodestar/commit/752a97294d5c4613edfae75909ff21d21b7cdb48))
* **bindings:** populate epoch participation for test fixtures (legacy issue #436) ([8dbdd2e](https://github.com/ChainSafe/lodestar/commit/8dbdd2ed87c2f58cf1b5415f4e031c4e4da9a451))
* **bindings:** refcount Pool to fix teardown panic (legacy issue #352) ([23b2f68](https://github.com/ChainSafe/lodestar/commit/23b2f68fb6f5f0dd3d91f3f40184fe88e601612f))
* **bindings:** roll back partial N-API initialization (legacy issue #491) ([31c5ebb](https://github.com/ChainSafe/lodestar/commit/31c5ebb5710e0025d64070a258547727baed4d37))
* **bindings:** size BLS thread pool by cgroup-aware CPU count (legacy issue #386) ([3ae9522](https://github.com/ChainSafe/lodestar/commit/3ae95226b31a0094f56b2294c198acd23479c625))
* **bindings:** validate class types before unwrap (legacy issue #514) ([2fd2ad5](https://github.com/ChainSafe/lodestar/commit/2fd2ad57be7a3c5207bb6b953ebe2d6f8a07d605))
* **bindings:** validate secret key hex length (legacy issue #517) ([136e415](https://github.com/ChainSafe/lodestar/commit/136e415d69fe41fffd032a106b1b5b4a16f0a1ed))
* **bls:** align PublicKey.uncompress validation with Signature.uncompress (legacy issue #508) ([5a8dbe9](https://github.com/ChainSafe/lodestar/commit/5a8dbe951ab45f578d8f7ac8d794c9c72022e79f))
* **bls:** bound randomized aggregation inputs (legacy issue #548) ([779d0bf](https://github.com/ChainSafe/lodestar/commit/779d0bf084154698cfeab84c4016785db5cde2f2)), closes legacy issue #542
* **bls:** clean up partial thread pool initialization (legacy issue #490) ([d55e598](https://github.com/ChainSafe/lodestar/commit/d55e598e1269be3de095c86be64ee196891cfbfb))
* **bls:** convert pippenger scratch bytes to element counts (legacy issue #513) ([a12ca92](https://github.com/ChainSafe/lodestar/commit/a12ca929e592257403457e0b71bbe6992a1863b8))
* **bls:** enforce 32-byte signing roots (legacy issue #545) ([72fd308](https://github.com/ChainSafe/lodestar/commit/72fd308f695ff50bcb61c88e1be6265d34bbffe3))
* **bls:** make batch cardinality structural (legacy issue #547) ([a06d8b2](https://github.com/ChainSafe/lodestar/commit/a06d8b28325c2e4e3879b50792fc979efd8dacd3))
* **bls:** preserve aggregate outputs on failure (legacy issue #521) ([e0b6dd1](https://github.com/ChainSafe/lodestar/commit/e0b6dd1f975f46d6f572851084ecb4656c013931))
* **bls:** reject empty keygen salts (legacy issue #524) ([d2a9c86](https://github.com/ChainSafe/lodestar/commit/d2a9c86cab29e1c2654237f08cb576695c3cf6a1))
* **bls:** reject unknown BLST error codes (legacy issue #525) ([9e4a6ad](https://github.com/ChainSafe/lodestar/commit/9e4a6ad4794af7bfdb60c4f7ced7a7f4000d8377))
* **bls:** size pairing buffers for 32-bit targets (legacy issue #531) ([dc64a27](https://github.com/ChainSafe/lodestar/commit/dc64a27e546920ebb34686cdb5fbc8b62dd38a0a))
* **blst:** default signature infinity check to true if not provided (legacy issue #387) ([021cdcb](https://github.com/ChainSafe/lodestar/commit/021cdcb4a37d7c45a0be86d3ba19cad7be600501))
* **build:** remove `zig-out` from `files` (legacy issue #360) ([c52af09](https://github.com/ChainSafe/lodestar/commit/c52af099ca5d8046d61ccef192dc46e3f79d3b07))
* **ci:** fix caching spec test version (legacy issue #439) ([96885a1](https://github.com/ChainSafe/lodestar/commit/96885a101cabbc7b70d58823778db6f3dd57fa42))
* dangling state pointer in loadOtherState (legacy issue #450) ([81cbd5f](https://github.com/ChainSafe/lodestar/commit/81cbd5f221e7b7c5eb20e681190bfd98e04e1f92))
* **epoch_cache:** compute missing `next_proposers` (legacy issue #447) ([0088a29](https://github.com/ChainSafe/lodestar/commit/0088a2988d7712a38d470a617fdaab1ea0ae7736))
* **epoch_cache:** populate decision roots in afterProcessEpoch (legacy issue #453) ([4b70a5e](https://github.com/ChainSafe/lodestar/commit/4b70a5edcd1dd65871567b306e8d0a8d8a25a8d4))
* export asyncAggregateWithRandomness through napi binding (legacy issue #371) ([1d04c2b](https://github.com/ChainSafe/lodestar/commit/1d04c2b00f90d340abc543427c35467b3622826b))
* harden memory safety across PMT, SSZ tree views, and state transition (legacy issue #377) ([d6f5897](https://github.com/ChainSafe/lodestar/commit/d6f5897a065e0fab91915a90567204299936b374))
* improve atomic ordering in ThreadPool and NAPI init (legacy issue #310) ([4b0a1cc](https://github.com/ChainSafe/lodestar/commit/4b0a1cc1b204b777e6df364949cafe093ca144e6))
* interface compatbility with NativeBeaconStateView (legacy issue #445) ([89e13d1](https://github.com/ChainSafe/lodestar/commit/89e13d1847dd54db476ae80764a627649de7bd0e))
* missing deinits in loadOtherState (legacy issue #459) ([094d278](https://github.com/ChainSafe/lodestar/commit/094d27855a549927857da8a996821a4a269b2291))
* missing state commits (legacy issue #454) ([a432b55](https://github.com/ChainSafe/lodestar/commit/a432b55eaef87f3d067d4ccf0de732a726040468))
* no-op when syncPubkeys run on a pk cache with shrinking validator set (legacy issue #432) ([ed05a99](https://github.com/ChainSafe/lodestar/commit/ed05a9979518746466f3c197b828c91cd34edbe5))
* param order in BeaconBlockBody (legacy issue #348) ([d8b9c06](https://github.com/ChainSafe/lodestar/commit/d8b9c06992d479c278d046813e398301c5a67c47))
* pendingConsolidations bindings (legacy issue #449) ([b9c497e](https://github.com/ChainSafe/lodestar/commit/b9c497e8ec058f7ce31f0014c5f2e3383be4c512))
* **pmt,ssz:** harden chunked-leaf and zero-copy tree-view memory safety (legacy issue #400) ([de50c53](https://github.com/ChainSafe/lodestar/commit/de50c538026156ca3ce9a013d69af546582fac3a))
* populate cache balances during rewards/penalties processing (legacy issue #474) ([5bf23dc](https://github.com/ChainSafe/lodestar/commit/5bf23dc4a664d84dcb91d14234128cc89c53b934))
* re-expose sizes (legacy issue #369) ([64b81f3](https://github.com/ChainSafe/lodestar/commit/64b81f34e346dbca9cc05697f0b59977cab2bff4))
* remove `slashValidator` gating on active status (legacy issue #448) ([d319a0d](https://github.com/ChainSafe/lodestar/commit/d319a0d2dbd2fa52ddc75b17eefda71e23c03b2f))
* **ssz:** drop redundant default-init pass in fixed-list decode (legacy issue #468) ([0c757be](https://github.com/ChainSafe/lodestar/commit/0c757be3f4a3d24b92e227660bfd05dca704618b))
* **ssz:** publish child cache entries after lookup (legacy issue #565) ([21e78c9](https://github.com/ChainSafe/lodestar/commit/21e78c985349ef2f9e2af4c8d3d34ba9bf3cfbd7))
* state transition binding exports (legacy issue #456) ([895982c](https://github.com/ChainSafe/lodestar/commit/895982cf1b9002c8e72a8ca83b8daeddcb862a6a))
* **state-transition:** group-check signature sets (legacy issue #515) ([42774e9](https://github.com/ChainSafe/lodestar/commit/42774e9b1cf652203acc46bf10edf21910fcd309)), closes legacy issue #502
* **state-transition:** isolate epoch step cache mutations (legacy issue #535) ([a83741a](https://github.com/ChainSafe/lodestar/commit/a83741afca96590a6639ffa0b0c515f29619086b))
* **state-transition:** repair Pool.init call broken by legacy issue #346×legacy issue #367 merge skew (legacy issue #394) ([b42944f](https://github.com/ChainSafe/lodestar/commit/b42944fb199ff12a29e5debeae5189eadcd09b50))
* various fixes around config (legacy issue #433) ([c4f082c](https://github.com/ChainSafe/lodestar/commit/c4f082c00c30933ec97072bcff9966a1aa62694d))


### Performance Improvements

* **bindings:** drop TS BLS comparison benches and report benchmarks on PRs (legacy issue #552) ([c909c6f](https://github.com/ChainSafe/lodestar/commit/c909c6f7a40a30eb42071e2b58686f800c45c8bd))
* **bls:** add cache-aware signature verifier (legacy issue #562) ([063857e](https://github.com/ChainSafe/lodestar/commit/063857ef108d758f246382afb418fe2c33cc47b6))
* **bls:** bypass worker queue for small batches (legacy issue #553) ([3f8a6df](https://github.com/ChainSafe/lodestar/commit/3f8a6dfb83cd73679f748f0f50504fccfdc37584))
* **epoch:** replace AutoHashMap with array lookup in reward/penalty caches (legacy issue #286) ([e4e181b](https://github.com/ChainSafe/lodestar/commit/e4e181b65bd690a026abe6dffdb121a324a06266)), closes legacy issue #243
* **pmt:** chunked-leaf packing for basic lists and container_struct (legacy issue #346) ([ba156c4](https://github.com/ChainSafe/lodestar/commit/ba156c4385416a0b12aec6ce4ac91144326a762a))


### Code Refactoring

* allocate `AsyncAggRandData` in one obj (legacy issue #384) ([459750f](https://github.com/ChainSafe/lodestar/commit/459750fecfa8288519371080b57fd664d1fad57d))
* **bindings/pubkeys:** simplify allocation strategy for aggregate (legacy issue #518) ([b82750f](https://github.com/ChainSafe/lodestar/commit/b82750f6c3ec3d57ed63fe31c2f968d4527ce0a5))
* **bindings:** rename blst Lifecycle to State (legacy issue #516) ([0a9c179](https://github.com/ChainSafe/lodestar/commit/0a9c179af299a5408d837e0347e43a1e6e1e76ca))
* **bindings:** use zapi js.io() instead of local io module (legacy issue #469) ([2b34cc0](https://github.com/ChainSafe/lodestar/commit/2b34cc02fb1df10af308196c552a4965937e66c4))
* **bindings:** wake only required number of workers (legacy issue #383) ([1db57f1](https://github.com/ChainSafe/lodestar/commit/1db57f1ec426112065aa5d06b4ab64ae2da508ca))
* **bls:** allocations around VMAS (legacy issue #395) ([dfda58c](https://github.com/ChainSafe/lodestar/commit/dfda58c32c2b08b716923cd50acfc0c4978c3fb3))
* **bls:** clean up bls (legacy issue #398) ([e0f3b9b](https://github.com/ChainSafe/lodestar/commit/e0f3b9baa8e43bc9234156e48cac9768b14ff7a3))
* **bls:** remove need for tracking results for verifyMultipleAggregateSignatures (legacy issue #389) ([6fe5c3f](https://github.com/ChainSafe/lodestar/commit/6fe5c3fb4fdc641632cdb671a3c45c934b4dc6a4))
* **bls:** remove single-threaded fallback (legacy issue #390) ([e057713](https://github.com/ChainSafe/lodestar/commit/e0577138e14884134ff29f2ebb80b5232ddf3a4e))
* **clock:** single public Clock; internalize SlotClock (legacy issue #463) ([fbab1fa](https://github.com/ChainSafe/lodestar/commit/fbab1fa1f12cbd670005cec7ee6d780cfa7eb80e))
* make XXXDecisionRoot fns return `js.String` (legacy issue #342) ([aef4420](https://github.com/ChainSafe/lodestar/commit/aef44205b31dd48916c43cc3d47b918434e4901d))
* move shuffle into swap_or_not_shuffle module (legacy issue #558) ([e56efb2](https://github.com/ChainSafe/lodestar/commit/e56efb2ddf0577aefdd2102f06f81416972329ae))
* **pubkeys:** centralize the process-wide cache (legacy issue #522) ([dc9669d](https://github.com/ChainSafe/lodestar/commit/dc9669dbbe131aeee56605e785d46108a87d4e82))


### Miscellaneous Chores

* avoid slow tests in AGENTS.md (legacy issue #546) ([c60f2a9](https://github.com/ChainSafe/lodestar/commit/c60f2a9dae9b131b716e802e22c6d37c850d6dd8))
* bump zapi to include musl build (legacy issue #485) ([0b488cc](https://github.com/ChainSafe/lodestar/commit/0b488cccadbce6d09a31f9a874be868f9ffbe3ec))
* **ci:** pin github actions with sha hashes (legacy issue #507) ([167b8f5](https://github.com/ChainSafe/lodestar/commit/167b8f5cb484c2d3e23d2a75f42c96a92e178bcb))
* deprecate unused blst APIs (legacy issue #575) ([7b547fa](https://github.com/ChainSafe/lodestar/commit/7b547fa29377a8f7f457448418b0c24ce57126af))
* **deps:** bump zapi v2.1.0 -&gt; v2.2.0 (legacy issue #376) ([0c240d8](https://github.com/ChainSafe/lodestar/commit/0c240d864596971c6aa00151ce0efdfe75c41de6))
* **deps:** bump zbuild (legacy issue #403) ([e2545de](https://github.com/ChainSafe/lodestar/commit/e2545de171f74206456a50b983f1153399c00988))
* **deps:** compile blst with ReleaseFast (legacy issue #391) ([753a896](https://github.com/ChainSafe/lodestar/commit/753a896e88e41acb4508a0834ac1408629375377))
* **deps:** update zapi to 3.1.0 (legacy issue #483) ([f3e5827](https://github.com/ChainSafe/lodestar/commit/f3e582759985347440acee620f8535c402b1daee))
* **deps:** use zapi v2.1.0 (legacy issue #372) ([88f403a](https://github.com/ChainSafe/lodestar/commit/88f403aba0e380523b695d169c92fd8e32963c6d))
* disable gemini auto code review (legacy issue #382) ([63e42a4](https://github.com/ChainSafe/lodestar/commit/63e42a4224c09b7c6b241cd802bccbf6b6951a89)), closes legacy issue #380
* **docs:** add comments section in AGENTS.md (legacy issue #566) ([0c09750](https://github.com/ChainSafe/lodestar/commit/0c0975098fd97ba02a447a8cdec736c91a3e806f))
* move state clones out of benchmark run functions (legacy issue #324) ([e4035de](https://github.com/ChainSafe/lodestar/commit/e4035dedcb88d8ea77f1b77db5a661c4f3ffab6d))
* prepare 1.0.0 release (legacy issue #576) ([20b657b](https://github.com/ChainSafe/lodestar/commit/20b657b34ee9f0b643590496e7c212481909d51d))
* release v0.1.2-rc.3 (legacy issue #370) ([e4fc551](https://github.com/ChainSafe/lodestar/commit/e4fc551c42cb9ee1280f9dc1b576e0b4c790ee34))
* **release:** 0.1.2-rc.2 (legacy issue #365) ([7046128](https://github.com/ChainSafe/lodestar/commit/7046128439880284b88b69ca78869fc5c976e977))
* **release:** v0.1.2-rc.10 (legacy issue #477) ([9a4fad5](https://github.com/ChainSafe/lodestar/commit/9a4fad55533aefcaccef67fe45d48a747c6f82a4))
* **release:** v0.1.2-rc.4 (legacy issue #373) ([09468f1](https://github.com/ChainSafe/lodestar/commit/09468f1c652318df06e461fa82f078e9b613c324))
* **release:** v0.1.2-rc.5 (legacy issue #374) ([f344efa](https://github.com/ChainSafe/lodestar/commit/f344efa74df756581f8d1dfea62f1d19ec668fd8))
* **release:** v0.1.2-rc.6 (legacy issue #375) ([bdf5b67](https://github.com/ChainSafe/lodestar/commit/bdf5b67cefd382f0409c1e1e80ca3d9abb7e0e59))
* **release:** v0.1.2-rc.8 (legacy issue #401) ([06f91c2](https://github.com/ChainSafe/lodestar/commit/06f91c26dc7b6b3d00ad35726812f6770787ea07))
* **release:** v0.1.2-rc.9 (legacy issue #404) ([6024800](https://github.com/ChainSafe/lodestar/commit/602480070524c0fe3e6099d7aae94ad5568d2d83))
* remove merge transition code (legacy issue #359) ([09b175d](https://github.com/ChainSafe/lodestar/commit/09b175d3e41ac63cb1c086b66606fc6be20fcaa0))
* remove stale epoch cache TODOs (legacy issue #534) ([27a547a](https://github.com/ChainSafe/lodestar/commit/27a547a8fece842f67e165e2d1ceffe43db3716d))
* rename era shortHistoricalRoot to shortEraRoot (legacy issue #473) ([c75a4d3](https://github.com/ChainSafe/lodestar/commit/c75a4d3837fc7a6e06d1619b888cdc68296435a6))
* **scripts:** build bindings with preset (legacy issue #434) ([a1b5ef7](https://github.com/ChainSafe/lodestar/commit/a1b5ef770534e1446744bb12d4bbc8469aabccc7))
* silence debug log when used in release builds (legacy issue #486) ([c5377d7](https://github.com/ChainSafe/lodestar/commit/c5377d7a1f6d7e97c0cdf78b97219e7484f97613))
* support dev workflow (legacy issue #364) ([fcb9a78](https://github.com/ChainSafe/lodestar/commit/fcb9a78dc10bdbe22b7d9a74e6db5100c1be21ca))
* update gloas types to align with the latest specs (legacy issue #431) ([1f065b5](https://github.com/ChainSafe/lodestar/commit/1f065b5a6db119fe7e61906b6fbf09fcc902b7f9))
* update spec test version to v1.7.0-alpha.11 (legacy issue #451) ([5875660](https://github.com/ChainSafe/lodestar/commit/5875660fa56f41f9c6072e16dfa4f58cabee3fba))
* update spec-test-version: v1.6.0-beta.2 -&gt; v1.7.0-alpha.10 (legacy issue #441) ([f932b1c](https://github.com/ChainSafe/lodestar/commit/f932b1cc777f240fc5cf821c488e9d45c439f660))
* update zapi to 4.0.0 (legacy issue #571) ([de8e3fd](https://github.com/ChainSafe/lodestar/commit/de8e3fd1da17ab9e9feb8a2521c8027f284254a3))


### Documentation

* document security threat model (legacy issue #557) ([e678b87](https://github.com/ChainSafe/lodestar/commit/e678b87c81783f9318dbb692015318ed85f3e6f8))
* more comprehensive AGENTS.md (legacy issue #520) ([c74b386](https://github.com/ChainSafe/lodestar/commit/c74b38612689df56d2e64c4bc0be029be02ed275))
* **pkix:** document load provenance requirement (legacy issue #556) ([37e0aa2](https://github.com/ChainSafe/lodestar/commit/37e0aa2beeadfbeb558a30b15e72aa4e297bad83))

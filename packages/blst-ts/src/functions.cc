#include "addon.h"

namespace
{
    /**
     *
     *
     * Verify
     *
     *
     */
    class AggregateVerifyWorker : public BlstAsyncWorker
    {
    public:
        AggregateVerifyWorker(const Napi::CallbackInfo &info)
            : BlstAsyncWorker(info),
              _invalid_args{false},
              _no_keys{false},
              _no_msgs{false},
              _result{false},
              _ctx{new blst::Pairing{true, _module->_dst}},
              _msgs{_env, _info[0], "msg", "msgs"},
              _public_keys{_env, _info[1]},
              _signature{_env, _info[2]} {}

    protected:
        void Setup() override
        {
            if (_msgs.HasError())
            {
                SetError(_msgs.GetError());
                return;
            }
            if (_public_keys.HasError())
            {
                _invalid_args = true;
                return;
            }
            if (_signature.HasError())
            {
                _invalid_args = true;
                return;
            }
            if (_public_keys.Size() == 0)
            {
                _no_keys = true;
            }
            if (_msgs.Size() == 0)
            {
                _no_msgs = true;
            }
            if (!_no_keys && _msgs.Size() != _public_keys.Size())
            {
                SetError("BLST_VERIFY_FAIL: msgs and publicKeys must be the same length");
                return;
            }
        };

        void Execute() override
        {
            if (_invalid_args ||
                (_no_keys &&
                 _signature._signature->AsJacobian()->is_inf()))
            {
                _result = false;
                return;
            }
            for (size_t i = 0; i < _public_keys.Size(); i++)
            {
                blst::BLST_ERROR err = _ctx->aggregate(
                    _public_keys[i].AsAffine(),
                    _signature.AsAffine(),
                    _msgs[i].Data(),
                    _msgs[i].ByteLength());
                if (err != blst::BLST_ERROR::BLST_SUCCESS)
                {
                    std::ostringstream msg;
                    msg << "BLST_ERROR::" << _module->GetBlstErrorString(err) << ": Invalid verification";
                    SetError(msg.str());
                    return;
                }
            }
            _ctx->commit();
            blst::PT pt{*_signature.AsAffine()};
            _result = _ctx->finalverify(&pt);
        }

        Napi::Value GetReturnValue() override
        {
            return Napi::Boolean::New(_env, _result);
        };

    private:
        bool _invalid_args;
        bool _no_keys;
        bool _no_msgs;
        bool _result;
        std::unique_ptr<blst::Pairing> _ctx;
        Uint8ArrayArgArray _msgs;
        PublicKeyArgArray _public_keys;
        SignatureArg _signature;
    };
    /**
     *
     *
     * SignatureSet and SignatureSetArray
     *
     *
     */
    class SignatureSet : public BlstBase
    {
    public:
        Uint8ArrayArg _msg;
        PublicKeyArg _publicKey;
        SignatureArg _signature;

        SignatureSet(Napi::Env env, const Napi::Value &raw_arg)
            : BlstBase{env},
              _msg{_env},
              _publicKey{_env},
              _signature{_env}
        {
            Napi::HandleScope scope(_env);
            if (raw_arg.IsObject())
            {
                Napi::Object set = raw_arg.As<Napi::Object>();
                if (set.Has("msg") && set.Has("publicKey") && set.Has("signature"))
                {
                    _msg = Uint8ArrayArg{_env, set.Get("msg"), "msg"};
                    if (_msg.HasError())
                    {
                        SetError(_msg.GetError());
                        return;
                    }
                    _publicKey = PublicKeyArg{_env, set.Get("publicKey")};
                    if (_publicKey.HasError())
                    {
                        SetError(_publicKey.GetError());
                        return;
                    }
                    _signature = SignatureArg{_env, set.Get("signature")};
                    if (_signature.HasError())
                    {
                        SetError(_signature.GetError());
                        return;
                    }
                    return;
                }
            }
            SetError("SignatureSet must be an object with msg, publicKey and signature properties");
        }

        // non-copyable. Should only be created directly in
        // SignatureSetArray via copy elision
        SignatureSet(const SignatureSet &source) = delete;
        SignatureSet(SignatureSet &&source) = default;
        SignatureSet &operator=(const SignatureSet &source) = delete;
        SignatureSet &operator=(SignatureSet &&source) = default;
    };

    class SignatureSetArray : public BlstBase
    {
    public:
        std::vector<SignatureSet> _sets;

        SignatureSetArray(Napi::Env env, const Napi::Value &raw_arg)
            : BlstBase{env},
              _sets{}
        {
            if (!raw_arg.IsArray())
            {
                SetError("signatureSets must be of type SignatureSet[]");
                return;
            }
            Napi::Array arr = raw_arg.As<Napi::Array>();
            uint32_t length = arr.Length();
            _sets.reserve(length);
            for (uint32_t i = 0; i < length; i++)
            {
                _sets.push_back({_env, arr[i]});
                if (_sets[i].HasError())
                {
                    SetError(_sets[i].GetError());
                    return;
                }
            }
        }

        // immovable/non-copyable. should only be created directly as class member
        SignatureSetArray(const SignatureSetArray &source) = delete;
        SignatureSetArray(SignatureSetArray &&source) = delete;
        SignatureSetArray &operator=(const SignatureSetArray &source) = delete;
        SignatureSetArray &operator=(SignatureSetArray &&source) = delete;

        SignatureSet &operator[](size_t index) { return _sets[index]; }

        size_t Size() { return _sets.size(); }
    };
    /**
     *
     *
     * VerifyMultipleAggregateSignatures
     *
     *
     */
    class VerifyMultipleAggregateSignaturesWorker : public BlstAsyncWorker
    {
    public:
        VerifyMultipleAggregateSignaturesWorker(
            const Napi::CallbackInfo &info)
            : BlstAsyncWorker(info),
              _result{true},
              _ctx{new blst::Pairing{true, _module->_dst}},
              _sets{_env, _info[0]} {}

    protected:
        void Setup() override
        {
            if (_sets.HasError())
            {
                SetError(_sets.GetError());
            }
        }

        void Execute() override
        {
            if (_sets.Size() == 0)
            {
                _result = false;
                return;
            }
            for (size_t i = 0; i < _sets.Size(); i++)
            {
                blst::byte rand[BLST_TS_RANDOM_BYTES_LENGTH];
                _module->GetRandomBytes(rand, BLST_TS_RANDOM_BYTES_LENGTH);
                blst::BLST_ERROR err = _ctx->mul_n_aggregate(_sets[i]._publicKey.AsAffine(),
                                                             _sets[i]._signature.AsAffine(),
                                                             rand,
                                                             BLST_TS_RANDOM_BYTES_LENGTH,
                                                             _sets[i]._msg.Data(),
                                                             _sets[i]._msg.ByteLength());
                if (err != blst::BLST_ERROR::BLST_SUCCESS)
                {
                    std::ostringstream msg;
                    msg << _module->GetBlstErrorString(err) << ": Invalid aggregation at index " << i;
                    SetError(msg.str());
                    return;
                }
            }
            _ctx->commit();
            _result = _ctx->finalverify();
        }

        Napi::Value GetReturnValue() override
        {
            return Napi::Boolean::New(_env, _result);
        };

    private:
        bool _result;
        std::unique_ptr<blst::Pairing> _ctx;
        SignatureSetArray _sets;
    };
    /**
     *
     *
     * AggregatePublicKeys
     *
     *
     */
    class AggregatePublicKeysWorker : public BlstAsyncWorker
    {
    public:
        AggregatePublicKeysWorker(const Napi::CallbackInfo &info, size_t arg_position)
            : BlstAsyncWorker(info),
              _is_valid{true},
              _result{},
              _public_keys{_env, _info[arg_position]} {}

        void Setup() override
        {
            if (_public_keys.HasError())
            {
                const uint8_t *key_bytes = _public_keys[_public_keys.GetBadIndex()].GetBytes();
                if (
                    key_bytes[0] & 0x40 &&
                    this->IsZeroBytes(key_bytes, 1, _public_keys[_public_keys.GetBadIndex()].GetBytesLength()))
                {
                    _is_valid = false;
                    return;
                }
                SetError(_public_keys.GetError());
            }
        };

        void Execute() override
        {
            if (!_is_valid)
            {
                return;
            }
            if (_public_keys.Size() == 0)
            {
                _is_valid = false;
                return;
            }
            for (size_t i = 0; i < _public_keys.Size(); i++)
            {
                bool is_valid = _public_keys[i].NativeValidate();
                if (!is_valid)
                {
                    _is_valid = false;
                    return;
                }
                try
                {
                    _result.add(*_public_keys[i].AsJacobian());
                }
                catch (const blst::BLST_ERROR &err)
                {
                    std::ostringstream msg;
                    msg << "BLST_ERROR::" << _module->GetBlstErrorString(err) << ": Invalid key at index " << i;
                    SetError(msg.str());
                }
            }
        }

        Napi::Value GetReturnValue() override
        {
            Napi::EscapableHandleScope scope(_env);
            if (!_is_valid)
            {
                return scope.Escape(_env.Null());
            }
            Napi::Object wrapped = _module->_public_key_ctr.New({Napi::External<void *>::New(Env(), nullptr)});
            wrapped.TypeTag(&_module->_public_key_tag);
            PublicKey *pk = PublicKey::Unwrap(wrapped);
            pk->_jacobian.reset(new blst::P1{_result});
            pk->_has_jacobian = true;
            return scope.Escape(wrapped);
        };

    private:
        bool _is_valid;
        blst::P1 _result;
        PublicKeyArgArray _public_keys;
    };

    /**
     *
     *
     * AggregateSignatures
     *
     *
     */
    class AggregateSignaturesWorker : public BlstAsyncWorker
    {
    public:
        AggregateSignaturesWorker(const Napi::CallbackInfo &info, size_t arg_position)
            : BlstAsyncWorker(info),
              _is_valid{true},
              _result{},
              _signatures{_env, _info[arg_position]} {}

    protected:
        void Setup() override
        {
            if (_signatures.HasError())
            {
                SetError(_signatures.GetError());
            }
        };

        void Execute() override
        {
            if (_signatures.Size() == 0)
            {
                _is_valid = false;
                return;
            }
            for (size_t i = 0; i < _signatures.Size(); i++)
            {
                try
                {
                    _result.add(*_signatures[i].AsJacobian());
                }
                catch (const blst::BLST_ERROR &err)
                {
                    std::ostringstream msg;
                    msg << "BLST_ERROR::" << _module->GetBlstErrorString(err) << ": Invalid signature at index " << i;
                    SetError(msg.str());
                }
            }
        }

        Napi::Value GetReturnValue() override
        {
            Napi::EscapableHandleScope scope(_env);
            if (!_is_valid)
            {
                return scope.Escape(_env.Null());
            }
            Napi::Object wrapped = _module->_signature_ctr.New({Napi::External<void *>::New(Env(), nullptr)});
            wrapped.TypeTag(&_module->_signature_tag);
            Signature *sig = Signature::Unwrap(wrapped);
            sig->_jacobian.reset(new blst::P2{_result});
            sig->_has_jacobian = true;
            return scope.Escape(wrapped);
        };

    private:
        bool _is_valid;
        blst::P2 _result;
        SignatureArgArray _signatures;
    };

    /**
     *
     *
     * TestWorker
     *
     *
     */
    class TestWorker : public BlstAsyncWorker
    {
    public:
        enum TestSyncOrAsync
        {
            SYNC = 0,
            ASYNC = 1,
        };
        enum TestPhase
        {
            SETUP = 0,
            EXECUTION = 1,
            RETURN = 2
        };
        enum TestCase
        {
            NORMAL_EXECUTION = -1,
            SET_ERROR = 0,
            THROW_ERROR = 1,
            UINT_8_ARRAY_ARG = 2,
            UINT_8_ARRAY_ARG_ARRAY = 3,
            PUBLIC_KEY_ARG = 4,
            PUBLIC_KEY_ARG_ARRAY = 5,
            SIGNATURE_ARG = 6,
            SIGNATURE_ARG_ARRAY = 7,
            SIGNATURE_SET = 8,
            SIGNATURE_SET_ARRAY = 9
        };

    public:
        TestWorker(const Napi::CallbackInfo &info)
            : BlstAsyncWorker{info},
              _test_phase{TestPhase::SETUP},
              _test_case{0},
              _return_value{} {}

    protected:
        void
        Setup() override
        {
            Napi::Value test_phase_value = _info[1];
            if (!test_phase_value.IsNumber())
            {
                SetError("testPhase must be a TestPhase enum");
                return;
            }
            _test_phase = static_cast<TestPhase>(test_phase_value.As<Napi::Number>().Uint32Value());
            Napi::Value test_case_value = _info[2];
            if (!test_case_value.IsNumber())
            {
                SetError("testCase must be a TestCase enum");
                return;
            }
            _test_case = test_case_value.As<Napi::Number>().Int32Value();
            if (_test_phase == TestPhase::SETUP)
            {
                switch (_test_case)
                {
                case TestCase::SET_ERROR:
                    SetError("setup: TestCase.SET_ERROR");
                    break;
                case TestCase::THROW_ERROR:
                    throw Napi::Error::New(_env, "setup: TestCase.THROW_ERROR");
                    break;
                case TestCase::UINT_8_ARRAY_ARG:
                {
                    Uint8ArrayArg a{_env, _info[3], "TEST"};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::UINT_8_ARRAY_ARG_ARRAY:
                {
                    Uint8ArrayArgArray a{_env, _info[3], "TEST", "TESTS"};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::PUBLIC_KEY_ARG:
                {
                    PublicKeyArg a{_env, _info[3]};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::PUBLIC_KEY_ARG_ARRAY:
                {
                    PublicKeyArgArray a{_env, _info[3]};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::SIGNATURE_ARG:
                {
                    SignatureArg a{_env, _info[3]};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::SIGNATURE_ARG_ARRAY:
                {
                    SignatureArgArray a{_env, _info[3]};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::SIGNATURE_SET:
                {
                    SignatureSet a{_env, _info[3]};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                case TestCase::SIGNATURE_SET_ARRAY:
                {
                    SignatureSetArray a{_env, _info[3]};
                    if (a.HasError())
                    {
                        SetError(a.GetError());
                        return;
                    }
                    break;
                }
                }
            }
        }
        void Execute() override
        {
            if (_test_phase != TestPhase::EXECUTION)
            {
                _return_value.append("VALID_TEST");
                return;
            }

            switch (_test_case)
            {
            case TestCase::SET_ERROR:
                SetError("execution: TestCase.SET_ERROR");
                break;
            case TestCase::THROW_ERROR:
                throw std::exception();
                break;
            case -1:
            default:
                _return_value.append("VALID_TEST");
            }
        }
        Napi::Value GetReturnValue() override
        {
            if (_test_phase != TestPhase::RETURN)
            {
                return Napi::String::New(_env, _return_value);
            }
            switch (_test_case)
            {
            case TestCase::SET_ERROR:
                SetError("return: TestCase.SET_ERROR");
                break;
            case TestCase::THROW_ERROR:
                throw Napi::Error::New(_env, "return: TestCase.THROW_ERROR");
                break;
            default:
                SetError("return: unknown test case");
            }
            return _env.Undefined();
        }

    private:
        TestPhase _test_phase;
        int32_t _test_case;
        std::string _return_value;
    };

    Napi::Value RunTest(const Napi::CallbackInfo &info)
    {
        if (!info[0].IsNumber())
        {
            throw Napi::TypeError::New(info.Env(), "First argument must be enum TestSyncOrAsync");
        }
        int32_t sync_or_async = info[0].ToNumber().Int32Value();
        if (sync_or_async == 0)
        {
            TestWorker worker{info};
            return worker.RunSync();
        }
        TestWorker *worker = new TestWorker{info};
        return worker->Run();
    }
    Napi::Value AggregatePublicKeys(const Napi::CallbackInfo &info)
    {
        AggregatePublicKeysWorker *worker = new AggregatePublicKeysWorker{info, 0};
        return worker->Run();
    };
    Napi::Value AggregatePublicKeysSync(const Napi::CallbackInfo &info)
    {
        AggregatePublicKeysWorker worker{info, 0};
        return worker.RunSync();
    };
    Napi::Value AggregateSignatures(const Napi::CallbackInfo &info)
    {
        Napi::EscapableHandleScope scope(info.Env());
        AggregateSignaturesWorker *worker = new AggregateSignaturesWorker{info, 0};
        return scope.Escape(worker->Run());
    };
    Napi::Value AggregateSignaturesSync(const Napi::CallbackInfo &info)
    {
        Napi::EscapableHandleScope scope(info.Env());
        AggregateSignaturesWorker worker{info, 0};
        return scope.Escape(worker.RunSync());
    };
    Napi::Value AggregateVerify(const Napi::CallbackInfo &info)
    {
        AggregateVerifyWorker *worker = new AggregateVerifyWorker{info};
        return worker->Run();
    };
    Napi::Value AggregateVerifySync(const Napi::CallbackInfo &info)
    {
        AggregateVerifyWorker worker{info};
        return worker.RunSync();
    };
    Napi::Value VerifyMultipleAggregateSignatures(const Napi::CallbackInfo &info)
    {
        VerifyMultipleAggregateSignaturesWorker *worker = new VerifyMultipleAggregateSignaturesWorker{info};
        return worker->Run();
    };
    Napi::Value VerifyMultipleAggregateSignaturesSync(const Napi::CallbackInfo &info)
    {
        VerifyMultipleAggregateSignaturesWorker worker{info};
        return worker.RunSync();
    };
} // namespace (anonymous)

namespace Functions
{
    void Init(const Napi::Env &env, Napi::Object &exports)
    {
        exports.Set(Napi::String::New(env, "runTest"), Napi::Function::New(env, RunTest));
        exports.Set(Napi::String::New(env, "aggregatePublicKeys"), Napi::Function::New(env, AggregatePublicKeys));
        exports.Set(Napi::String::New(env, "aggregatePublicKeysSync"), Napi::Function::New(env, AggregatePublicKeysSync));
        exports.Set(Napi::String::New(env, "aggregateSignatures"), Napi::Function::New(env, AggregateSignatures));
        exports.Set(Napi::String::New(env, "aggregateSignaturesSync"), Napi::Function::New(env, AggregateSignaturesSync));
        exports.Set(Napi::String::New(env, "aggregateVerify"), Napi::Function::New(env, AggregateVerify));
        exports.Set(Napi::String::New(env, "aggregateVerifySync"), Napi::Function::New(env, AggregateVerifySync));
        exports.Set(Napi::String::New(env, "verifyMultipleAggregateSignatures"), Napi::Function::New(env, VerifyMultipleAggregateSignatures));
        exports.Set(Napi::String::New(env, "verifyMultipleAggregateSignaturesSync"), Napi::Function::New(env, VerifyMultipleAggregateSignaturesSync));
    };
}
#include "functions.h"

namespace {
Napi::Value AggregatePublicKeys(const Napi::CallbackInfo &info) {
    BLST_TS_FUNCTION_PREAMBLE
    if (!info[0].IsArray()) {
        Napi::TypeError::New(env, "publicKeys must be of type PublicKeyArg[]")
            .ThrowAsJavaScriptException();
        return scope.Escape(env.Undefined());
    }
    Napi::Array arr = info[0].As<Napi::Array>();
    uint32_t length = arr.Length();
    if (length == 0) {
        Napi::TypeError::New(env, "PublicKeyArg[] must have length > 0")
            .ThrowAsJavaScriptException();
        return scope.Escape(env.Undefined());
    }

    BLST_TS_CREATE_UNWRAPPED_OBJECT(public_key, PublicKey, result)
    result->_has_jacobian = true;
    result->_jacobian.reset(new blst::P1);

    for (uint32_t i = 0; i < length; i++) {
        Napi::Value val = arr[i];
        PointerGroup<blst::P1> ptr_group;
        try {
            if (unwrap_point_arg(
                    ptr_group,
                    env,
                    module,
                    val,
                    "PublicKeyArg",
                    CoordType::Jacobian)) {
                return scope.Escape(env.Undefined());
            }
            // TODO: Do we still need to check for 0x40 key?
            // if (key_bytes[0] & 0x40 &&
            //     this->IsZeroBytes(
            //         key_bytes,
            //         1,
            //         _public_keys[_public_keys.GetBadIndex()]
            //             .GetBytesLength())) {
            //     _is_valid = false;
            //     return;
            // }
            result->_jacobian->add(*ptr_group.raw_pointer);
        } catch (const blst::BLST_ERROR &err) {
            std::ostringstream msg;
            msg << "BLST_ERROR::" << module->GetBlstErrorString(err)
                << ": Invalid key at index " << i;
            Napi::Error::New(env, msg.str()).ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    return scope.Escape(wrapped);
}

Napi::Value AggregateSignatures(const Napi::CallbackInfo &info) {
    BLST_TS_FUNCTION_PREAMBLE
    if (!info[0].IsArray()) {
        Napi::TypeError::New(env, "signatures must be of type SignatureArg[]")
            .ThrowAsJavaScriptException();
        return scope.Escape(env.Undefined());
    }
    Napi::Array arr = info[0].As<Napi::Array>();
    uint32_t length = arr.Length();
    if (length == 0) {
        Napi::TypeError::New(env, "SignatureArg[] must have length > 0")
            .ThrowAsJavaScriptException();
        return scope.Escape(env.Undefined());
    }

    BLST_TS_CREATE_UNWRAPPED_OBJECT(signature, Signature, result)
    result->_has_jacobian = true;
    result->_jacobian.reset(new blst::P2);

    for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value val = arr[i];
        PointerGroup<blst::P2> ptr_group;
        try {
            if (unwrap_point_arg(
                    ptr_group,
                    env,
                    module,
                    val,
                    "SignatureArg",
                    CoordType::Jacobian)) {
                return scope.Escape(env.Undefined());
            }
            result->_jacobian->add(*ptr_group.raw_pointer);
        } catch (const blst::BLST_ERROR &err) {
            std::ostringstream msg;
            msg << "BLST_ERROR::" << module->GetBlstErrorString(err)
                << " - Invalid signature at index " << i;
            Napi::Error::New(env, msg.str()).ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    return scope.Escape(wrapped);
}

Napi::Value AggregateVerify(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    try {
        BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();

        if (!info[0].IsArray()) {
            Napi::TypeError::New(env, "msgs must be of type BlstBuffer[]")
                .ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }
        Napi::Array msgs_array = info[0].As<Napi::Array>();
        uint32_t msgs_array_length = msgs_array.Length();

        if (!info[1].IsArray()) {
            Napi::TypeError::New(
                env, "publicKeys must be of type PublicKeyArg[]")
                .ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }
        Napi::Array pk_array = info[1].As<Napi::Array>();
        uint32_t pk_array_length = pk_array.Length();

        PointerGroup<blst::P2_Affine> sig_ptr_group;
        if (unwrap_point_arg(
                sig_ptr_group,
                env,
                module,
                info[2],
                "SignatureArg",
                CoordType::Affine)) {
            return scope.Escape(env.Undefined());
        }

        if (pk_array_length == 0) {
            if (sig_ptr_group.raw_pointer->is_inf()) {
                return scope.Escape(Napi::Boolean::New(env, false));
            }
            Napi::TypeError::New(env, "publicKeys must have length > 0")
                .ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }
        if (msgs_array_length == 0) {
            Napi::TypeError::New(env, "msgs must have length > 0")
                .ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }
        if (msgs_array_length != pk_array_length) {
            Napi::TypeError::New(
                env, "msgs and publicKeys must be the same length")
                .ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }

        std::unique_ptr<blst::Pairing> ctx{
            new blst::Pairing(true, module->_dst)};

        for (uint32_t i = 0; i < pk_array_length; i++) {
            Napi::Value msg_value = msgs_array[i];
            BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg", scope.Escape(env.Undefined()))
            PointerGroup<blst::P1_Affine> pk_ptr_group;
            if (unwrap_point_arg(
                    pk_ptr_group,
                    env,
                    module,
                    pk_array[i],
                    "PublicKeyArg",
                    CoordType::Affine)) {
                return scope.Escape(env.Undefined());
            }

            blst::BLST_ERROR err = ctx->aggregate(
                pk_ptr_group.raw_pointer,
                sig_ptr_group.raw_pointer,
                msg.Data(),
                msg.ByteLength());
            if (err != blst::BLST_ERROR::BLST_SUCCESS) {
                std::ostringstream msg;
                msg << "BLST_ERROR::" << module->GetBlstErrorString(err)
                    << ": Invalid verification aggregate at index " << i;
                Napi::Error::New(env, msg.str()).ThrowAsJavaScriptException();
                return scope.Escape(env.Undefined());
            }
        }

        ctx->commit();
        blst::PT pt{*sig_ptr_group.raw_pointer};
        return Napi::Boolean::New(env, ctx->finalverify(&pt));
    } catch (...) {
        return Napi::Boolean::New(env, false);
    }
}

Napi::Value VerifyMultipleAggregateSignatures(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    Napi::EscapableHandleScope scope(env);
    try {
        BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();

        if (!info[0].IsArray()) {
            Napi::TypeError::New(
                env, "signatureSets must be of type SignatureSet[]")
                .ThrowAsJavaScriptException();
            return scope.Escape(env.Undefined());
        }
        Napi::Array sets_array = info[0].As<Napi::Array>();
        uint32_t sets_array_length = sets_array.Length();
        std::unique_ptr<blst::Pairing> ctx{
            new blst::Pairing(true, module->_dst)};

        for (uint32_t i = 0; i < sets_array_length; i++) {
            blst::byte rand[BLST_TS_RANDOM_BYTES_LENGTH];
            module->GetRandomBytes(rand, BLST_TS_RANDOM_BYTES_LENGTH);

            Napi::Value set_value = sets_array[i];
            if (!set_value.IsObject()) {
                Napi::TypeError::New(env, "signatureSet must be an object")
                    .ThrowAsJavaScriptException();
                return scope.Escape(env.Undefined());
            }
            Napi::Object set = set_value.As<Napi::Object>();

            Napi::Value msg_value = set.Get("msg");
            BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg", scope.Escape(env.Undefined()))

            PointerGroup<blst::P1_Affine> pk_ptr_group;
            if (unwrap_point_arg(
                    pk_ptr_group,
                    env,
                    module,
                    set.Get("publicKey"),
                    "PublicKeyArg",
                    CoordType::Affine)) {
                return scope.Escape(env.Undefined());
            }

            PointerGroup<blst::P2_Affine> sig_ptr_group;
            if (unwrap_point_arg(
                    sig_ptr_group,
                    env,
                    module,
                    set.Get("signature"),
                    "SignatureArg",
                    CoordType::Affine)) {
                return scope.Escape(env.Undefined());
            }

            blst::BLST_ERROR err = ctx->mul_n_aggregate(
                pk_ptr_group.raw_pointer,
                sig_ptr_group.raw_pointer,
                rand,
                BLST_TS_RANDOM_BYTES_LENGTH,
                msg.Data(),
                msg.ByteLength());
            if (err != blst::BLST_ERROR::BLST_SUCCESS) {
                std::ostringstream msg;
                msg << module->GetBlstErrorString(err)
                    << ": Invalid batch aggregation at index " << i;
                Napi::Error::New(env, msg.str()).ThrowAsJavaScriptException();
                return scope.Escape(env.Undefined());
            }
        }
        ctx->commit();
        return Napi::Boolean::New(env, ctx->finalverify());
    } catch (...) {
        return Napi::Boolean::New(env, false);
    }
}

typedef struct {
    PointerGroup<blst::P1_Affine> pk_ptr_group;
    PointerGroup<blst::P2_Affine> sig_ptr_group;
    uint8_t *msg;
    size_t msg_len;
} SignatureSet;

class VerifyMultipleAggregateSignaturesWorker : public Napi::AsyncWorker {
   public:
    VerifyMultipleAggregateSignaturesWorker(const Napi::CallbackInfo &info)
        : Napi::
              AsyncWorker{info.Env(), "VerifyMultipleAggregateSignaturesWorker"},
          m_deferred{Env()},
          m_has_error{false},
          m_module{Env().GetInstanceData<BlstTsAddon>()},
          m_ctx{new blst::Pairing(true, m_module->_dst)},
          m_sets{},
          m_result{false} {
        Napi::Env env = Env();
        if (!info[0].IsArray()) {
            Napi::Error::New(
                env, "signatureSets must be of type SignatureSet[]")
                .ThrowAsJavaScriptException();
            m_has_error = true;
            return;
        }
        Napi::Array sets_array = info[0].As<Napi::Array>();
        uint32_t sets_array_length = sets_array.Length();
        m_sets.reserve(sets_array_length);

        try {
            for (uint32_t i = 0; i < sets_array_length; i++) {
                Napi::Value set_value = sets_array[i];
                if (!set_value.IsObject()) {
                    Napi::Error::New(env, "signatureSet must be an object")
                        .ThrowAsJavaScriptException();
                    m_has_error = true;
                    return;
                }
                Napi::Object set = set_value.As<Napi::Object>();

                Napi::Value msg_value = set.Get("msg");
                BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg", )

                m_sets.push_back(
                    {PointerGroup<blst::P1_Affine>(),
                     PointerGroup<blst::P2_Affine>(),
                     msg.Data(),
                     msg.ByteLength()});

                if (unwrap_point_arg(
                        m_sets[i].pk_ptr_group,
                        env,
                        m_module,
                        set.Get("publicKey"),
                        "PublicKeyArg",
                        CoordType::Affine)) {
                    m_has_error = true;
                    return;
                }

                if (unwrap_point_arg(
                        m_sets[i].sig_ptr_group,
                        env,
                        m_module,
                        set.Get("signature"),
                        "SignatureArg",
                        CoordType::Affine)) {
                    m_has_error = true;
                    return;
                }
            }
        } catch (const blst::BLST_ERROR &err) {
            Napi::Error::New(env, m_module->GetBlstErrorString(err))
                .ThrowAsJavaScriptException();
            m_has_error = true;
        }
    }

    /**
     * GetPromise associated with _deferred for return to JS
     */
    Napi::Promise GetPromise() { return m_deferred.Promise(); }

   protected:
    void Execute() {
        for (uint32_t i = 0; i < m_sets.size(); i++) {
            blst::byte rand[BLST_TS_RANDOM_BYTES_LENGTH];
            m_module->GetRandomBytes(rand, BLST_TS_RANDOM_BYTES_LENGTH);
            blst::BLST_ERROR err = m_ctx->mul_n_aggregate(
                m_sets[i].pk_ptr_group.raw_pointer,
                m_sets[i].sig_ptr_group.raw_pointer,
                rand,
                BLST_TS_RANDOM_BYTES_LENGTH,
                m_sets[i].msg,
                m_sets[i].msg_len);
            if (err != blst::BLST_ERROR::BLST_SUCCESS) {
                std::ostringstream msg;
                msg << m_module->GetBlstErrorString(err)
                    << ": Invalid batch aggregation at index " << i;
                SetError(msg.str());
                return;
            }
        }
        m_ctx->commit();
        m_result = m_ctx->finalverify();
    }
    void OnOK() { m_deferred.Resolve(Napi::Boolean::New(Env(), m_result)); }
    void OnError(const Napi::Error &err) { m_deferred.Reject(err.Value()); }

   public:
    Napi::Promise::Deferred m_deferred;
    bool m_has_error;

   private:
    BlstTsAddon *m_module;
    std::unique_ptr<blst::Pairing> m_ctx;
    std::vector<SignatureSet> m_sets;
    bool m_result;
};

Napi::Value AsyncVerifyMultipleAggregateSignatures(
    const Napi::CallbackInfo &info) {
    VerifyMultipleAggregateSignaturesWorker *worker =
        new VerifyMultipleAggregateSignaturesWorker(info);
    if (worker->m_has_error) {
        return info.Env().Undefined();
    }
    worker->Queue();
    return worker->GetPromise();
}

typedef struct {
    PointerGroup<blst::P1_Affine> pk_ptr_group;
    uint8_t *msg;
    size_t msg_len;
} AggregateVerifySet;

class AggregateVerifyWorker : public Napi::AsyncWorker {
   public:
    AggregateVerifyWorker(const Napi::CallbackInfo &info)
        : Napi::AsyncWorker{info.Env(), "AggregateVerifyWorker"},
          m_deferred{Env()},
          m_has_error{false},
          m_module{Env().GetInstanceData<BlstTsAddon>()},
          m_ctx{new blst::Pairing(true, m_module->_dst)},
          m_sig_ptr_group(),
          m_sets{},
          m_is_invalid{false},
          m_result{false} {
        Napi::Env env = Env();
        try {
            if (!info[0].IsArray()) {
                Napi::TypeError::New(env, "msgs must be of type BlstBuffer[]")
                    .ThrowAsJavaScriptException();
                m_has_error = true;
                return;
            }
            Napi::Array msgs_array = info[0].As<Napi::Array>();
            uint32_t msgs_array_length = msgs_array.Length();

            if (!info[1].IsArray()) {
                Napi::TypeError::New(
                    env, "publicKeys must be of type PublicKeyArg[]")
                    .ThrowAsJavaScriptException();
                m_has_error = true;
                return;
            }
            Napi::Array pk_array = info[1].As<Napi::Array>();
            uint32_t pk_array_length = pk_array.Length();

            if (unwrap_point_arg(
                    m_sig_ptr_group,
                    env,
                    m_module,
                    info[2],
                    "SignatureArg",
                    CoordType::Affine)) {
                m_has_error = true;
                return;
            }

            if (pk_array_length == 0) {
                if (m_sig_ptr_group.raw_pointer->is_inf()) {
                    m_is_invalid = true;
                    return;
                }
                Napi::TypeError::New(env, "publicKeys must have length > 0")
                    .ThrowAsJavaScriptException();
                m_has_error = true;
                return;
            }
            if (msgs_array_length == 0) {
                Napi::TypeError::New(env, "msgs must have length > 0")
                    .ThrowAsJavaScriptException();
                m_has_error = true;
                return;
            }
            if (msgs_array_length != pk_array_length) {
                Napi::TypeError::New(
                    env, "msgs and publicKeys must be the same length")
                    .ThrowAsJavaScriptException();
                m_has_error = true;
                return;
            }

            m_sets.reserve(pk_array_length);
            for (uint32_t i = 0; i < pk_array_length; i++) {
                m_sets.push_back({PointerGroup<blst::P1_Affine>(), nullptr, 0});

                Napi::Value msg_value = msgs_array[i];
                BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg", )
                m_sets[i].msg = msg.Data();
                m_sets[i].msg_len = msg.ByteLength();

                if (unwrap_point_arg(
                        m_sets[i].pk_ptr_group,
                        env,
                        m_module,
                        pk_array[i],
                        "PublicKeyArg",
                        CoordType::Affine)) {
                    m_has_error = true;
                    return;
                }
            }
        } catch (...) {
            m_is_invalid = true;
        }
    }

    /**
     * GetPromise associated with _deferred for return to JS
     */
    Napi::Promise GetPromise() { return m_deferred.Promise(); }

   protected:
    void Execute() {
        if (m_is_invalid) {
            return;
        }
        for (uint32_t i = 0; i < m_sets.size(); i++) {
            blst::BLST_ERROR err = m_ctx->aggregate(
                m_sets[i].pk_ptr_group.raw_pointer,
                m_sig_ptr_group.raw_pointer,
                m_sets[i].msg,
                m_sets[i].msg_len);
            if (err != blst::BLST_ERROR::BLST_SUCCESS) {
                std::ostringstream msg;
                msg << "BLST_ERROR::" << m_module->GetBlstErrorString(err)
                    << ": Invalid verification aggregate at index " << i;
                SetError(msg.str());
                return;
            }
        }
        m_ctx->commit();
        blst::PT pt{*m_sig_ptr_group.raw_pointer};
        m_result = m_ctx->finalverify(&pt);
    }
    void OnOK() { m_deferred.Resolve(Napi::Boolean::New(Env(), m_result)); }
    void OnError(const Napi::Error &err) { m_deferred.Reject(err.Value()); }

   public:
    Napi::Promise::Deferred m_deferred;
    bool m_has_error;

   private:
    BlstTsAddon *m_module;
    std::unique_ptr<blst::Pairing> m_ctx;
    PointerGroup<blst::P2_Affine> m_sig_ptr_group;
    std::vector<AggregateVerifySet> m_sets;
    bool m_is_invalid;
    bool m_result;
};

Napi::Value AsyncAggregateVerify(const Napi::CallbackInfo &info) {
    AggregateVerifyWorker *worker = new AggregateVerifyWorker(info);
    if (worker->m_has_error) {
        return info.Env().Undefined();
    }
    worker->Queue();
    return worker->GetPromise();
}
}  // anonymous namespace

namespace Functions {
void Init(const Napi::Env &env, Napi::Object &exports) {
    exports.Set(
        Napi::String::New(env, "aggregatePublicKeys"),
        Napi::Function::New(env, AggregatePublicKeys));
    exports.Set(
        Napi::String::New(env, "aggregateSignatures"),
        Napi::Function::New(env, AggregateSignatures));
    exports.Set(
        Napi::String::New(env, "aggregateVerify"),
        Napi::Function::New(env, AggregateVerify));
    exports.Set(
        Napi::String::New(env, "asyncAggregateVerify"),
        Napi::Function::New(env, AsyncAggregateVerify));
    exports.Set(
        Napi::String::New(env, "verifyMultipleAggregateSignatures"),
        Napi::Function::New(env, VerifyMultipleAggregateSignatures));
    exports.Set(
        Napi::String::New(env, "asyncVerifyMultipleAggregateSignatures"),
        Napi::Function::New(env, AsyncVerifyMultipleAggregateSignatures));
}
}  // namespace Functions
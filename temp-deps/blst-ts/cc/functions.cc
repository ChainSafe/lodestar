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

    BLST_TS_CREAT_UNWRAPPED_OBJECT(public_key, PublicKey, result)
    result->_has_jacobian = true;
    result->_jacobian.reset(new blst::P1);

    for (uint32_t i = 0; i < length; i++) {
        Napi::Value val = arr[i];
        std::unique_ptr<blst::P1> p_pk{nullptr};
        blst::P1 *pk = nullptr;
        try {
            BLST_TS_UNWRAP_POINT_ARG(
                val,
                p_pk,
                pk,
                public_key,
                PublicKey,
                PUBLIC_KEY,
                "PublicKey",
                blst::P1,
                1,
                CoordType::Jacobian,
                _jacobian)
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
            result->_jacobian->add(*pk);
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

    BLST_TS_CREAT_UNWRAPPED_OBJECT(signature, Signature, result)
    result->_has_jacobian = true;
    result->_jacobian.reset(new blst::P2);

    for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value val = arr[i];
        std::unique_ptr<blst::P2> p_sig{nullptr};
        blst::P2 *sig = nullptr;
        try {
            BLST_TS_UNWRAP_POINT_ARG(
                val,
                p_sig,
                sig,
                signature,
                Signature,
                SIGNATURE,
                "Signature",
                blst::P2,
                2,
                CoordType::Jacobian,
                _jacobian)
            result->_jacobian->add(*sig);
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

        blst::P2_Affine *sig;
        std::unique_ptr<blst::P2_Affine> p_sig{nullptr};
        BLST_TS_UNWRAP_POINT_ARG(
            info[2],
            p_sig,
            sig,
            signature,
            Signature,
            SIGNATURE,
            "Signature",
            blst::P2_Affine,
            2,
            CoordType::Affine,
            _affine)

        if (pk_array_length == 0) {
            if (sig->is_inf()) {
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
            BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg")
            blst::P1_Affine *pk;
            std::unique_ptr<blst::P1_Affine> p_pk{nullptr};
            BLST_TS_UNWRAP_POINT_ARG(
                static_cast<Napi::Value>(pk_array[i]),
                p_pk,
                pk,
                public_key,
                PublicKey,
                PUBLIC_KEY,
                "PublicKey",
                blst::P1_Affine,
                1,
                CoordType::Affine,
                _affine)

            blst::BLST_ERROR err =
                ctx->aggregate(pk, sig, msg.Data(), msg.ByteLength());
            if (err != blst::BLST_ERROR::BLST_SUCCESS) {
                std::ostringstream msg;
                msg << "BLST_ERROR::" << module->GetBlstErrorString(err)
                    << ": Invalid verification aggregate at index " << i;
                Napi::Error::New(env, msg.str()).ThrowAsJavaScriptException();
                return scope.Escape(env.Undefined());
            }
        }

        ctx->commit();
        blst::PT pt{*sig};
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
            BLST_TS_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg")

            blst::P1_Affine *pk;
            std::unique_ptr<blst::P1_Affine> p_pk{nullptr};
            BLST_TS_UNWRAP_POINT_ARG(
                static_cast<Napi::Value>(set.Get("publicKey")),
                p_pk,
                pk,
                public_key,
                PublicKey,
                PUBLIC_KEY,
                "PublicKey",
                blst::P1_Affine,
                1,
                CoordType::Affine,
                _affine)

            blst::P2_Affine *sig;
            std::unique_ptr<blst::P2_Affine> p_sig{nullptr};
            BLST_TS_UNWRAP_POINT_ARG(
                static_cast<Napi::Value>(set.Get("signature")),
                p_sig,
                sig,
                signature,
                Signature,
                SIGNATURE,
                "Signature",
                blst::P2_Affine,
                2,
                CoordType::Affine,
                _affine)

            blst::BLST_ERROR err = ctx->mul_n_aggregate(
                pk,
                sig,
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
    blst::P1_Affine *pk;
    std::unique_ptr<blst::P1_Affine> uptr_pk;
    blst::P2_Affine *sig;
    std::unique_ptr<blst::P2_Affine> uptr_sig;
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
                BLST_TS_ASYNC_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg")

                m_sets.push_back(
                    {nullptr,
                     std::unique_ptr<blst::P1_Affine>(nullptr),
                     nullptr,
                     std::unique_ptr<blst::P2_Affine>(nullptr),
                     msg.Data(),
                     msg.ByteLength()});

                BLST_TS_ASYNC_UNWRAP_POINT_ARG(
                    static_cast<Napi::Value>(set.Get("publicKey")),
                    m_sets[i].uptr_pk,
                    m_sets[i].pk,
                    public_key,
                    PublicKey,
                    PUBLIC_KEY,
                    "PublicKey",
                    blst::P1_Affine,
                    1,
                    CoordType::Affine,
                    _affine)

                BLST_TS_ASYNC_UNWRAP_POINT_ARG(
                    static_cast<Napi::Value>(set.Get("signature")),
                    m_sets[i].uptr_sig,
                    m_sets[i].sig,
                    signature,
                    Signature,
                    SIGNATURE,
                    "Signature",
                    blst::P2_Affine,
                    2,
                    CoordType::Affine,
                    _affine)
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
                m_sets[i].pk,
                m_sets[i].sig,
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
    blst::P2_Affine *sig;
    std::unique_ptr<blst::P2_Affine> uptr_sig;
} AggregateVerifySignature;

typedef struct {
    blst::P1_Affine *pk;
    std::unique_ptr<blst::P1_Affine> uptr_pk;
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
          m_sig{nullptr, std::unique_ptr<blst::P2_Affine>(nullptr)},
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

            BLST_TS_ASYNC_UNWRAP_POINT_ARG(
                info[2],
                m_sig.uptr_sig,
                m_sig.sig,
                signature,
                Signature,
                SIGNATURE,
                "Signature",
                blst::P2_Affine,
                2,
                CoordType::Affine,
                _affine)

            if (pk_array_length == 0) {
                if (m_sig.sig->is_inf()) {
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
                m_sets.push_back(
                    {nullptr,
                     std::unique_ptr<blst::P1_Affine>(nullptr),
                     nullptr,
                     0});

                Napi::Value msg_value = msgs_array[i];
                BLST_TS_ASYNC_UNWRAP_UINT_8_ARRAY(msg_value, msg, "msg")
                m_sets[i].msg = msg.Data();
                m_sets[i].msg_len = msg.ByteLength();

                BLST_TS_ASYNC_UNWRAP_POINT_ARG(
                    static_cast<Napi::Value>(pk_array[i]),
                    m_sets[i].uptr_pk,
                    m_sets[i].pk,
                    public_key,
                    PublicKey,
                    PUBLIC_KEY,
                    "PublicKey",
                    blst::P1_Affine,
                    1,
                    CoordType::Affine,
                    _affine)
            }
        } catch (const blst::BLST_ERROR &err) {
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
                m_sets[i].pk, m_sig.sig, m_sets[i].msg, m_sets[i].msg_len);
            if (err != blst::BLST_ERROR::BLST_SUCCESS) {
                std::ostringstream msg;
                msg << "BLST_ERROR::" << m_module->GetBlstErrorString(err)
                    << ": Invalid verification aggregate at index " << i;
                SetError(msg.str());
                return;
            }
        }
        m_ctx->commit();
        blst::PT pt{*m_sig.sig};
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
    AggregateVerifySignature m_sig;
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
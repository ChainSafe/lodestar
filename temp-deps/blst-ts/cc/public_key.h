#ifndef BLST_TS_PUBLIC_KEY_H__
#define BLST_TS_PUBLIC_KEY_H__

#include <memory>
#include "napi.h"
#include "blst.hpp"
#include "addon.h"

class PublicKey : public BlstBase, public Napi::ObjectWrap<PublicKey>
{
public:
    bool _is_zero_key;
    bool _has_jacobian;
    bool _has_affine;
    std::unique_ptr<blst::P1> _jacobian;
    std::unique_ptr<blst::P1_Affine> _affine;

    static void Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module);
    static Napi::Value Deserialize(const Napi::CallbackInfo &info);
    PublicKey(const Napi::CallbackInfo &info);
    Napi::Value Serialize(const Napi::CallbackInfo &info);
    Napi::Value KeyValidate(const Napi::CallbackInfo &info);
    Napi::Value KeyValidateSync(const Napi::CallbackInfo &info);

    const blst::P1 *AsJacobian();
    const blst::P1_Affine *AsAffine();
    bool NativeValidate();
};

class PublicKeyArg : public BlstBase
{
public:
    PublicKeyArg(Napi::Env env);
    PublicKeyArg(Napi::Env env, Napi::Value raw_arg);
    PublicKeyArg(const PublicKeyArg &source) = delete;
    PublicKeyArg(PublicKeyArg &&source) = default;

    PublicKeyArg &operator=(const PublicKeyArg &source) = delete;
    PublicKeyArg &operator=(PublicKeyArg &&source) = default;

    const blst::P1 *AsJacobian();
    const blst::P1_Affine *AsAffine();
    bool NativeValidate() { return _public_key->NativeValidate(); }
    const uint8_t *GetBytes() { return _bytes.Data(); }
    size_t GetBytesLength() { return _bytes.ByteLength(); }

private:
    PublicKey *_public_key;
    Uint8ArrayArg _bytes;
    Napi::Reference<Napi::Object> _ref;
};

class PublicKeyArgArray : public BlstBase
{
public:
    PublicKeyArgArray(Napi::Env env, Napi::Value raw_arg);
    PublicKeyArgArray(const PublicKeyArgArray &source) = delete;
    PublicKeyArgArray(PublicKeyArgArray &&source) = default;

    PublicKeyArgArray &operator=(const PublicKeyArgArray &source) = delete;
    PublicKeyArgArray &operator=(PublicKeyArgArray &&source) = default;
    PublicKeyArg &operator[](size_t index) { return _keys[index]; }

    size_t Size() { return _keys.size(); }
    void Reserve(size_t size) { return _keys.reserve(size); }

private:
    std::vector<PublicKeyArg> _keys;
};

#endif /* BLST_TS_PUBLIC_KEY_H__ */
#ifndef BLST_TS_SECRET_KEY_H__
#define BLST_TS_SECRET_KEY_H__

#include <memory>
#include "napi.h"
#include "blst.hpp"
#include "addon.h"
#include "public_key.h"
#include "signature.h"

class SecretKey : public Napi::ObjectWrap<SecretKey>
{
public:
    std::unique_ptr<blst::SecretKey> _key;
    bool _is_zero_key;

    static void Init(Napi::Env env, Napi::Object &exports, BlstTsAddon *module);
    static Napi::Value FromKeygen(const Napi::CallbackInfo &info);
    static Napi::Value FromKeygenSync(const Napi::CallbackInfo &info);
    static Napi::Value Deserialize(const Napi::CallbackInfo &info);
    SecretKey(const Napi::CallbackInfo &info);
    Napi::Value Serialize(const Napi::CallbackInfo &info);
    Napi::Value ToPublicKey(const Napi::CallbackInfo &info);
    Napi::Value Sign(const Napi::CallbackInfo &info);
    Napi::Value SignSync(const Napi::CallbackInfo &info);

private:
    BlstTsAddon *_module;
};

#endif /* BLST_TS_SECRET_KEY_H__ */
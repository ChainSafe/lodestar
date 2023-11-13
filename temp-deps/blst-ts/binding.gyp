{
  'targets': [
    {
      'target_name': 'blst_ts_addon',
      'sources': [
        'deps/blst/src/server.c',
        'deps/blst/build/assembly.S',
        'cc/addon.cc',
        'cc/secret_key.cc',
        'cc/public_key.cc',
        'cc/signature.cc',
        'cc/functions.cc',
      ],
      'include_dirs': [
        'deps/blst/bindings',
        "<!@(node -p \"require('node-addon-api').include_dir\")",
      ],
      'dependencies': [ "<!(node -p \"require('node-addon-api').gyp\")" ],
      'defines': [ 
        'NAPI_CPP_EXCEPTIONS'
      ],
      'cflags': [
          '-fexceptions',
          '-Werror',
          '-Wall',
          '-Wextra',
      ],
      'cflags_cc': [
          '-fexceptions',
          '-Werror',
          '-Wall',
          '-Wextra',
      ],
      'conditions': [
        [ 'OS=="win"', {
            'sources': [ 'blst/build/win64/*-x86_64.asm' ],
            'defines': [ '_HAS_EXCEPTIONS=1' ],
            'msvs_settings': {
              'VCCLCompilerTool': {
                'ExceptionHandling': 1,
                'EnablePREfast': 'true',
              },
            },
          }
        ],
        [ 'OS=="linux"', {
            'ldflags': [ '-Wl,-Bsymbolic' ],
          }
        ],
        ['OS=="mac"', {
          'xcode_settings': {
            'OTHER_CFLAGS': ['-fvisibility=hidden'],
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '12',
          }
        }]
      ],
    }
  ]
}
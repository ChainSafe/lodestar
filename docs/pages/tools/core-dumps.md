# Core Dump Analysis

Core dump analysis is some ninja level stuff. Once you get the hang of it you will feel like you have super powers. It will up your game to a whole new level because you will be able to debug issues that seemed impossible before. Post-crash analysis is a very powerful tool to have in your tool belt. A core dump has all of the objects in memory as well as all of the stack frame information at the exact moment the dump was taken, usually when a hard crash occurs.

It is important to note that debug symbols will greatly aid you in your debugging for issues related to native code like `C/C++`. When compiled languages are optimized the compiler will often strip out identifiers and all that will be remaining are mangled symbols and addresses. Compiling with debug symbols will leave all of the identifiers, file names and line numbers in-tact.

While it is not always practical to be running code in a Debug version of node, if you run across a persistent issue it will be helpful to recreate it on a debug build and to use that for analysis.

It is important to note that the EXACT binary that was running when the dump was created MUST be loaded when doing analysis. There is a lot of information in the dump that is specific to the binary that was running (like function offsets, etc). If you load a different binary you will get a lot of errors and the analysis will not be useful (if it loads at all).

It is also a nice-to-know that you can create the dump on linux, using a linux compiled version of node, and then read it on a mac. All that is needed is to download the node binary and dump file to the mac. It is possible to load them into a mac compiled version of llnode and all will work as expected. Its just the meta in the linux binary that is needed for analysis, it doesn't actually run the code.

## Installing `llnode`

`llnode` is a Node.js plugin for the [LLDB](https://lldb.llvm.org/) debugger. It is the officially sanctioned tool from Node and powerful way to do postmortem analysis of Node.js processes. The process for install is pretty straight-forward unless you have an M1 mac. XCode ships with an instance of `lldb` and installing `llnode` is as simple as running `npm install -g llnode`.

On an M1 mac the install will work fine but the plugin will crash at load time. See [this issue](https://github.com/nodejs/llnode/issues/430#issuecomment-1844628224) for updates. The workaround is to install `lldb` via homebrew.

```sh
# should only be necessary on M1 macs at time of writing
$ brew install llvm
$ echo 'export PATH="/opt/homebrew/opt/llvm/bin:$PATH"' >> ~/.zshrc
$ # note that its before recopying PATH to make sure it resolves
$ zsh ~/.zshrc
$ which llvm-config
/opt/homebrew/opt/llvm/bin/llvm-config # if this is not what comes up restart the shell
$ npm install -g llnode
$ llnode
(lldb) plugin load '/Users/ninja_user/.nvm/versions/node/v20.5.1/lib/node_modules/llnode/llnode.dylib'
(lldb) settings set prompt '(llnode) '
(llnode)
```

## Collecting a core dump

Before a core dump can be created the system must be enabled.

```sh
ulimit -c unlimited
```

This is a critical step. If that command is not run the core will not be dumped to disk.

Core dumps are normally created by the kernel when certain process signals are encountered. `SIGSEGV` is the most common signal that will cause a dump and its sent by the kernel to the process when a segfault occurs. `SIGSEGV` is not the only signal that works and you can see the full list [here](https://man7.org/linux/man-pages/man7/signal.7.html) under the "Standard Signals" section (all the ones that say "Core" in the "Action" column).

If you want to create a dump on demand you can use the `gcore` command on linux. This will create a dump of the process without killing it. If you don't mind termination you can also use `kill -SIGSEGV <pid>` to send the a dump signal to the process.

## Analyzing a core dump

Once you collect the core dump you can load it into `llnode` for debugging.

```sh
# remember that the node binary must be the exact same one that was running when the core was created
$ llnode -f /path/to/node_debug -c /Users/ninja_user/coredumps/node.coredump
(lldb) target create "node_debug" --core "node.coredump"
Core file '/Users/ninja_user/coredumps/node.coredump' (x86_64) was loaded.
(lldb) plugin load '/Users/ninja_user/.nvm/versions/node/v20.5.1/lib/node_modules/llnode/llnode.dylib'
(lldb) settings set prompt '(llnode) '
(llnode)
```

Once the dump is loaded the first few steps will be to figure out what types of objects were in memory and what was the processor working on when the crash occurred. Lets start with the stack trace.

There are two distinct commands for pulling the stack because node is both a native runtime and a virtual machine. The `bt`, back trace, command will pull the native stack frames and the `v8 bt` command will use the `llnode` plugin to pull the JavaScript stack frames. Newer versions of `llnode` will automatically pull the JavaScript stack frames when the `bt` command is run but it is still good to know the difference. It is also possible to add the `all` verb to the `bt` command and it will pull the back trace for all threads.

To start looking through memory there are two commands that are helpful. The `v8 findjsobjects` command will list all of the JavaScript objects in memory. The `v8 findjsinstances` command will list all of the instances of a particular JavaScript object.

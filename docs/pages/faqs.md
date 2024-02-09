# Frequently Asked Questions
This section of the documentation will cover common questions and encounters often asked by users and developers.

## Troubleshooting Lodestar

### Using Kubernetes
<!-- prettier-ignore-start -->
???+ note "Unknown arguments error on Kubernetes"
    Lodestar does not handle environment variables well when prefixed with `LODESTAR` by default. You may encounter issues such as:
    ```
    ✖ Unknown arguments: datadir, servicePort, servicePortEthConsensusP2p, 
    port9000Tcp, port9000TcpPort, port9000TcpProto, port9000TcpAddr, serviceHost
    ```
    The stateful set and other predefined environment variables should not use `LODESTAR`, which will break the deployment.

    Reference Issue:
    [https://github.com/ChainSafe/lodestar/issues/6045](https://github.com/ChainSafe/lodestar/issues/6045)
<!-- prettier-ignore-end -->
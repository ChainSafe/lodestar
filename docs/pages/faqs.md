# Frequently Asked Questions

This section of the documentation will cover common questions and encounters often asked by users and developers.

## Troubleshooting Lodestar

### Using Kubernetes

<!-- prettier-ignore-start -->
???+ note "Unknown arguments error"
    Lodestar reads all environment variables prefixed with `LODESTAR` and will try to parse
    them similar to command line arguments, meaning any unknown argument will cause an error.
    ```
    ✖ Unknown arguments: servicePort, servicePortEthConsensusP2p,
    port9000Tcp, port9000TcpPort, port9000TcpProto, port9000TcpAddr, serviceHost
    ```
    The extra arguments are present because Kubernetes automatically
    [adds environment variables](https://kubernetes.io/docs/concepts/services-networking/service/#environment-variables)
    to the Pod based on the name (`metadata.name`) defined in the associated `Service`.
    To resolve the issue, this name has to be changed to something that does not start with `lodestar`.

    Reference Issue: [#6045](https://github.com/ChainSafe/lodestar/issues/6045)
<!-- prettier-ignore-end -->

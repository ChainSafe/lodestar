# Frequently Asked Questions
This section of the documentation will cover common questions that are often asked by Lodestar users and developers

## User Troubleshooting

### Kubernetes
<!-- prettier-ignore-start -->
!!! question
    How do I fix issues related to environment variables deploying Lodestar containers on Kubernetes?
!!! abstract "Reference Issue"
    [https://github.com/ChainSafe/lodestar/issues/6045](https://github.com/ChainSafe/lodestar/issues/6045)
<!-- prettier-ignore-end -->
Lodestar does not handle environment variables well when prefixed with `LODESTAR` by default. You may encounter issues such as:
```
✖ Unknown arguments: datadir, servicePort, servicePortEthConsensusP2p, 
port9000Tcp, port9000TcpPort, port9000TcpProto, port9000TcpAddr, serviceHost
```
The stateful set and other predefined environment variables should not use `LODESTAR`, which will break the deployment.



## Known Issues

###
# Install with Docker

The [`chainsafe/lodestar`](https://hub.docker.com/r/chainsafe/lodestar) Docker Hub repository is mantained actively. It contains the `lodestar` CLI preinstalled.

<!-- prettier-ignore-start -->
!!! info
    The Docker Hub image tagged as `chainsafe/lodestar:next` is run on CI every dev commit on our `unstable` branch.
    For `stable` releases, the image is tagged as `chainsafe/lodestar:latest`.
<!-- prettier-ignore-end -->

Ensure you have Docker installed by issuing the command:

```bash
docker -v
```

It should return a non error message such as `Docker version xxxx, build xxxx`.

Pull, run the image and Lodestar should now be ready to use

```bash
docker pull chainsafe/lodestar
docker run chainsafe/lodestar --help
```
<!-- prettier-ignore-start -->
!!! info
    Docker is the recommended setup for Lodestar. Use our [comprehensive setup guide](https://hackmd.io/@philknows/rk5cDvKmK) with Docker for detailed instructions.
<!-- prettier-ignore-end -->
Main [Dockerfile](./Dockerfile) image is a [multi-platform](https://docs.docker.com/build/building/multi-platform/) and [multi-stage](https://docs.docker.com/build/building/multi-stage/) image. It builds on [node-alpine](https://hub.docker.com/_/node) to optimise for final size.

A typical build command-line for creating an image for linux (`amd64` and `arm64`) would be:

```bash
docker buildx build . --platform linux/amd64,linux/arm64 --build-arg COMMIT=$(git rev-parse HEAD)
```

Speed improvements can be achieved during docker image build by relying on yarn [offline mirror](https://classic.yarnpkg.com/blog/2016/11/24/offline-mirror/).
To configure this, run the following commands:

```bash
yarn config set yarn-offline-mirror .yarn/yarn-offline-mirror
mv ~/.yarnrc ./ # `yarn config` commands are always global, make `.yarnrc` specific to this project
# When run for the first time on an existing setup, run the following extra commands
# rm -rf node_modules/ && yarn install
```

Those files will then be copied during the Docker build process and used to remove the need to download dependencies.
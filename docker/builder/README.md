This image is intended to be used as a base builder image for the main lodestar image.

Build and push with (version should match the alpine base image version):

```bash
docker buildx build . --push
  --tag chainsafe/lodestar-builder:20
  --platform linux/amd64,linux/arm64
```
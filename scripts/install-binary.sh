#!/bin/bash

# ASCII art
echo "  _           _           _             "
echo " | |         | |         | |            "
echo " | | ___   __| | ___  ___| |_ __ _ _ __ "
echo " | |/ _ \ / _  |/ _ \/ __| __/ _  |  __|"
echo " | | (_) | (_| |  __/\__ \ || (_| | |   "
echo " |_|\___/ \__ _|\___||___/\__\__ _|_|   "
echo ""

# Declare directories
TEMP_DIR=$(mktemp -d)
LOCAL_BIN="$HOME/.local/bin"

# Ensure ~/.local/bin exists
mkdir -p "$LOCAL_BIN"

# Inform the user about temporary directory usage
echo "Using temporary directory: $TEMP_DIR"

# Fetch the latest release tag from GitHub
echo "Fetching the latest version information..."
VERSION=$(curl -s "https://api.github.com/repos/ChainSafe/lodestar/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

# Check if VERSION is empty
if [ -z "$VERSION" ]; then
    echo "Failed to fetch the latest version. Exiting."
    exit 1
fi

echo "Latest version detected: $VERSION"

# Detect the operating system and architecture
OS=$(uname -s)
ARCH=$(uname -m)

# Translate architecture to expected format
case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
        echo "Unsupported architecture: $ARCH. Exiting."
        exit 1
        ;;
esac

# Translate OS to expected format
case $OS in
    Linux) PLATFORM="linux-$ARCH" ;;
    *)
        echo "Unsupported operating system: $OS. Exiting."
        exit 1
        ;;
esac

# Construct the download URL
URL="https://github.com/ChainSafe/lodestar/releases/download/$VERSION/lodestar-$VERSION-$PLATFORM.tar.gz"
echo "Downloading from: $URL"

# Download the tarball
if ! wget "$URL" -O "$TEMP_DIR/lodestar-$VERSION-$PLATFORM.tar.gz"; then
    echo "Download failed. Exiting."
    exit 1
fi

# Extract the tarball
echo "Extracting the binary..."
if ! tar -xzf "$TEMP_DIR/lodestar-$VERSION-$PLATFORM.tar.gz" -C "$TEMP_DIR"; then
    echo "Extraction failed. Exiting."
    exit 1
fi

# Move the binary to ~/.local/bin
echo "Moving the binary to $LOCAL_BIN..."
mv "$TEMP_DIR/lodestar" "$LOCAL_BIN/"
chmod +x "$LOCAL_BIN/lodestar"

# Verify if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
    echo "Adding $LOCAL_BIN to PATH..."
    echo 'export PATH="$PATH:$HOME/.local/bin"' >> "$HOME/.bashrc"
    echo "Run 'source ~/.bashrc' to apply changes to your shell."
fi

# Clean up the temporary directory
rm -rf "$TEMP_DIR"

# Inform the user of successful installation
echo "Installation complete!"
echo "Run 'lodestar --help' to get started."

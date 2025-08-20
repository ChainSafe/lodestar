#!/bin/bash
# Script to run Lodestar testnet using Kurtosis

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
ENCLAVE_NAME="lodestar-testnet"
CONFIG_FILE="lodestar.yaml"
KURTOSIS_PACKAGE="github.com/ethpandaops/ethereum-package"

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check dependencies
check_dependencies() {
    print_info "Checking dependencies..."
    
    if ! command_exists kurtosis; then
        print_error "Kurtosis is not installed. Please install it from https://docs.kurtosis.com/install"
        exit 1
    fi
    
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker."
        exit 1
    fi
}

# Function to start the testnet
start_testnet() {
    local config_path="$1"
    
    print_info "Starting testnet with enclave name: $ENCLAVE_NAME"
    
    # Check if enclave already exists
    if kurtosis enclave inspect "$ENCLAVE_NAME" >/dev/null 2>&1; then
        print_warn "Enclave $ENCLAVE_NAME already exists. Cleaning it up..."
        kurtosis enclave rm -f "$ENCLAVE_NAME"
    fi
    
    # Run Kurtosis with the configuration
    print_info "Starting Kurtosis with configuration: $config_path"
    kurtosis run --enclave "$ENCLAVE_NAME" "$KURTOSIS_PACKAGE" --args-file "$config_path"
    
    print_info "Testnet started successfully!"
    print_info "View services: kurtosis enclave inspect $ENCLAVE_NAME"
}

# Function to stop the testnet
stop_testnet() {
    print_info "Stopping testnet: $ENCLAVE_NAME"
    kurtosis enclave stop "$ENCLAVE_NAME"
    
    print_info "Cleaning up testnet resources..."
    kurtosis enclave rm -f "$ENCLAVE_NAME"
    
    print_info "Testnet stopped and cleaned up successfully"
}

# Function to clean up the testnet
clean_testnet() {
    print_info "Cleaning up testnet: $ENCLAVE_NAME"
    kurtosis enclave rm -f "$ENCLAVE_NAME"
}

# Function to show logs
show_logs() {
    local service="$1"
    if [ -z "$service" ]; then
        print_info "Available services:"
        kurtosis service ls "$ENCLAVE_NAME"
    else
        print_info "Showing logs for service: $service"
        kurtosis service logs "$ENCLAVE_NAME" "$service" --follow
    fi
}

# Function to port-forward a service
port_forward() {
    local service="$1"
    local port="$2"
    
    if [ -z "$service" ] || [ -z "$port" ]; then
        print_error "Usage: $0 port-forward <service-name> <port>"
        exit 1
    fi
    
    print_info "Port-forwarding $service:$port"
    kurtosis port-forward "$ENCLAVE_NAME" "$service" "$port"
}

# Function to build local Docker image
build_local() {
    print_info "Building local Lodestar Docker image..."
    
    # Get the root directory (two levels up from scripts/kurtosis)
    # TODO: There might be a better way to get the root
    LODESTAR_ROOT="$SCRIPT_DIR/../.."
    
    # Build the Docker image
    if docker build -f Dockerfile.dev -t lodestar:local "$LODESTAR_ROOT"; then
        print_info "Successfully built lodestar:local"
        print_info "You can now use this image in your config files with: cl_image: lodestar:local"
    else
        print_error "Failed to build Docker image"
        exit 1
    fi
}

# Function to show usage
usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  start [config-file]  Start the testnet (builds local image, default: lodestar.yaml)"
    echo "  stop                 Stop and clean up the testnet"
    echo "  clean                Force clean up the testnet (if stop fails)"
    echo "  logs [service]       Show logs for a service (or list services)"
    echo "  port-forward <service> <port>  Forward a port from a service"
    echo "  build                Build local Docker image only (without starting)"
    echo "  help                 Show this help message"
    echo ""
    echo "Options:"
    echo "  -e, --enclave <name>  Set enclave name (default: lodestar-testnet)"
    echo ""
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 start custom-config.yaml"
    echo "  $0 logs cl-1-lodestar"
    echo "  $0 port-forward grafana 3000"
}

# Parse command line arguments
COMMAND=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--enclave)
            ENCLAVE_NAME="$2"
            shift 2
            ;;
        build|start|stop|clean|logs|port-forward|help)
            COMMAND="$1"
            shift
            break
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Check dependencies
check_dependencies

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Execute command
case $COMMAND in
    build)
        build_local
        ;;
    start)
        CONFIG_PATH="${1:-$CONFIG_FILE}"
        # Make path absolute if relative
        if [[ ! "$CONFIG_PATH" = /* ]]; then
            CONFIG_PATH="$SCRIPT_DIR/$CONFIG_PATH"
        fi
        
        if [ ! -f "$CONFIG_PATH" ]; then
            print_error "Configuration file not found: $CONFIG_PATH"
            exit 1
        fi
        
        # Always build local image before starting
        print_info "Building local Lodestar Docker image before starting testnet..."
        build_local
        
        start_testnet "$CONFIG_PATH"
        ;;
    stop)
        stop_testnet
        ;;
    clean)
        clean_testnet
        ;;
    logs)
        show_logs "$1"
        ;;
    port-forward)
        port_forward "$1" "$2"
        ;;
    help)
        usage
        ;;
    *)
        print_error "No command specified"
        usage
        exit 1
        ;;
esac
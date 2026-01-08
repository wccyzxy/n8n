#!/bin/bash

# n8n PM2 Start Script
# This script sets up the environment and starts n8n using PM2

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${GREEN}Starting n8n with PM2...${NC}"

# Check if nvm is installed
if ! command -v nvm &> /dev/null; then
    # Try to source nvm if it exists
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        echo -e "${YELLOW}Loading nvm from $HOME/.nvm/nvm.sh${NC}"
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
        echo -e "${YELLOW}Loading nvm from /usr/local/opt/nvm/nvm.sh${NC}"
        export NVM_DIR="/usr/local/opt/nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    else
        echo -e "${RED}Error: nvm is not installed or not found.${NC}"
        echo "Please install nvm first: https://github.com/nvm-sh/nvm"
        exit 1
    fi
fi

# Use nvm to set Node.js version to 22
echo -e "${YELLOW}Setting Node.js version to 22...${NC}"
nvm use 22 || nvm install 22 && nvm use 22

# Verify Node.js version
NODE_VERSION=$(node -v)
echo -e "${GREEN}Using Node.js version: $NODE_VERSION${NC}"

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed.${NC}"
    echo "Please install pnpm first: npm install -g pnpm"
    exit 1
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 is not installed. Installing PM2 globally...${NC}"
    npm install -g pm2
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies with pnpm...${NC}"
pnpm install

# Build the project with 3GB memory limit and 3 CPU cores
echo -e "${YELLOW}Building n8n (max memory: 3GB, max CPUs: 3)...${NC}"
export NODE_OPTIONS="--max-old-space-size=3072"

# Limit CPU usage to 3 cores using taskset if available, otherwise use turbo concurrency
if command -v taskset &> /dev/null; then
    # Use taskset to bind to first 3 CPU cores (0, 1, 2)
    echo -e "${YELLOW}Using taskset to limit to 3 CPU cores...${NC}"
    taskset -c 0-2 pnpm run build
else
    # Fallback: limit turbo concurrency to 3 tasks
    echo -e "${YELLOW}Limiting turbo concurrency to 3 tasks...${NC}"
    pnpm run build -- --concurrency=3
fi

# Check if PM2 process already exists
if pm2 list | grep -q "n8n"; then
    echo -e "${YELLOW}n8n is already running in PM2. Restarting...${NC}"
    pm2 restart n8n
else
    # Start n8n with PM2
    echo -e "${GREEN}Starting n8n with PM2...${NC}"
    
    # Use ecosystem.config.js if it exists, otherwise start directly
    if [ -f "ecosystem.config.js" ]; then
        pm2 start ecosystem.config.js
    else
        # Start n8n directly with PM2
        pm2 start "pnpm start" --name n8n --interpreter bash
    fi
fi

# Save PM2 process list
pm2 save

# Show PM2 status
echo -e "${GREEN}n8n started successfully!${NC}"
echo -e "${YELLOW}PM2 Status:${NC}"
pm2 status

echo -e "${GREEN}To view logs: pm2 logs n8n${NC}"
echo -e "${GREEN}To stop n8n: ./stop.sh${NC}"


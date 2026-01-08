#!/bin/bash

# n8n PM2 Stop Script
# This script stops n8n running in PM2

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Stopping n8n with PM2...${NC}"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}Error: PM2 is not installed.${NC}"
    exit 1
fi

# Check if n8n is running in PM2
if pm2 list | grep -q "n8n"; then
    echo -e "${YELLOW}Stopping n8n...${NC}"
    pm2 stop n8n
    
    echo -e "${YELLOW}Removing n8n from PM2...${NC}"
    pm2 delete n8n
    
    # Save PM2 process list
    pm2 save
    
    echo -e "${GREEN}n8n stopped successfully!${NC}"
else
    echo -e "${YELLOW}n8n is not running in PM2.${NC}"
fi

# Show PM2 status
echo -e "${YELLOW}PM2 Status:${NC}"
pm2 status


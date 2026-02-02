#!/bin/bash
# Deploy script for Psephos voting system
# Run this after getting enough devnet SOL (about 3 SOL total needed)
#
# Get SOL from: https://faucet.solana.com
# Current wallet: solana address

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERIFIER_DIR="/Users/user/development/solana/hackathon/privacy_hack/aztec/resources/sunspot/gnark-solana"

echo "=== Psephos Deployment Script ==="
echo ""

# Check balance
BALANCE=$(solana balance | awk '{print $1}')
echo "Current balance: $BALANCE SOL"
echo "Required: ~3 SOL (1.4 for verifier + 1.5 for psephos)"
echo ""

# Step 1: Deploy ZK Verifier
echo "Step 1: Deploying Sunspot ZK Verifier..."
echo "  Program ID: BSyKYjTJoSue5k8T8w9VnKFT9LDGe5sbfUfiHg8ceTbV"
solana program deploy \
  "$VERIFIER_DIR/target/deploy/verifier_bin.so" \
  --program-id "$PROJECT_DIR/anchor/keys/psephos_verifier-keypair.json"

echo ""
echo "Verifier deployed successfully!"
echo ""

# Step 2: Deploy Psephos program
echo "Step 2: Deploying Psephos voting program..."
cd "$PROJECT_DIR/anchor"
anchor deploy

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Verifier Program ID: BSyKYjTJoSue5k8T8w9VnKFT9LDGe5sbfUfiHg8ceTbV"
echo "Psephos Program ID: DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u"
echo ""
echo "Both programs are now deployed to devnet!"

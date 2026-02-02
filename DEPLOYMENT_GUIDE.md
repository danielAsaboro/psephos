# Psephos Devnet Deployment Guide

## Status: Ready to Deploy (Pending Devnet SOL)

**Build**: ✅ Completed successfully
**Airdrop**: ⚠️ Rate limited (wait 1-2 hours or use alternative faucet)
**Deployment commands**: ✅ Ready

---

## Quick Deploy (Once SOL is available)

```bash
# 1. Get devnet SOL (use web faucet if CLI is rate-limited)
# https://faucet.solana.com/
solana airdrop 2 --url devnet

# 2. Deploy Sunspot verifier program
cd circuits/target
solana program deploy psephos_circuits.so --url devnet --program-id ../psephos_circuits-keypair.json

# 3. Deploy Psephos program
cd ../../anchor
anchor deploy --provider.cluster devnet

# 4. Verify deployment
solana program show DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u --url devnet

# 5. Update frontend to use devnet
# Already configured in Anchor.toml!
```

---

## Alternative: Deploy with Web Faucet

1. **Get SOL**: Visit https://faucet.solana.com/
   - Enter your wallet address: `solana address`
   - Request 2 SOL
   - Wait for confirmation

2. **Deploy verifier**:
   ```bash
   cd /Users/cartel/development/solana/hackathons/privacy_hack/aztec/psephos/circuits/target
   solana program deploy psephos_circuits.so \
     --url devnet \
     --program-id psephos_circuits-keypair.json
   ```

3. **Deploy program**:
   ```bash
   cd /Users/cartel/development/solana/hackathons/privacy_hack/aztec/psephos/anchor
   anchor deploy --provider.cluster devnet
   ```

---

## Expected Output

### Verifier Deployment
```
Program Id: G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H

Signature: [signature]
```

### Psephos Program Deployment
```
Program Id: DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u

Signature: [signature]
```

---

## Post-Deployment Verification

```bash
# Check verifier program
solana program show G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H --url devnet

# Check psephos program
solana program show DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u --url devnet

# Both should show as executable
```

---

## Frontend Configuration

**Already configured!** Anchor.toml has:

```toml
[programs.devnet]
psephos = "DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u"

[provider]
cluster = "devnet"  # or set via environment
```

To use devnet in frontend:
```bash
# Set environment variable
export VITE_CLUSTER=devnet

# Or update .env file
echo "VITE_CLUSTER=devnet" > .env

# Start frontend
npm run dev
```

---

## Testing on Devnet

Once deployed:

```bash
# Run tests against devnet (update test config to use devnet)
npm run anchor-test

# Or test manually via UI
npm run dev
# Open http://localhost:5173
# Connect devnet wallet
# Create proposal and vote
```

---

## Troubleshooting

### "Error: Account not found"
- Program not deployed yet or wrong network
- Check: `solana config get`
- Should show: `RPC URL: https://api.devnet.solana.com`

### "Error: Insufficient funds"
- Need more SOL for deployment (~0.5 SOL per program)
- Use web faucet or wait for CLI rate limit to reset

### "Error: Invalid program id"
- Check program IDs match in:
  - `anchor/programs/psephos/src/lib.rs` (declare_id!)
  - `anchor/Anchor.toml` ([programs.devnet])

---

## Cost Estimate

- **Verifier program**: ~0.3 SOL (200KB)
- **Psephos program**: ~0.2 SOL (smaller)
- **Total**: ~0.5 SOL + gas fees

---

## Deployment Checklist

- [x] Program builds successfully
- [x] Tests pass (9/10 with real verification)
- [x] Program IDs configured in Anchor.toml
- [x] Verifier keypair exists
- [ ] Devnet SOL balance sufficient (>0.5 SOL)
- [ ] Deploy verifier program
- [ ] Deploy psephos program
- [ ] Verify both programs on-chain
- [ ] Test via frontend
- [ ] Update submission with devnet URLs

---

## For Submission

Once deployed, add to README.md:

```markdown
## Live Demo

**Network**: Solana Devnet
**Program ID**: DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u
**Verifier ID**: G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H

**Explorer**:
- [Psephos Program](https://explorer.solana.com/address/DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u?cluster=devnet)
- [Verifier Program](https://explorer.solana.com/address/G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H?cluster=devnet)
```

---

## Status

**Ready to deploy** - just need devnet SOL!

Alternative: Deploy to local validator for demo (already working in tests).

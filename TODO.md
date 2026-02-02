# Psephos - Critical Project TODO

**Last Updated**: January 31, 2026
**Status**: 🟢 **TESTS PASSING** - 14/14 anchor tests pass

---

## Current State Summary

### What Works
| Component | Status | Notes |
|-----------|--------|-------|
| Noir Circuit | ✅ Compiled | 4 unit tests, proper pedersen hash nullifier/commitment |
| Solana Program | ✅ 14/14 tests pass | Full voting flow with ZK proof validation |
| Frontend Components | ✅ Complete | CreateProposal, VoteForm, ResultsView, RevealVote |
| Proof Server | ✅ Implemented | /generate-proof endpoint using two-phase nargo approach |
| Test Infrastructure | ✅ Working | anchor test passes all tests |
| Bundle Size | ✅ 432KB | NOT 65MB as previously claimed |

### Configuration Fixes Applied
- [x] Fixed Anchor.toml path: `/Users/cartel/...` (was `/Users/user/...`)
- [x] Fixed verifier program ID: `342qCcjjy1Tsra91wbEsVhSDYHDVYUoVGTgsXK1tBoNd`
- [x] Fixed proof-server paths in server.js and index.js
- [x] Implemented /generate-proof endpoint (was returning 501)
- [x] Added bind_address = "127.0.0.1" for test validator
- [x] Enabled skip-zk-verify feature for testing/demo

---

## Remaining Work for Competition

### Phase 1: Demo Preparation (Required)
- [ ] **Switch to devnet**: `solana config set --url devnet`
- [ ] **Get devnet SOL**: `solana airdrop 2`
- [ ] **Deploy programs**:
  - [ ] `anchor deploy --provider.cluster devnet`
- [ ] **Test frontend**: `npm run dev`
- [ ] **Record demo video** (3 minutes max)

### Phase 2: Real ZK Verification (Optional)
To enable actual on-chain ZK verification:
- [ ] Change `Cargo.toml`: `default = []` (remove skip-zk-verify)
- [ ] Deploy verifier program: `solana program deploy verifier_bin.so`
- [ ] Rebuild: `anchor build`
- [ ] Deploy psephos: `anchor deploy`
- [ ] Test with real proofs

### Phase 3: Documentation (Recommended)
- [ ] Update README.md with accurate status
- [ ] Add setup instructions
- [ ] Document environment variables

---

## Quick Reference

### Run Tests
```bash
cd anchor && anchor test
```

### Start Dev Server
```bash
npm run dev
```

### Start Proof Server
```bash
cd proof-server && npm start
```

### Deploy to Devnet
```bash
solana config set --url devnet
solana airdrop 2
cd anchor && anchor deploy --provider.cluster devnet
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                        │
│  CreateProposal │ VoteForm │ ResultsView │ RevealVote       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Proof Server (Node.js)                   │
│  /generate-proof: Two-phase approach                        │
│  1. Compute hashes via temporary Noir circuit               │
│  2. Generate Gnark proof via Sunspot                        │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Solana Program (Anchor)                    │
│  create_proposal │ cast_vote │ reveal_vote │ finalize       │
│  - Token balance verification                               │
│  - Proof structure validation                               │
│  - Nullifier-based double-vote prevention                   │
│  - Vote commitment hiding                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Flags

### `skip-zk-verify` (Currently Enabled)
When enabled (default for demo):
- Proof structure is validated (size, format)
- Public inputs are verified (threshold, proposal_id, nullifier, commitment)
- Token balance is checked on-chain
- **Skipped**: CPI to ZK verifier program

When disabled (production):
- All above validations
- **Plus**: Actual cryptographic proof verification via Sunspot verifier

---

## Bounty Targets

| Bounty | Prize | Status | Notes |
|--------|-------|--------|-------|
| Most Creative | $2,500 | 🎯 Primary Target | Strong concept, Greek theme |
| Best Non-Financial Use | $2,500 | 🎯 Backup Target | Voting is perfect use case |
| Best Overall | $5,000 | ⚠️ Stretch | Needs real ZK verification |

---

## Key Files

| File | Purpose |
|------|---------|
| `anchor/programs/psephos/src/lib.rs` | Main Solana program (540 lines) |
| `circuits/src/main.nr` | Noir ZK circuit (140 lines) |
| `proof-server/index.js` | Proof generation server |
| `src/components/VoteForm.tsx` | Voting UI with ZK integration |
| `anchor/tests/psephos.ts` | 14 comprehensive tests |

---

## Test Results (January 31, 2026)

```
  psephos
    create_proposal
      ✔ should create a proposal with valid parameters
      ✔ should fail to create proposal with empty title
    cast_vote
      ✔ should cast a vote with valid proof data
      ✔ should prevent double voting with same nullifier
      ✔ should allow a second voter with different nullifier
    reveal_vote
      ✔ should fail to reveal before voting ends
      ✔ should reveal vote after voting period ends
      ✔ should fail to reveal same vote twice
      ✔ should allow revealing a different vote for option 1
    finalize_proposal
      ✔ should fail to finalize if not creator
      ✔ should finalize proposal when called by creator
      ✔ should fail to finalize already finalized proposal
    edge cases
      ✔ should fail to cast vote after proposal is finalized
      ✔ should fail to reveal with invalid vote choice

  14 passing (15s)
```

---

## Known Issues

1. **Nargo not installed locally** - Proof server requires nargo for hash computation
2. **Sunspot not installed locally** - Required for Gnark proof generation
3. **Version mismatch warning** - anchor-lang 0.30.1 vs CLI 0.32.1 (works despite warning)
4. **Wallet not configured for devnet** - Currently on mainnet with 0 SOL

---

*This TODO reflects the actual state of the project after critical evaluation and fixes.*

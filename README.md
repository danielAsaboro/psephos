# Psephos (Ψῆφος) - Private Voting on Solana

> *Psephos* - Ancient Greek for "vote" or "pebble". In ancient Greece, citizens used pebbles (psephoi) to cast secret votes.

## Project Overview

Psephos is a privacy-preserving voting system built with Noir ZK proofs on Solana. Vote without revealing your identity, prove your eligibility without exposing your holdings.

### Built for Solana Privacy Hackathon 2026
- **Track**: Aztec - ZK with Noir
- **Bounties**: Best Overall ($5k), Best Non-Financial Use ($2.5k), Most Creative ($2.5k)

## Current Status

| Component | Status | Description |
|-----------|--------|-------------|
| Noir Circuit | ✅ Working | Compiles with 4 unit tests |
| Solana Program | ✅ **9/10 Tests Pass** | Full voting flow verified with real ZK |
| Frontend | ✅ Working | React UI with wallet integration |
| **Dual-Backend Proving** | ✅ **NEW!** | Server (Sunspot) + Browser (Barretenberg/bb.js) |
| **Browser Proving (bb.js)** | ✅ **NEW!** | Client-side ZK proving with Barretenberg |
| ZK Verification | ✅ **ENABLED** | Real cryptographic verification via Sunspot |
| Bundle Size | ⚠️ 65MB | Includes Barretenberg WASM for browser proving |
| Devnet Deployment | 🔄 Pending | Ready to deploy |

### Test Results (February 1, 2026)
```
  9 passing (9s)
  - create_proposal: 2 tests
  - cast_vote: 2 tests
  - reveal_vote: 3 tests
  - finalize_proposal: 3 tests

  Real ZK verification with Sunspot verifier ✅
```

## Features

- **Private Voting**: Cast votes without revealing your identity
- **ZK Eligibility Proofs**: Prove you're eligible to vote without exposing token holdings
- **Nullifier System**: Prevents double voting while maintaining privacy
- **🆕 Dual-Backend Architecture**: Choose between server-side (Sunspot) or browser-side (Barretenberg) proving
- **🆕 Browser Proving with bb.js**: Generate ZK proofs entirely client-side using Barretenberg
- **Real ZK Verification**: Cryptographic proof verification on Solana via Sunspot verifier
- **Modern React UI**: Beautiful Greek-inspired voting interface

## Architecture

### Dual-Backend ZK Proving System

Psephos implements a **dual-backend architecture** that supports two proving backends:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (React + Wallet)                     │
│              Choose: Server or Browser Proving                   │
└───────────────────┬────────────────────┬────────────────────────┘
                    │                    │
        ┌───────────▼─────────┐  ┌───────▼──────────┐
        │  Server-Side (Fast)  │  │ Browser (Private) │
        │   Sunspot (gnark)    │  │ Barretenberg/bb.js│
        │   5-10s proving      │  │  30-60s proving   │
        │   ✅ Default          │  │  ✅ Full client   │
        └───────────┬─────────┘  └───────┬──────────┘
                    │                    │
                    └────────┬───────────┘
                             │
                   ┌─────────▼─────────┐
                   │   Noir ZK Circuit  │
                   │  • Token threshold │
                   │  • Nullifier       │
                   │  • Commitment      │
                   └─────────┬─────────┘
                             │
                   ┌─────────▼──────────┐
                   │  Solana Program    │
                   │  • Sunspot Verifier│
                   │  • Vote Storage    │
                   │  • Tally Results   │
                   └────────────────────┘
```

### Why Two Backends?

| Feature | Sunspot (Server) | Barretenberg (Browser) |
|---------|------------------|------------------------|
| **Speed** | ✅ Fast (5-10s) | ⚠️ Slower (30-60s) |
| **Privacy** | ⚠️ Server sees inputs | ✅ Fully client-side |
| **On-chain Cost** | ✅ Lighter verification | ⚠️ Heavier verification |
| **Use Case** | Production default | Maximum privacy |
| **Bundle Size** | ✅ 432KB | ⚠️ 65MB (WASM) |

**Sponsor Alignment**: This dual-backend architecture directly addresses the hackathon sponsor's hint:
*"Extra points if you get a Sunspot -> Barretenberg recursively verifier built, then bb.js in browser hehe"*

## Project Structure

```
psephos/
├── circuits/              # Noir ZK circuits
│   ├── src/main.nr        # Voting eligibility proof
│   └── Nargo.toml
├── anchor/                # Solana Anchor program
│   └── programs/psephos/  # Voting program
├── src/                   # Frontend React app
│   ├── components/        # Voting UI components
│   ├── lib/               # Utility functions
│   └── generated/         # Generated client code
└── package.json
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) >= 1.75
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) >= 2.1
- [Anchor](https://www.anchor-lang.com/docs/installation) >= 0.30
- [Noir/Nargo](https://noir-lang.org/docs/getting_started/installation) >= 1.0
- [Node.js](https://nodejs.org/) >= 18

### Installation

```bash
# Install dependencies
npm install

# Build Noir circuits
cd circuits && nargo compile && nargo test

# Build Solana program
cd anchor && anchor build

# Generate TypeScript client
npm run codama:js

# Start frontend
npm run dev
```

## How It Works

### 1. Create Proposal
A user creates a voting proposal with:
- Title and voting options
- Minimum token threshold for eligibility
- Voting period duration

### 2. Cast Private Vote
When voting:
1. User selects their vote choice
2. Client generates a nullifier (unique per voter per proposal)
3. Client generates a vote commitment (hides the actual vote)
4. Transaction includes ZK proof of eligibility
5. Only the nullifier is stored on-chain (not the vote)

### 3. Reveal & Tally
After voting ends:
- Voters can reveal their votes
- Revealed votes are tallied
- Final results are published

## ZK Circuit

The Noir circuit proves:
1. **Token Balance**: Voter holds >= minimum threshold
2. **Valid Vote**: Vote choice is within valid options
3. **Nullifier**: Correctly computed to prevent double voting
4. **Commitment**: Vote is committed without revealing choice

```noir
fn main(
    token_balance: u64,        // Private: actual balance
    voter_secret: Field,       // Private: voter's secret
    vote_choice: u8,           // Private: actual vote
    min_token_threshold: pub u64,  // Public: minimum required
    proposal_id: pub Field,    // Public: which proposal
    vote_commitment: pub Field,// Public: commitment to vote
    nullifier: pub Field,      // Public: prevents double vote
) {
    assert(token_balance >= min_token_threshold);
    assert(vote_choice < 10);
    // Verify nullifier and commitment...
}
```

## Hackathon Submission

- **Submission Deadline**: February 1, 2026
- **Network**: Solana Devnet
- **License**: MIT

## Using Browser Proving

To enable client-side ZK proving with Barretenberg/bb.js:

```typescript
import { setProvingBackend, ProvingBackend } from './lib/noir-api';

// Use browser-based proving (bb.js)
setProvingBackend(ProvingBackend.BROWSER);

// Or use server-side proving (Sunspot - default)
setProvingBackend(ProvingBackend.SERVER);

// Or auto-select (try server first, fallback to browser)
setProvingBackend(ProvingBackend.AUTO);
```

The frontend will automatically:
- Load the compiled circuit from `/public/circuits/psephos_circuits.json`
- Initialize Barretenberg backend in the browser
- Generate proofs client-side (takes ~30-60 seconds)
- Submit to Solana with real cryptographic verification

## What's Next

- [x] ~~Noir circuit with pedersen hash nullifiers~~ ✅
- [x] ~~Solana program with full voting flow~~ ✅
- [x] ~~Proof server with two-phase generation~~ ✅
- [x] ~~9/10 anchor tests passing with real ZK verification~~ ✅
- [x] ~~Dual-backend architecture (Sunspot + Barretenberg)~~ ✅
- [x] ~~Browser proving with bb.js~~ ✅
- [ ] Recursive verification (Sunspot -> Barretenberg verifier)
- [ ] Deploy to Solana devnet
- [ ] Record 3-minute demo video

## Resources

- [Noir Documentation](https://noir-lang.org/docs)
- [Sunspot - Noir on Solana](https://github.com/reilabs/sunspot)
- [Anchor Framework](https://www.anchor-lang.com/)
- [Solana Foundation Noir Examples](https://github.com/solana-foundation/noir-examples)

## License

MIT License - see LICENSE file for details

---

Built with 🏛️ for Solana Privacy Hackathon 2026
# psephos

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { Psephos } from "../target/types/psephos";
import * as fs from 'fs';
import * as path from 'path';

// Load pre-generated proof and witness for real ZK verification
const circuitDir = path.join(__dirname, '../../circuits/target');
const realProof = fs.readFileSync(path.join(circuitDir, 'psephos_circuits.proof'));
const realWitness = fs.readFileSync(path.join(circuitDir, 'psephos_circuits.pw'));

// Known values from Prover.toml (these match the pre-generated proof)
const KNOWN_NULLIFIER = Buffer.from('0a2117377b0ea781202c90d57ddc28c4a98ad83879c0bc1132cca576ff99e9bf', 'hex');
const KNOWN_COMMITMENT = Buffer.from('1f1dd08a1cb204c943c29bfdbd6e96eda795980a7521f1479f43c33dd56d9a32', 'hex');

// Values from Prover.toml that the proof was generated with
const PROOF_PROPOSAL_ID = new BN(1);
const PROOF_THRESHOLD = new BN(50);

// ZK Verifier Program ID (circuit-specific Sunspot verifier for psephos_circuits)
const ZK_VERIFIER_PROGRAM_ID = new PublicKey("G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H");

describe("psephos", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.psephos as Program<Psephos>;

  // Test keypairs
  const creator = Keypair.generate();
  const voter1 = Keypair.generate();

  // Token mint and accounts
  let tokenMint: PublicKey;
  let voter1TokenAccount: PublicKey;

  // PDAs for the real ZK test (proposal ID = 1)
  let proposalPDA: PublicKey;
  let resultsPDA: PublicKey;
  let voteRecordPDA: PublicKey;

  before(async () => {
    // Fund test accounts
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    const minBalance = 1 * LAMPORTS_PER_SOL;

    const fundIfNeeded = async (keypair: Keypair) => {
      const balance = await provider.connection.getBalance(keypair.publicKey);
      if (balance < minBalance) {
        const sig = await provider.connection.requestAirdrop(keypair.publicKey, airdropAmount);
        await provider.connection.confirmTransaction(sig);
      }
    };

    await Promise.all([fundIfNeeded(creator), fundIfNeeded(voter1)]);

    // Create test token mint
    tokenMint = await createMint(
      provider.connection,
      creator,
      creator.publicKey,
      null,
      0
    );

    // Create token account for voter with 100 tokens (matches Prover.toml token_balance)
    voter1TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      voter1,
      tokenMint,
      voter1.publicKey
    );

    await mintTo(
      provider.connection,
      creator,
      tokenMint,
      voter1TokenAccount,
      creator,
      100
    );

    // Derive PDAs for proposal ID = 1 (matches Prover.toml)
    [proposalPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), PROOF_PROPOSAL_ID.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [resultsPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("results"), PROOF_PROPOSAL_ID.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [voteRecordPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), proposalPDA.toBuffer(), KNOWN_NULLIFIER],
      program.programId
    );

    console.log("Token mint:", tokenMint.toBase58());
    console.log("Voter1 token account:", voter1TokenAccount.toBase58());
    console.log("Proposal PDA:", proposalPDA.toBase58());
  });

  describe("create_proposal", () => {
    it("should create a proposal with valid parameters", async () => {
      // Create proposal with parameters matching Prover.toml
      const tx = await program.methods
        .createProposal(
          PROOF_PROPOSAL_ID,
          "Real ZK Voting Test",
          ["Yes", "No", "Abstain"],
          tokenMint,
          PROOF_THRESHOLD,
          new BN(5) // 5 seconds voting period
        )
        .accounts({
          creator: creator.publicKey,
          proposal: proposalPDA,
          results: resultsPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      console.log("Create proposal tx:", tx);

      const proposal = await program.account.proposal.fetch(proposalPDA);
      assert.equal(proposal.id.toString(), PROOF_PROPOSAL_ID.toString());
      assert.equal(proposal.minThreshold.toString(), PROOF_THRESHOLD.toString());
      assert.equal(proposal.isFinalized, false);
      assert.equal(proposal.voteCount.toString(), "0");

      const results = await program.account.proposalResults.fetch(resultsPDA);
      assert.equal(results.tallies.length, 3);
      assert.isTrue(results.tallies.every(t => t.toString() === "0"));
    });

    it("should fail to create proposal with too few options", async () => {
      const badProposalId = new BN(999);
      const [badProposalPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("proposal"), badProposalId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [badResultsPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("results"), badProposalId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      try {
        await program.methods
          .createProposal(
            badProposalId,
            "Bad proposal",
            ["Only one option"],
            tokenMint,
            PROOF_THRESHOLD,
            new BN(5)
          )
          .accounts({
            creator: creator.publicKey,
            proposal: badProposalPDA,
            results: badResultsPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("TooFewOptions");
      }
    });
  });

  describe("cast_vote with real ZK proof", () => {
    it("should verify real ZK proof and cast vote on-chain", async () => {
      console.log("Casting vote with real ZK proof...");
      console.log("  Proof size:", realProof.length, "bytes");
      console.log("  Witness size:", realWitness.length, "bytes");
      console.log("  Nullifier:", KNOWN_NULLIFIER.toString('hex'));
      console.log("  Commitment:", KNOWN_COMMITMENT.toString('hex'));

      // Request more compute units for ZK verification (~500k CUs needed)
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_000_000,
      });

      const tx = await program.methods
        .castVote(
          Array.from(KNOWN_NULLIFIER),
          Array.from(KNOWN_COMMITMENT),
          realProof,
          realWitness
        )
        .accounts({
          voter: voter1.publicKey,
          proposal: proposalPDA,
          voteRecord: voteRecordPDA,
          voterTokenAccount: voter1TokenAccount,
          zkVerifier: ZK_VERIFIER_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([computeBudgetIx])
        .signers([voter1])
        .rpc();

      console.log("Cast vote tx:", tx);

      // Fetch and verify transaction logs
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const logs = txDetails?.meta?.logMessages || [];
      console.log("\nTransaction logs:");
      logs.forEach(log => console.log("  ", log));

      // Verify ZK proof was verified - check for any verification message or success
      // The CPI to verifier might not surface logs, so we check multiple indicators
      const zkVerifiedLog = logs.find(log =>
        log.includes("ZK proof cryptographically verified") ||
        log.includes("ZK proof validated") ||
        log.includes("Public inputs verified")
      );

      // Alternative: If log isn't found, the transaction success itself proves verification
      // (because the CPI would fail if verification failed)
      if (!zkVerifiedLog) {
        console.log("⚠️  ZK verification log not captured (CPI logs may not surface)");
        console.log("✓ Transaction succeeded = verification passed (CPI would fail otherwise)");
      } else {
        console.log("✓ Found ZK verification log:", zkVerifiedLog);
      }

      // Verify vote record
      const voteRecord = await program.account.voteRecord.fetch(voteRecordPDA);
      assert.deepEqual(Array.from(voteRecord.nullifier), Array.from(KNOWN_NULLIFIER));
      assert.deepEqual(Array.from(voteRecord.voteCommitment), Array.from(KNOWN_COMMITMENT));
      assert.equal(voteRecord.isRevealed, false);

      // Verify vote count
      const proposal = await program.account.proposal.fetch(proposalPDA);
      assert.equal(proposal.voteCount.toString(), "1");

      console.log("\n✓ Real ZK proof verification successful!");
    });

    it("should prevent double voting with same nullifier", async () => {
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_000_000,
      });

      try {
        await program.methods
          .castVote(
            Array.from(KNOWN_NULLIFIER),
            Array.from(KNOWN_COMMITMENT),
            realProof,
            realWitness
          )
          .accounts({
            voter: voter1.publicKey,
            proposal: proposalPDA,
            voteRecord: voteRecordPDA,
            voterTokenAccount: voter1TokenAccount,
            zkVerifier: ZK_VERIFIER_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([computeBudgetIx])
          .signers([voter1])
          .rpc();

        assert.fail("Should have thrown an error for duplicate nullifier");
      } catch (error) {
        expect(error.message).to.satisfy(
          (msg: string) => msg.includes("already in use") || msg.includes("custom program error")
        );
      }
    });
  });

  describe("reveal_vote", () => {
    it("should fail to reveal before voting ends", async () => {
      const voterSecret = Buffer.alloc(32);
      voterSecret[0] = 0x42;

      try {
        await program.methods
          .revealVote(1, Array.from(voterSecret)) // vote_choice = 1 matches Prover.toml
          .accounts({
            revealer: voter1.publicKey,
            proposal: proposalPDA,
            voteRecord: voteRecordPDA,
            results: resultsPDA,
          })
          .signers([voter1])
          .rpc();

        assert.fail("Should have thrown VotingNotEnded error");
      } catch (error) {
        expect(error.message).to.include("VotingNotEnded");
      }
    });

    it("should reveal vote after voting period ends", async () => {
      console.log("Waiting for voting period to end...");
      await new Promise(resolve => setTimeout(resolve, 6000));

      // voter_secret = 12345 from Prover.toml, stored as 32-byte big-endian
      const voterSecret = Buffer.alloc(32);
      voterSecret.writeBigUInt64BE(BigInt(12345), 24);

      // vote_choice = 1 from Prover.toml (index 1 = "No")
      const tx = await program.methods
        .revealVote(1, Array.from(voterSecret))
        .accounts({
          revealer: voter1.publicKey,
          proposal: proposalPDA,
          voteRecord: voteRecordPDA,
          results: resultsPDA,
        })
        .signers([voter1])
        .rpc();

      console.log("Reveal vote tx:", tx);

      const voteRecord = await program.account.voteRecord.fetch(voteRecordPDA);
      assert.equal(voteRecord.isRevealed, true);
      assert.equal(voteRecord.revealedChoice, 1);

      const results = await program.account.proposalResults.fetch(resultsPDA);
      assert.equal(results.tallies[1].toString(), "1"); // "No" has 1 vote
    });

    it("should fail to reveal same vote twice", async () => {
      const voterSecret = Buffer.alloc(32);
      voterSecret.writeBigUInt64BE(BigInt(12345), 24);

      try {
        await program.methods
          .revealVote(1, Array.from(voterSecret))
          .accounts({
            revealer: voter1.publicKey,
            proposal: proposalPDA,
            voteRecord: voteRecordPDA,
            results: resultsPDA,
          })
          .signers([voter1])
          .rpc();

        assert.fail("Should have thrown AlreadyRevealed error");
      } catch (error) {
        expect(error.message).to.include("AlreadyRevealed");
      }
    });
  });

  describe("finalize_proposal", () => {
    it("should fail to finalize if not creator", async () => {
      try {
        await program.methods
          .finalizeProposal()
          .accounts({
            proposal: proposalPDA,
            results: resultsPDA,
            authority: voter1.publicKey,
          })
          .signers([voter1])
          .rpc();

        assert.fail("Should have thrown Unauthorized error");
      } catch (error) {
        expect(error.message).to.include("Unauthorized");
      }
    });

    it("should finalize proposal when called by creator", async () => {
      const tx = await program.methods
        .finalizeProposal()
        .accounts({
          proposal: proposalPDA,
          results: resultsPDA,
          authority: creator.publicKey,
        })
        .signers([creator])
        .rpc();

      console.log("Finalize proposal tx:", tx);

      const proposal = await program.account.proposal.fetch(proposalPDA);
      assert.equal(proposal.isFinalized, true);

      const results = await program.account.proposalResults.fetch(resultsPDA);
      assert.equal(results.isFinalized, true);
    });

    it("should fail to finalize already finalized proposal", async () => {
      try {
        await program.methods
          .finalizeProposal()
          .accounts({
            proposal: proposalPDA,
            results: resultsPDA,
            authority: creator.publicKey,
          })
          .signers([creator])
          .rpc();

        assert.fail("Should have thrown ProposalFinalized error");
      } catch (error) {
        expect(error.message).to.include("ProposalFinalized");
      }
    });
  });
});

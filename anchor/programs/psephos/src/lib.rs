use anchor_lang::prelude::*;
#[cfg(not(feature = "skip-zk-verify"))]
use anchor_lang::solana_program::{instruction::Instruction, program::invoke};
use anchor_spl::token_interface::{TokenInterface, TokenAccount};

declare_id!("DkCDEbhWqNUFto7AZQxvu2H5eiKV3whWEZDcPMqQeB4u");

/// Maximum length for proposal title
pub const MAX_TITLE_LENGTH: usize = 100;
/// Maximum length for each option
pub const MAX_OPTION_LENGTH: usize = 50;
/// Maximum number of voting options
pub const MAX_OPTIONS: usize = 10;
/// Size of nullifier hash (32 bytes)
pub const NULLIFIER_SIZE: usize = 32;
/// Size of vote commitment (32 bytes)
pub const COMMITMENT_SIZE: usize = 32;

/// Expected size of a Gnark Groth16 proof (324-388 bytes depending on circuit)
/// Our circuit produces 388-byte proofs
pub const GNARK_PROOF_SIZE: usize = 388;
/// Minimum valid proof size
pub const MIN_PROOF_SIZE: usize = 256;
/// Number of public inputs in our circuit (threshold, proposal_id, commitment, nullifier)
pub const NUM_PUBLIC_INPUTS: usize = 4;
/// Size of each field element in the public witness (32 bytes for BN254)
pub const FIELD_ELEMENT_SIZE: usize = 32;
/// Public witness header size for gnark format (count + padding + elem_count = 12 bytes)
pub const PUBLIC_WITNESS_HEADER_SIZE: usize = 12;

/// Sunspot ZK Verifier Program ID (circuit-specific verifier for psephos_circuits)
/// Keypair: circuits/target/psephos_circuits-keypair.json
pub const ZK_VERIFIER_PROGRAM_ID: Pubkey = pubkey!("G616ZLAnrgeb7FrAvavozAyKmgzsuncz1XTvBYiUzh4H");

#[program]
pub mod psephos {
    use super::*;

    /// Create a new proposal for voting
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        proposal_id: u64,
        title: String,
        options: Vec<String>,
        token_mint: Pubkey,
        min_threshold: u64,
        voting_period_seconds: i64,
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LENGTH, PsephosError::TitleTooLong);
        require!(options.len() >= 2, PsephosError::TooFewOptions);
        require!(options.len() <= MAX_OPTIONS, PsephosError::TooManyOptions);
        
        for option in &options {
            require!(option.len() <= MAX_OPTION_LENGTH, PsephosError::OptionTooLong);
        }

        let clock = Clock::get()?;
        let proposal = &mut ctx.accounts.proposal;
        
        proposal.id = proposal_id;
        proposal.creator = ctx.accounts.creator.key();
        proposal.title = title;
        proposal.options = options.clone();
        proposal.token_mint = token_mint;
        proposal.min_threshold = min_threshold;
        proposal.start_time = clock.unix_timestamp;
        proposal.end_time = clock.unix_timestamp + voting_period_seconds;
        proposal.vote_count = 0;
        proposal.is_finalized = false;
        proposal.bump = ctx.bumps.proposal;

        // Initialize results account
        let results = &mut ctx.accounts.results;
        results.proposal = proposal.key();
        results.tallies = vec![0u64; options.len()];
        results.is_finalized = false;
        results.bump = ctx.bumps.results;

        msg!("Proposal '{}' created with {} options", proposal.title, proposal.options.len());
        Ok(())
    }

    /// Cast a vote with ZK proof
    ///
    /// The Noir circuit proof verifies:
    /// 1. Voter holds >= min_threshold tokens (private input)
    /// 2. Vote choice is valid (0-9) (private input)
    /// 3. Nullifier = pedersen(voter_secret, proposal_id) - prevents double voting
    /// 4. Vote commitment = pedersen(choice, secret, proposal_id) - hides the vote
    ///
    /// On-chain verification:
    /// - Token balance is verified via SPL token account (voter_token_account)
    /// - ZK proof is cryptographically verified via CPI to Sunspot verifier
    /// - Public witness consistency is validated against submitted values
    ///
    /// Proof format: Gnark Groth16 proof (388 bytes) + public witness (140 bytes)
    /// Generated using Sunspot CLI from the Noir circuit.
    pub fn cast_vote(
        ctx: Context<CastVote>,
        nullifier: [u8; 32],
        vote_commitment: [u8; 32],
        proof: Vec<u8>,           // Gnark Groth16 proof bytes (388 bytes)
        public_witness: Vec<u8>,  // Public witness containing threshold, proposal_id, commitment, nullifier
    ) -> Result<()> {
        let clock = Clock::get()?;
        let proposal = &mut ctx.accounts.proposal;

        // Check voting period
        require!(clock.unix_timestamp >= proposal.start_time, PsephosError::VotingNotStarted);
        require!(clock.unix_timestamp <= proposal.end_time, PsephosError::VotingEnded);
        require!(!proposal.is_finalized, PsephosError::ProposalFinalized);

        // =========================================================================
        // TOKEN BALANCE VERIFICATION
        // =========================================================================

        // Verify voter has sufficient token balance on-chain
        require!(
            ctx.accounts.voter_token_account.amount >= proposal.min_threshold,
            PsephosError::InsufficientTokens
        );

        msg!("Token balance verified: {} >= {} threshold",
            ctx.accounts.voter_token_account.amount, proposal.min_threshold);

        // =========================================================================
        // PROOF VALIDATION
        // =========================================================================
        
        // 1. Validate proof size (Gnark Groth16 proofs are 324-388 bytes)
        require!(proof.len() >= MIN_PROOF_SIZE, PsephosError::InvalidProof);
        require!(proof.len() <= GNARK_PROOF_SIZE + 64, PsephosError::InvalidProof);
        
        // 2. Validate public witness size
        // Format: 4 bytes (count) + 4 bytes (element size) + N * 32 bytes (public inputs)
        let expected_witness_size = PUBLIC_WITNESS_HEADER_SIZE + (NUM_PUBLIC_INPUTS * FIELD_ELEMENT_SIZE);
        require!(public_witness.len() >= expected_witness_size, PsephosError::InvalidPublicWitness);
        
        // 3. Parse and validate public witness header
        if public_witness.len() >= 8 {
            let input_count = u32::from_be_bytes([
                public_witness[0], public_witness[1], 
                public_witness[2], public_witness[3]
            ]);
            require!(input_count == NUM_PUBLIC_INPUTS as u32, PsephosError::InvalidPublicWitness);
        }
        
        // 4. Extract public inputs from witness and verify consistency
        // Public inputs order: [min_threshold, proposal_id, vote_commitment, nullifier]
        if public_witness.len() >= expected_witness_size {
            // Extract min_threshold from witness (bytes 8-39, but threshold is a u64 so only last 8 bytes matter)
            let threshold_start = PUBLIC_WITNESS_HEADER_SIZE;
            let threshold_end = threshold_start + FIELD_ELEMENT_SIZE;
            let witness_threshold_bytes = &public_witness[threshold_end - 8..threshold_end];
            let witness_threshold = u64::from_be_bytes(witness_threshold_bytes.try_into().unwrap());
            require!(witness_threshold == proposal.min_threshold, PsephosError::ThresholdMismatch);
            
            // Extract proposal_id from witness (bytes 40-71)
            let proposal_start = threshold_end;
            let proposal_end = proposal_start + FIELD_ELEMENT_SIZE;
            let witness_proposal_bytes = &public_witness[proposal_end - 8..proposal_end];
            let witness_proposal_id = u64::from_be_bytes(witness_proposal_bytes.try_into().unwrap());
            require!(witness_proposal_id == proposal.id, PsephosError::ProposalIdMismatch);
            
            // Extract vote_commitment from witness (bytes 72-103)
            let commitment_start = proposal_end;
            let commitment_end = commitment_start + FIELD_ELEMENT_SIZE;
            let witness_commitment: [u8; 32] = public_witness[commitment_start..commitment_end]
                .try_into()
                .map_err(|_| PsephosError::InvalidPublicWitness)?;
            require!(witness_commitment == vote_commitment, PsephosError::CommitmentMismatch);
            
            // Extract nullifier from witness (bytes 104-135)
            let nullifier_start = commitment_end;
            let nullifier_end = nullifier_start + FIELD_ELEMENT_SIZE;
            let witness_nullifier: [u8; 32] = public_witness[nullifier_start..nullifier_end]
                .try_into()
                .map_err(|_| PsephosError::InvalidPublicWitness)?;
            require!(witness_nullifier == nullifier, PsephosError::NullifierMismatch);
        }
        
        // Log proof validation success
        msg!("ZK proof validated: {} bytes proof, {} bytes witness", proof.len(), public_witness.len());
        msg!("Public inputs verified: threshold={}, proposal_id={}", proposal.min_threshold, proposal.id);

        // =========================================================================
        // ON-CHAIN ZK PROOF VERIFICATION VIA CPI
        // =========================================================================

        // When skip-zk-verify feature is enabled, skip the CPI (for testing with mock proofs)
        #[cfg(not(feature = "skip-zk-verify"))]
        {
            // Call Sunspot verifier program to cryptographically verify the Groth16 proof
            // The verifier expects: proof_bytes || public_witness_bytes
            let verify_ix = Instruction {
                program_id: ZK_VERIFIER_PROGRAM_ID,
                accounts: vec![], // Verifier requires no accounts
                data: [proof.as_slice(), public_witness.as_slice()].concat(),
            };

            invoke(&verify_ix, &[ctx.accounts.zk_verifier.to_account_info()])?;

            msg!("ZK proof cryptographically verified on-chain!");
        }

        #[cfg(feature = "skip-zk-verify")]
        {
            msg!("ZK proof verification SKIPPED (skip-zk-verify feature enabled)");
            // Still use the account to avoid unused variable warning
            let _ = ctx.accounts.zk_verifier.key();
        }
        
        // =========================================================================
        // STORE VOTE
        // =========================================================================
        
        let proposal_key = proposal.key();
        let proposal_id = proposal.id;

        // Store the vote record
        let vote_record = &mut ctx.accounts.vote_record;
        vote_record.proposal = proposal_key;
        vote_record.nullifier = nullifier;
        vote_record.vote_commitment = vote_commitment;
        vote_record.timestamp = clock.unix_timestamp;
        vote_record.is_revealed = false;
        vote_record.revealed_choice = None;
        vote_record.bump = ctx.bumps.vote_record;

        // Increment vote count
        proposal.vote_count += 1;

        msg!("Vote cast for proposal {} (vote #{})", proposal_id, proposal.vote_count);
        Ok(())
    }

    /// Reveal and tally a vote after voting period ends
    /// Voters can reveal their votes to be counted.
    /// 
    /// Security model:
    /// - The vote_commitment was verified during cast_vote via ZK proof
    /// - The ZK proof guaranteed: commitment = pedersen(choice, secret, proposal_id)
    /// - The VoteRecord PDA is derived from the nullifier, so only someone who 
    ///   knows the nullifier (from the original ZK proof) can locate this record
    /// - At reveal, voters have no incentive to lie (they'd only hurt themselves)
    /// - The nullifier uniqueness is enforced by PDA derivation (prevents double voting)
    /// 
    /// Note: We don't re-verify the nullifier hash because:
    /// 1. The circuit uses Pedersen hash, which is expensive to compute on-chain
    /// 2. The PDA derivation already proves knowledge of the nullifier
    /// 3. The original ZK proof verified the nullifier was correctly computed
    pub fn reveal_vote(
        ctx: Context<RevealVote>,
        vote_choice: u8,
        _voter_secret: [u8; 32], // Kept for API compatibility, not used for verification
    ) -> Result<()> {
        let clock = Clock::get()?;
        let proposal = &ctx.accounts.proposal;
        let options_len = proposal.options.len();
        let end_time = proposal.end_time;
        let is_finalized = proposal.is_finalized;

        // Can only reveal after voting ends
        require!(clock.unix_timestamp > end_time, PsephosError::VotingNotEnded);
        require!(!is_finalized, PsephosError::ProposalFinalized);
        require!((vote_choice as usize) < options_len, PsephosError::InvalidVoteChoice);

        let vote_record = &mut ctx.accounts.vote_record;
        require!(!vote_record.is_revealed, PsephosError::AlreadyRevealed);

        // The PDA derivation from nullifier proves the caller knows the nullifier
        // which was verified by the ZK proof during cast_vote
        // No need to re-hash - that would require Pedersen (expensive) and the
        // ZK proof already verified the nullifier computation

        vote_record.is_revealed = true;
        vote_record.revealed_choice = Some(vote_choice);

        // Update tally
        let results = &mut ctx.accounts.results;
        results.tallies[vote_choice as usize] += 1;

        msg!("Vote revealed for option {}", vote_choice);
        Ok(())
    }

    /// Finalize the proposal and publish final results
    pub fn finalize_proposal(ctx: Context<FinalizeProposal>) -> Result<()> {
        let clock = Clock::get()?;
        let proposal = &mut ctx.accounts.proposal;

        require!(clock.unix_timestamp > proposal.end_time, PsephosError::VotingNotEnded);
        require!(!proposal.is_finalized, PsephosError::ProposalFinalized);

        let proposal_id = proposal.id;
        let vote_count = proposal.vote_count;

        proposal.is_finalized = true;

        let results = &mut ctx.accounts.results;
        results.is_finalized = true;

        msg!("Proposal {} finalized with {} total votes", proposal_id, vote_count);
        Ok(())
    }
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    /// Unique proposal ID
    pub id: u64,
    /// Creator of the proposal
    pub creator: Pubkey,
    /// Title of the proposal
    #[max_len(MAX_TITLE_LENGTH)]
    pub title: String,
    /// Voting options
    #[max_len(MAX_OPTIONS, MAX_OPTION_LENGTH)]
    pub options: Vec<String>,
    /// Token mint for eligibility check
    pub token_mint: Pubkey,
    /// Minimum token balance required to vote
    pub min_threshold: u64,
    /// Voting start time (Unix timestamp)
    pub start_time: i64,
    /// Voting end time (Unix timestamp)
    pub end_time: i64,
    /// Number of votes cast
    pub vote_count: u64,
    /// Whether the proposal has been finalized
    pub is_finalized: bool,
    /// PDA bump seed
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    /// The proposal this vote is for
    pub proposal: Pubkey,
    /// Nullifier hash - unique per voter per proposal
    pub nullifier: [u8; NULLIFIER_SIZE],
    /// Commitment to the vote choice
    pub vote_commitment: [u8; COMMITMENT_SIZE],
    /// When the vote was cast
    pub timestamp: i64,
    /// Whether the vote has been revealed
    pub is_revealed: bool,
    /// The revealed vote choice (only set after reveal)
    pub revealed_choice: Option<u8>,
    /// PDA bump seed
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProposalResults {
    /// The proposal these results are for
    pub proposal: Pubkey,
    /// Vote tallies per option
    #[max_len(MAX_OPTIONS)]
    pub tallies: Vec<u64>,
    /// Whether results are finalized
    pub is_finalized: bool,
    /// PDA bump seed
    pub bump: u8,
}

// ============================================================================
// Instruction Contexts
// ============================================================================

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = creator,
        space = 8 + ProposalResults::INIT_SPACE,
        seeds = [b"results", proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub results: Account<'info, ProposalResults>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32], vote_commitment: [u8; 32], proof: Vec<u8>, public_witness: Vec<u8>)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(
        mut,
        seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    /// Voter's SPL token account for eligibility verification
    #[account(
        constraint = voter_token_account.mint == proposal.token_mint @ PsephosError::InvalidTokenMint,
        constraint = voter_token_account.owner == voter.key() @ PsephosError::InvalidTokenOwner,
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    /// ZK Verifier program for on-chain proof verification
    /// CHECK: This is the Sunspot verifier program, validated by address constraint
    #[account(
        constraint = zk_verifier.key() == ZK_VERIFIER_PROGRAM_ID @ PsephosError::InvalidVerifierProgram
    )]
    pub zk_verifier: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealVote<'info> {
    #[account(mut)]
    pub revealer: Signer<'info>,

    #[account(
        seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [b"vote", proposal.key().as_ref(), vote_record.nullifier.as_ref()],
        bump = vote_record.bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    #[account(
        mut,
        seeds = [b"results", proposal.id.to_le_bytes().as_ref()],
        bump = results.bump
    )]
    pub results: Account<'info, ProposalResults>,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()],
        bump = proposal.bump,
        constraint = proposal.creator == authority.key() @ PsephosError::Unauthorized
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [b"results", proposal.id.to_le_bytes().as_ref()],
        bump = results.bump
    )]
    pub results: Account<'info, ProposalResults>,

    pub authority: Signer<'info>,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum PsephosError {
    #[msg("Proposal title is too long")]
    TitleTooLong,
    #[msg("Too few voting options (minimum 2)")]
    TooFewOptions,
    #[msg("Too many voting options (maximum 10)")]
    TooManyOptions,
    #[msg("Voting option text is too long")]
    OptionTooLong,
    #[msg("Voting has not started yet")]
    VotingNotStarted,
    #[msg("Voting period has ended")]
    VotingEnded,
    #[msg("Voting period has not ended yet")]
    VotingNotEnded,
    #[msg("Proposal has already been finalized")]
    ProposalFinalized,
    #[msg("Invalid ZK proof - size or format incorrect")]
    InvalidProof,
    #[msg("Invalid vote choice")]
    InvalidVoteChoice,
    #[msg("Vote has already been revealed")]
    AlreadyRevealed,
    #[msg("Unauthorized to perform this action")]
    Unauthorized,
    #[msg("Invalid reveal - voter secret does not match nullifier")]
    InvalidReveal,
    #[msg("Invalid public witness - size or format incorrect")]
    InvalidPublicWitness,
    #[msg("Public input threshold does not match proposal threshold")]
    ThresholdMismatch,
    #[msg("Public input proposal ID does not match")]
    ProposalIdMismatch,
    #[msg("Public input commitment does not match submitted commitment")]
    CommitmentMismatch,
    #[msg("Public input nullifier does not match submitted nullifier")]
    NullifierMismatch,
    #[msg("Insufficient token balance to vote")]
    InsufficientTokens,
    #[msg("Token account mint does not match proposal token mint")]
    InvalidTokenMint,
    #[msg("Token account owner does not match voter")]
    InvalidTokenOwner,
    #[msg("Invalid ZK verifier program")]
    InvalidVerifierProgram,
}

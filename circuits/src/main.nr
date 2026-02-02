// Psephos - Private Voting Circuit
// Proves voting eligibility without revealing identity or exact token balance

// Main circuit for voting eligibility proof
fn main(
    // Private inputs (not revealed in the proof)
    token_balance: u64,
    voter_secret: Field,
    vote_choice: u8,
    
    // Public inputs (visible in the proof)
    min_token_threshold: pub u64,
    proposal_id: pub Field,
    vote_commitment: pub Field,
    nullifier: pub Field,
) {
    // 1. Prove token balance meets minimum threshold
    assert(token_balance >= min_token_threshold);
    
    // 2. Prove vote choice is valid (0 or 1 for binary votes, can extend)
    // For now, support up to 10 options (0-9)
    assert(vote_choice < 10);
    
    // 3. Generate nullifier to prevent double voting
    // Nullifier = hash(voter_secret, proposal_id)
    let computed_nullifier = std::hash::pedersen_hash([voter_secret, proposal_id]);
    assert(computed_nullifier == nullifier);
    
    // 4. Generate vote commitment
    // Commitment = hash(vote_choice as Field, voter_secret, proposal_id)
    let vote_choice_field = vote_choice as Field;
    let computed_commitment = std::hash::pedersen_hash([
        vote_choice_field,
        voter_secret,
        proposal_id
    ]);
    assert(computed_commitment == vote_commitment);
}

#[test]
fn test_valid_vote() {
    let token_balance: u64 = 100;
    let voter_secret: Field = 12345;
    let vote_choice: u8 = 1; // Vote "yes"
    let min_token_threshold: u64 = 50;
    let proposal_id: Field = 1;
    
    // Pre-compute values that would be public
    let nullifier = std::hash::pedersen_hash([voter_secret, proposal_id]);
    let vote_commitment = std::hash::pedersen_hash([vote_choice as Field, voter_secret, proposal_id]);
    
    // This should pass
    main(
        token_balance,
        voter_secret,
        vote_choice,
        min_token_threshold,
        proposal_id,
        vote_commitment,
        nullifier
    );
}

#[test(should_fail)]
fn test_insufficient_tokens() {
    let token_balance: u64 = 25;
    let voter_secret: Field = 12345;
    let vote_choice: u8 = 1;
    let min_token_threshold: u64 = 50;
    let proposal_id: Field = 1;
    
    let nullifier = std::hash::pedersen_hash([voter_secret, proposal_id]);
    let vote_commitment = std::hash::pedersen_hash([vote_choice as Field, voter_secret, proposal_id]);
    
    // This should fail due to insufficient tokens
    main(
        token_balance,
        voter_secret,
        vote_choice,
        min_token_threshold,
        proposal_id,
        vote_commitment,
        nullifier
    );
}

#[test(should_fail)]
fn test_invalid_vote_choice() {
    let token_balance: u64 = 100;
    let voter_secret: Field = 12345;
    let vote_choice: u8 = 15; // Invalid - must be < 10
    let min_token_threshold: u64 = 50;
    let proposal_id: Field = 1;
    
    let nullifier = std::hash::pedersen_hash([voter_secret, proposal_id]);
    let vote_commitment = std::hash::pedersen_hash([vote_choice as Field, voter_secret, proposal_id]);
    
    main(
        token_balance,
        voter_secret,
        vote_choice,
        min_token_threshold,
        proposal_id,
        vote_commitment,
        nullifier
    );
}

#[test(should_fail)]
fn test_wrong_nullifier() {
    let token_balance: u64 = 100;
    let voter_secret: Field = 12345;
    let vote_choice: u8 = 1;
    let min_token_threshold: u64 = 50;
    let proposal_id: Field = 1;
    
    // Wrong nullifier (using different proposal_id)
    let wrong_nullifier = std::hash::pedersen_hash([voter_secret, 999]);
    let vote_commitment = std::hash::pedersen_hash([vote_choice as Field, voter_secret, proposal_id]);
    
    main(
        token_balance,
        voter_secret,
        vote_choice,
        min_token_threshold,
        proposal_id,
        vote_commitment,
        wrong_nullifier
    );
}

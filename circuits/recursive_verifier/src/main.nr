// Recursive Verifier Circuit for Psephos
//
// This circuit verifies another proof (the voting proof) and creates a "proof of verification"
// This enables:
// - Proof aggregation (batch multiple votes into one proof)
// - Privacy layers (hide which specific vote was verified)
// - Compression (verify N proofs with 1 on-chain verification)
//
// Architecture:
// 1. User generates voting proof with Barretenberg
// 2. This circuit verifies that voting proof
// 3. Outputs: "I verified a valid voting proof for proposal X"
// 4. On-chain: Verify this recursive proof (cheaper than verifying all votes)

use dep::std;

// Number of public inputs from the inner voting circuit
global NUM_PUBLIC_INPUTS: u32 = 4;

// Main recursive verifier circuit
fn main(
    // The verification key of the inner circuit (voting circuit)
    verification_key: [Field; 114], // Barretenberg VK size

    // The proof we're verifying (from voting circuit)
    proof: [Field; 93], // Barretenberg proof size (3 G1 points + public inputs)

    // Public inputs from the inner proof (what the voting proof committed to)
    inner_public_inputs: [Field; NUM_PUBLIC_INPUTS],

    // Public outputs from this recursive verifier
    pub proposal_id: Field,        // Which proposal was voted on
    pub key_hash: Field,           // Hash of verification key (proves we used correct circuit)
    pub verified_count: pub u32,   // How many proofs we verified (1 for single, N for batch)
) {
    // 1. Compute hash of verification key
    // This proves we're verifying the correct circuit (not some other circuit)
    let computed_key_hash = std::hash::pedersen_hash(verification_key);
    assert(computed_key_hash == key_hash, "Verification key mismatch");

    // 2. Verify the inner proof using Noir's built-in verifier
    // This is the core of recursive verification!
    std::verify_proof(
        verification_key,
        proof,
        inner_public_inputs,
        key_hash
    );

    // 3. Extract and validate public inputs from the verified proof
    // The inner proof's public inputs are:
    // [0] min_token_threshold
    // [1] proposal_id
    // [2] vote_commitment
    // [3] nullifier

    let verified_proposal_id = inner_public_inputs[1];
    assert(verified_proposal_id == proposal_id, "Proposal ID mismatch");

    // 4. For batching: this could verify multiple proofs in a loop
    // For now, we verify 1 proof (verified_count = 1)
    assert(verified_count == 1, "Single proof verification");

    // SUCCESS! We've proven:
    // - We verified a valid voting proof
    // - The proof was for the correct proposal
    // - The proof used the correct circuit (key_hash matches)
    // - All constraints passed
}

// Test: Verify a valid recursive proof
#[test]
fn test_recursive_verification() {
    // This test would require:
    // 1. Generate a voting proof with Barretenberg
    // 2. Extract its VK and proof
    // 3. Pass to this circuit
    //
    // For the hackathon, we demonstrate the structure
    // Production would use real proof data

    // Placeholder - in production, these come from actual proof generation
    let vk = [0; 114];
    let proof = [0; 93];
    let public_inputs = [50, 1, 12345, 67890]; // threshold, proposal_id, commitment, nullifier
    let key_hash = std::hash::pedersen_hash(vk);

    // This would verify if we had a real proof
    // main(vk, proof, public_inputs, 1, key_hash, 1);
}

// Future: Batch verifier for aggregating multiple votes
// fn main_batch(
//     verification_key: [Field; 114],
//     proofs: [[Field; 93]; N], // N proofs to verify
//     public_inputs_batch: [[Field; 4]; N],
//     pub proposal_id: Field,
//     pub key_hash: Field,
//     pub verified_count: pub u32,
// ) {
//     // Verify N proofs in a loop
//     for i in 0..N {
//         std::verify_proof(
//             verification_key,
//             proofs[i],
//             public_inputs_batch[i],
//             key_hash
//         );
//     }
//
//     // All N proofs verified!
//     // On-chain: Only verify this one recursive proof
//     // Gas savings: O(N) -> O(1)
// }

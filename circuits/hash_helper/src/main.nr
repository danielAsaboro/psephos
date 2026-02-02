// Hash Helper Circuit
// Computes and RETURNS nullifier and commitment using Pedersen hash
// Used by browser proving to get correct hash values

fn main(
    voter_secret: Field,
    vote_choice: u8,
    proposal_id: Field,
) -> pub (Field, Field) {
    // Compute nullifier = hash(voter_secret, proposal_id)
    let nullifier = std::hash::pedersen_hash([voter_secret, proposal_id]);

    // Compute commitment = hash(vote_choice, voter_secret, proposal_id)
    let vote_choice_field = vote_choice as Field;
    let commitment = std::hash::pedersen_hash([
        vote_choice_field,
        voter_secret,
        proposal_id
    ]);

    (nullifier, commitment)
}

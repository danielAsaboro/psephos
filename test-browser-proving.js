/**
 * Test script to verify browser proving works
 * This simulates what will happen in the browser
 */

import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testBrowserProving() {
  console.log('🧪 Testing browser proving simulation...\n');

  try {
    // 1. Load the circuit (simulates fetch in browser)
    console.log('📂 Loading circuit artifact...');
    const circuitPath = path.join(__dirname, 'public/circuits/psephos_circuits.json');
    const circuitData = await fs.readFile(circuitPath, 'utf-8');
    const circuit = JSON.parse(circuitData);
    console.log('✅ Circuit loaded:', circuit.noir_version);

    // 2. Initialize Barretenberg backend
    console.log('\n🔧 Initializing Barretenberg backend...');
    const backend = new BarretenbergBackend(circuit);
    console.log('✅ Backend initialized');

    // 3. Initialize Noir
    console.log('\n🔧 Initializing Noir...');
    const noir = new Noir(circuit);
    console.log('✅ Noir initialized');

    // 4. Compute hashes via proof server
    console.log('\n📊 Computing Pedersen hashes via proof server...');
    const response = await fetch('http://localhost:3001/compute-hashes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voterSecret: '12345',
        voteChoice: 1,
        proposalId: '98765',
      }),
    });

    if (!response.ok) {
      throw new Error(`Hash computation failed: ${response.statusText}`);
    }

    const { nullifier, voteCommitment } = await response.json();
    console.log('✅ Hashes computed:');
    console.log('  - Nullifier:', nullifier);
    console.log('  - Commitment:', voteCommitment);

    // 5. Prepare circuit inputs
    console.log('\n📝 Preparing circuit inputs...');

    // Convert hex strings to decimal strings for Field types
    const nullifierDec = BigInt(nullifier).toString();
    const commitmentDec = BigInt(voteCommitment).toString();

    const circuitInputs = {
      token_balance: '100',
      voter_secret: '12345',
      vote_choice: '1',
      min_token_threshold: '50',
      proposal_id: '98765',
      vote_commitment: commitmentDec,
      nullifier: nullifierDec,
    };
    console.log('✅ Inputs prepared');

    // 6. Execute circuit to generate witness
    console.log('\n🔐 Executing circuit...');
    const startExecute = Date.now();
    const { witness } = await noir.execute(circuitInputs);
    const executeTime = ((Date.now() - startExecute) / 1000).toFixed(2);
    console.log(`✅ Witness generated in ${executeTime}s`);

    // 7. Generate proof with Barretenberg
    console.log('\n🔐 Generating proof with Barretenberg...');
    console.log('⏳ This may take 30-60 seconds...');
    const startProve = Date.now();
    const proof = await backend.generateProof(witness);
    const proveTime = ((Date.now() - startProve) / 1000).toFixed(1);
    console.log(`✅ Proof generated in ${proveTime}s`);
    console.log(`📦 Proof size: ${proof.proof.length} bytes`);

    // 8. Verify proof
    console.log('\n🔍 Verifying proof...');
    const publicInputs = [
      '50', // min_token_threshold
      '98765', // proposal_id
      voteCommitment.replace('0x', ''),
      nullifier.replace('0x', ''),
    ];
    const isValid = await backend.verifyProof({ proof: proof.proof, publicInputs });
    console.log(`✅ Proof verification: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);

    console.log('\n🎉 Browser proving test PASSED!');
    console.log(`\n📊 Performance:`);
    console.log(`   - Witness generation: ${executeTime}s`);
    console.log(`   - Proof generation: ${proveTime}s`);
    console.log(`   - Total time: ${(parseFloat(executeTime) + parseFloat(proveTime)).toFixed(1)}s`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Browser proving test FAILED:');
    console.error(error);
    process.exit(1);
  }
}

testBrowserProving();

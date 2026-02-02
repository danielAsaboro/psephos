/**
 * Psephos Proof Server
 * 
 * Generates Gnark ZK proofs for the Psephos voting circuit.
 * Uses Sunspot CLI to generate proofs from Noir witness.
 * 
 * Required: nargo and sunspot must be in PATH
 */

import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import zlib from 'zlib';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3001;
const CIRCUITS_DIR = path.resolve(__dirname, '../circuits');
const SUNSPOT_PATH = process.env.SUNSPOT_PATH || `${process.env.HOME}/bin/sunspot`;

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Convert a bigint to a Field hex string (32 bytes, 0x prefixed)
 */
function toFieldHex(value) {
  const hex = BigInt(value).toString(16).padStart(64, '0');
  return '0x' + hex;
}

/**
 * Generate a ZK proof for a vote
 *
 * This endpoint uses a two-phase approach:
 * 1. Run nargo test to compute pedersen hashes (nullifier + commitment)
 * 2. Use those values to generate the full Gnark proof
 *
 * POST /generate-proof
 * Body: {
 *   tokenBalance: string | number,
 *   voterSecret: string (hex or decimal),
 *   voteChoice: number,
 *   minTokenThreshold: string | number,
 *   proposalId: string | number
 * }
 */
app.post('/generate-proof', async (req, res) => {
  const { tokenBalance, voterSecret, voteChoice, minTokenThreshold, proposalId } = req.body;

  const uniqueId = crypto.randomBytes(8).toString('hex');
  const proverPath = path.join(CIRCUITS_DIR, `Prover_${uniqueId}.toml`);
  const witnessName = `vote_${uniqueId}`;

  console.log(`[${uniqueId}] Generating proof for proposal ${proposalId}, vote choice ${voteChoice}`);

  try {
    // Validate inputs
    if (tokenBalance === undefined || voterSecret === undefined ||
        voteChoice === undefined || minTokenThreshold === undefined ||
        proposalId === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: tokenBalance, voterSecret, voteChoice, minTokenThreshold, proposalId'
      });
    }

    // Convert voterSecret to hex if it's decimal
    let voterSecretHex = voterSecret.toString();
    if (!voterSecretHex.startsWith('0x')) {
      voterSecretHex = '0x' + BigInt(voterSecretHex).toString(16).padStart(64, '0');
    }

    // Convert proposalId to hex
    const proposalIdHex = toFieldHex(proposalId);

    // Phase 1: Use nargo to compute hashes via a compute-only execution
    // We create a Prover.toml that will compute the hashes
    console.log(`[${uniqueId}] Phase 1: Computing hashes via nargo...`);

    // Create a test script that computes and outputs the hashes
    const computeScript = `
use dep::std;

fn main() {
    let voter_secret: Field = ${voterSecretHex};
    let proposal_id: Field = ${proposalIdHex};
    let vote_choice: u8 = ${voteChoice};

    let nullifier = std::hash::pedersen_hash([voter_secret, proposal_id]);
    let commitment = std::hash::pedersen_hash([vote_choice as Field, voter_secret, proposal_id]);

    std::println(f"NULLIFIER:{nullifier}");
    std::println(f"COMMITMENT:{commitment}");
}
`;

    const computeDir = path.join(CIRCUITS_DIR, `compute_${uniqueId}`);
    await fs.mkdir(computeDir, { recursive: true });
    await fs.mkdir(path.join(computeDir, 'src'), { recursive: true });

    // Write minimal Nargo.toml
    await fs.writeFile(path.join(computeDir, 'Nargo.toml'), `
[package]
name = "compute_hashes"
type = "bin"
authors = ["psephos"]
[dependencies]
`);

    // Write the compute script
    await fs.writeFile(path.join(computeDir, 'src/main.nr'), computeScript);

    // Run nargo execute to get the hash values
    let nullifierHex, commitmentHex;
    try {
      const { stdout, stderr } = await execAsync(
        `cd ${computeDir} && nargo execute compute_result 2>&1`,
        { timeout: 60000 }
      );

      console.log(`[${uniqueId}] nargo output:`, stdout);

      // Parse the output for NULLIFIER and COMMITMENT
      const nullifierMatch = stdout.match(/NULLIFIER:(0x[0-9a-fA-F]+)/);
      const commitmentMatch = stdout.match(/COMMITMENT:(0x[0-9a-fA-F]+)/);

      if (nullifierMatch && commitmentMatch) {
        nullifierHex = nullifierMatch[1];
        commitmentHex = commitmentMatch[1];
        console.log(`[${uniqueId}] Computed nullifier: ${nullifierHex}`);
        console.log(`[${uniqueId}] Computed commitment: ${commitmentHex}`);
      } else {
        throw new Error('Could not parse hash values from nargo output');
      }
    } finally {
      // Clean up compute directory
      await fs.rm(computeDir, { recursive: true, force: true }).catch(() => {});
    }

    // Phase 2: Generate the full proof with computed hashes
    console.log(`[${uniqueId}] Phase 2: Generating Gnark proof...`);

    // Create Prover.toml with all values
    const proverToml = `# Generated for proof request ${uniqueId}
token_balance = "${tokenBalance}"
voter_secret = "${voterSecretHex}"
vote_choice = "${voteChoice}"
min_token_threshold = "${minTokenThreshold}"
proposal_id = "${proposalIdHex}"
vote_commitment = "${commitmentHex}"
nullifier = "${nullifierHex}"
`;

    await fs.writeFile(proverPath, proverToml);

    // Execute the main circuit
    const { stdout: execOutput } = await execAsync(
      `cd ${CIRCUITS_DIR} && nargo execute ${witnessName} --prover-name Prover_${uniqueId}`,
      { timeout: 60000 }
    );
    console.log(`[${uniqueId}] nargo execute output:`, execOutput);

    // Generate Gnark proof using Sunspot
    const { stdout: proveOutput } = await execAsync(
      `cd ${CIRCUITS_DIR} && ${SUNSPOT_PATH} prove ` +
      `target/psephos_circuits.json ` +
      `target/${witnessName}.gz ` +
      `target/psephos_circuits.ccs ` +
      `target/psephos_circuits.pk`,
      { timeout: 120000 }
    );
    console.log(`[${uniqueId}] sunspot prove output:`, proveOutput);

    // Read the generated proof and public witness
    const proofPath = path.join(CIRCUITS_DIR, 'target/psephos_circuits.proof');
    const witnessPath = path.join(CIRCUITS_DIR, 'target/psephos_circuits.pw');

    const proofBytes = await fs.readFile(proofPath);
    const publicWitnessBytes = await fs.readFile(witnessPath);

    console.log(`[${uniqueId}] Proof size: ${proofBytes.length} bytes`);
    console.log(`[${uniqueId}] Public witness size: ${publicWitnessBytes.length} bytes`);

    // Convert hex hashes to byte arrays
    const nullifierBytes = hexToBytes(nullifierHex);
    const commitmentBytes = hexToBytes(commitmentHex);

    // Clean up
    await fs.unlink(proverPath).catch(() => {});
    await fs.unlink(path.join(CIRCUITS_DIR, `target/${witnessName}.gz`)).catch(() => {});

    // Return success response (matching noir-api.ts expected format)
    res.json({
      success: true,
      proof: proofBytes.toString('base64'),
      publicWitness: publicWitnessBytes.toString('base64'),
      publicInputs: {
        minTokenThreshold: minTokenThreshold.toString(),
        proposalId: proposalId.toString(),
        voteCommitment: commitmentHex,
        nullifier: nullifierHex
      }
    });

  } catch (error) {
    console.error(`[${uniqueId}] Error:`, error);

    // Clean up temp files
    await fs.unlink(proverPath).catch(() => {});

    return res.status(500).json({
      error: 'Proof generation failed',
      details: error.message,
      hint: 'Ensure nargo and sunspot are installed and circuits are compiled'
    });
  }
});

/**
 * Generate a ZK proof with pre-computed hash values
 * 
 * POST /generate-proof-with-hashes
 * Body: {
 *   tokenBalance: string | number,
 *   voterSecret: string (hex, 0x-prefixed),
 *   voteChoice: number,
 *   minTokenThreshold: string | number,
 *   proposalId: string (hex, 0x-prefixed),
 *   nullifier: string (hex, 0x-prefixed),
 *   voteCommitment: string (hex, 0x-prefixed)
 * }
 */
app.post('/generate-proof-with-hashes', async (req, res) => {
  const { 
    tokenBalance, 
    voterSecret, 
    voteChoice, 
    minTokenThreshold, 
    proposalId,
    nullifier,
    voteCommitment 
  } = req.body;
  
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const proverPath = path.join(CIRCUITS_DIR, `Prover_${uniqueId}.toml`);
  const witnessName = `vote_${uniqueId}`;
  
  console.log(`[${uniqueId}] Generating Gnark proof with pre-computed hashes`);
  
  try {
    // Validate required fields
    if (!tokenBalance || !voterSecret || voteChoice === undefined || 
        !minTokenThreshold || !proposalId || !nullifier || !voteCommitment) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }
    
    // 1. Create Prover.toml with all values
    const proverToml = `# Generated for proof request ${uniqueId}
token_balance = "${tokenBalance}"
voter_secret = "${voterSecret}"
vote_choice = "${voteChoice}"
min_token_threshold = "${minTokenThreshold}"
proposal_id = "${proposalId}"
vote_commitment = "${voteCommitment}"
nullifier = "${nullifier}"
`;
    
    await fs.writeFile(proverPath, proverToml);
    console.log(`[${uniqueId}] Created Prover.toml`);
    
    // 2. Execute circuit to generate witness
    console.log(`[${uniqueId}] Executing circuit...`);
    const { stdout: execOutput, stderr: execStderr } = await execAsync(
      `cd ${CIRCUITS_DIR} && nargo execute ${witnessName} --prover-name Prover_${uniqueId}`,
      { timeout: 60000 }
    );
    console.log(`[${uniqueId}] nargo execute output:`, execOutput);
    
    // 3. Generate Gnark proof using Sunspot
    console.log(`[${uniqueId}] Generating Gnark proof...`);
    const { stdout: proveOutput, stderr: proveStderr } = await execAsync(
      `cd ${CIRCUITS_DIR} && ${SUNSPOT_PATH} prove ` +
      `target/psephos_circuits.json ` +
      `target/${witnessName}.gz ` +
      `target/psephos_circuits.ccs ` +
      `target/psephos_circuits.pk`,
      { timeout: 120000 }
    );
    console.log(`[${uniqueId}] sunspot prove output:`, proveOutput);
    
    // 4. Read the generated proof and public witness
    const proofPath = path.join(CIRCUITS_DIR, 'target/psephos_circuits.proof');
    const witnessPath = path.join(CIRCUITS_DIR, 'target/psephos_circuits.pw');
    
    const proofBytes = await fs.readFile(proofPath);
    const publicWitnessBytes = await fs.readFile(witnessPath);
    
    console.log(`[${uniqueId}] Proof size: ${proofBytes.length} bytes`);
    console.log(`[${uniqueId}] Public witness size: ${publicWitnessBytes.length} bytes`);
    
    // 5. Parse nullifier and commitment from hex strings to byte arrays
    const nullifierBytes = hexToBytes(nullifier);
    const commitmentBytes = hexToBytes(voteCommitment);
    
    // 6. Clean up temp files
    try {
      await fs.unlink(proverPath);
      await fs.unlink(path.join(CIRCUITS_DIR, `target/${witnessName}.gz`));
    } catch {}
    
    // 7. Return the proof and witness as arrays
    res.json({
      success: true,
      proof: Array.from(proofBytes),
      publicWitness: Array.from(publicWitnessBytes),
      nullifier: Array.from(nullifierBytes),
      voteCommitment: Array.from(commitmentBytes),
      proofSize: proofBytes.length,
      witnessSize: publicWitnessBytes.length
    });
    
  } catch (error) {
    console.error(`[${uniqueId}] Error:`, error);
    
    // Clean up temp files
    try {
      await fs.unlink(proverPath);
    } catch {}
    
    return res.status(500).json({ 
      error: 'Proof generation failed', 
      details: error.message,
      stderr: error.stderr 
    });
  }
});

/**
 * Health check endpoint
 * Returns 'ok' for status to match frontend expectations
 */
app.get('/health', async (req, res) => {
  try {
    // Check nargo is available
    let nargoVersion = 'not found';
    try {
      const { stdout } = await execAsync('nargo --version');
      nargoVersion = stdout.trim();
    } catch {
      // nargo not installed - will use fallback mode
    }

    // Check sunspot is available
    let sunspotAvailable = false;
    try {
      await execAsync(`${SUNSPOT_PATH} --help`);
      sunspotAvailable = true;
    } catch {
      // sunspot not installed
    }

    // Check circuits are compiled
    const ccsExists = await fs.access(path.join(CIRCUITS_DIR, 'target/psephos_circuits.ccs'))
      .then(() => true).catch(() => false);
    const pkExists = await fs.access(path.join(CIRCUITS_DIR, 'target/psephos_circuits.pk'))
      .then(() => true).catch(() => false);

    // Return 'ok' status if basic requirements are met
    // Even without nargo/sunspot, the server can provide guidance
    res.json({
      status: 'ok',
      message: 'Proof server is running',
      nargo: nargoVersion,
      sunspot: sunspotAvailable ? 'available' : 'not found',
      circuitsCompiled: ccsExists && pkExists,
      ready: nargoVersion !== 'not found' && sunspotAvailable && ccsExists && pkExists
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * POST /compute-hashes
 * Compute ONLY the Pedersen hashes (nullifier and commitment)
 * Used by browser proving to get correct hash values
 * Body: { voterSecret, voteChoice, proposalId }
 */
app.post('/compute-hashes', async (req, res) => {
  const { voterSecret, voteChoice, proposalId } = req.body;

  const uniqueId = crypto.randomBytes(8).toString('hex');
  const HASH_CIRCUIT_DIR = '/tmp/psephos_hash_helper';
  const proverPath = path.join(HASH_CIRCUIT_DIR, `Prover_${uniqueId}.toml`);

  console.log(`[${uniqueId}] Computing hashes for proposal ${proposalId}`);

  try {
    // Validate inputs
    if (voterSecret === undefined || voteChoice === undefined || proposalId === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: voterSecret, voteChoice, proposalId'
      });
    }

    // Create Prover.toml for hash_helper circuit
    const proverToml = `
voter_secret = "${voterSecret}"
vote_choice = "${voteChoice}"
proposal_id = "${proposalId}"
`;

    await fs.writeFile(proverPath, proverToml);

    // Execute hash_helper circuit - it returns (nullifier, commitment) as public outputs
    const proverName = path.basename(proverPath, '.toml');
    const executeCmd = `cd "${HASH_CIRCUIT_DIR}" && nargo execute -p ${proverName} witness_${uniqueId}`;
    console.log(`[${uniqueId}] Executing hash computation:`, executeCmd);

    const { stdout, stderr } = await execAsync(executeCmd, { timeout: 30000 });

    if (stderr && !stderr.includes('Executing')) {
      console.error(`[${uniqueId}] Execution stderr:`, stderr);
    }

    console.log(`[${uniqueId}] Execution output:`, stdout);

    // Parse circuit output from nargo's stdout
    // Format can be either:
    // - Old: "Circuit output: (0xNULLIFIER, 0xCOMMITMENT)"
    // - New: "Circuit output: Vec([Field(NULLIFIER_DEC), Field(COMMITMENT_DEC)])"

    let nullifierHex, commitmentHex;

    // Try new format first (nargo 0.36.0+)
    const newFormatMatch = stdout.match(/Circuit output: Vec\(\[Field\(([0-9-]+)\),\s*Field\(([0-9-]+)\)\]\)/);
    if (newFormatMatch) {
      // Convert decimal field values to hex
      const nullifierDec = BigInt(newFormatMatch[1]);
      const commitmentDec = BigInt(newFormatMatch[2]);

      // Handle negative values (convert to positive using field modulus)
      const BN254_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
      const nullifierPos = nullifierDec < 0 ? BN254_MODULUS + nullifierDec : nullifierDec;
      const commitmentPos = commitmentDec < 0 ? BN254_MODULUS + commitmentDec : commitmentDec;

      nullifierHex = '0x' + nullifierPos.toString(16).padStart(64, '0');
      commitmentHex = '0x' + commitmentPos.toString(16).padStart(64, '0');
    } else {
      // Try old format (nargo 1.0.0-beta+)
      const oldFormatMatch = stdout.match(/Circuit output: \((0x[0-9a-fA-F]+),\s*(0x[0-9a-fA-F]+)\)/);
      if (!oldFormatMatch) {
        throw new Error('Failed to parse circuit output from nargo execution');
      }
      nullifierHex = oldFormatMatch[1];
      commitmentHex = oldFormatMatch[2];
    }

    console.log(`[${uniqueId}] Computed hashes:`, { nullifier: nullifierHex, commitment: commitmentHex });

    // Cleanup
    await fs.unlink(proverPath).catch(() => {});
    const witnessPath = path.join(HASH_CIRCUIT_DIR, 'target', `witness_${uniqueId}.gz`);
    await fs.unlink(witnessPath).catch(() => {});

    res.json({
      success: true,
      nullifier: nullifierHex,
      voteCommitment: commitmentHex,
    });

  } catch (error) {
    console.error(`[${uniqueId}] Hash computation failed:`, error);

    // Cleanup on error
    await fs.unlink(proverPath).catch(() => {});

    res.status(500).json({
      error: 'Failed to compute hashes',
      details: error.message
    });
  }
});

// Helper to parse public witness
function parsePublicWitness(buffer) {
  // Public witness format: 4 field elements (32 bytes each)
  // [threshold, proposal_id, commitment, nullifier]
  const commitment = '0x' + buffer.slice(64, 96).toString('hex');
  const nullifier = '0x' + buffer.slice(96, 128).toString('hex');

  return { commitment, nullifier };
}

// Start server
app.listen(PORT, () => {
  console.log(`Psephos Proof Server running on port ${PORT}`);
  console.log(`Circuits directory: ${CIRCUITS_DIR}`);
  console.log(`Sunspot path: ${SUNSPOT_PATH}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /health - Check server status');
  console.log('  POST /compute-hashes - Compute Pedersen hashes only');
  console.log('  POST /generate-proof-with-hashes - Generate Gnark proof with pre-computed hashes');
});

/**
 * Psephos Proof Generation Server
 * 
 * This server handles ZK proof generation using Sunspot backend.
 * It receives circuit inputs via API and returns Groth16 proofs
 * for on-chain verification on Solana.
 */

import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS and body parsing
app.use(cors());
app.use(express.json());

// Paths to Sunspot and circuit files
const SUNSPOT_PATH = '/Users/cartel/development/solana/hackathons/privacy_hack/aztec/resources/sunspot/go/sunspot';
const CIRCUIT_DIR = '/Users/cartel/development/solana/hackathons/privacy_hack/aztec/psephos/circuits';
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure temp directory exists
await fs.mkdir(TEMP_DIR, { recursive: true });

// Set environment variables for Sunspot
process.env.PATH = `/Users/cartel/development/solana/hackathons/privacy_hack/aztec/resources/sunspot/go:${process.env.PATH}`;
process.env.GNARK_VERIFIER_BIN = '/Users/cartel/development/solana/hackathons/privacy_hack/aztec/resources/sunspot/gnark-solana/crates/verifier-bin';

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Proof server is running' });
});

/**
 * Generate ZK proof for voting
 * 
 * Expected body:
 * {
 *   tokenBalance: string,
 *   voterSecret: string,
 *   voteChoice: string,
 *   minTokenThreshold: string,
 *   proposalId: string
 * }
 */
app.post('/generate-proof', async (req, res) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const sessionDir = path.join(TEMP_DIR, sessionId);
  
  try {
    console.log(`[${sessionId}] Starting proof generation with inputs:`, {
      tokenBalance: req.body.tokenBalance,
      voteChoice: req.body.voteChoice,
      minTokenThreshold: req.body.minTokenThreshold,
      proposalId: req.body.proposalId,
      // Don't log the secret!
    });

    // Create session directory
    await fs.mkdir(sessionDir, { recursive: true });

    // Create Prover.toml with the inputs
    const proverToml = `
token_balance = "${req.body.tokenBalance}"
voter_secret = "${req.body.voterSecret}"
vote_choice = "${req.body.voteChoice}"
min_token_threshold = "${req.body.minTokenThreshold}"
proposal_id = "${req.body.proposalId}"
vote_commitment = "0"
nullifier = "0"
`;

    await fs.writeFile(path.join(sessionDir, 'Prover.toml'), proverToml);

    // Copy circuit files to session directory
    await execAsync(`cp ${CIRCUIT_DIR}/target/psephos_circuits.json ${sessionDir}/`);
    await execAsync(`cp ${CIRCUIT_DIR}/target/psephos_circuits.ccs ${sessionDir}/`);
    await execAsync(`cp ${CIRCUIT_DIR}/target/psephos_circuits.pk ${sessionDir}/`);
    await execAsync(`cp ${CIRCUIT_DIR}/Nargo.toml ${sessionDir}/`);
    await execAsync(`cp -r ${CIRCUIT_DIR}/src ${sessionDir}/`);

    console.log(`[${sessionId}] Executing circuit to generate witness...`);
    
    // Execute circuit to generate witness
    const { stdout: executeOut, stderr: executeErr } = await execAsync(
      'nargo execute psephos_circuits',
      { cwd: sessionDir }
    );
    
    if (executeErr && !executeErr.includes('Circuit witness successfully solved')) {
      throw new Error(`Circuit execution failed: ${executeErr}`);
    }

    console.log(`[${sessionId}] Generating Groth16 proof...`);

    // Generate proof using Sunspot
    const { stdout: proveOut, stderr: proveErr } = await execAsync(
      `${SUNSPOT_PATH} prove target/psephos_circuits.json target/psephos_circuits.gz target/psephos_circuits.ccs target/psephos_circuits.pk`,
      { cwd: sessionDir }
    );

    console.log(`[${sessionId}] Proof generated successfully`);

    // Read the generated proof and public witness
    const proofData = await fs.readFile(path.join(sessionDir, 'target/psephos_circuits.proof'));
    const publicWitness = await fs.readFile(path.join(sessionDir, 'target/psephos_circuits.pw'));

    // Parse public witness to extract nullifier and commitment
    // The public witness contains: min_token_threshold, proposal_id, vote_commitment, nullifier
    const pwJson = JSON.parse(publicWitness.toString());
    
    // Clean up session directory
    await fs.rm(sessionDir, { recursive: true, force: true });

    // Return proof data
    res.json({
      success: true,
      proof: proofData.toString('base64'),
      publicWitness: publicWitness.toString('base64'),
      publicInputs: {
        minTokenThreshold: req.body.minTokenThreshold,
        proposalId: req.body.proposalId,
        voteCommitment: pwJson[2] || '0', // Third element is vote_commitment
        nullifier: pwJson[3] || '0' // Fourth element is nullifier
      }
    });

  } catch (error) {
    console.error(`[${sessionId}] Error generating proof:`, error);
    
    // Clean up on error
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[${sessionId}] Cleanup error:`, cleanupErr);
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate proof'
    });
  }
});

/**
 * Verify a proof (for testing)
 */
app.post('/verify-proof', async (req, res) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const sessionDir = path.join(TEMP_DIR, sessionId);
  
  try {
    const { proof, publicWitness } = req.body;
    
    // Create session directory
    await fs.mkdir(sessionDir, { recursive: true });
    
    // Write proof and public witness to files
    await fs.writeFile(
      path.join(sessionDir, 'test.proof'),
      Buffer.from(proof, 'base64')
    );
    await fs.writeFile(
      path.join(sessionDir, 'test.pw'),
      Buffer.from(publicWitness, 'base64')
    );
    
    // Copy verifying key
    await execAsync(`cp ${CIRCUIT_DIR}/target/psephos_circuits.vk ${sessionDir}/`);
    
    // Verify using Sunspot
    const { stdout, stderr } = await execAsync(
      `${SUNSPOT_PATH} verify psephos_circuits.vk test.proof test.pw`,
      { cwd: sessionDir }
    );
    
    // Clean up
    await fs.rm(sessionDir, { recursive: true, force: true });
    
    const isValid = stdout.includes('Verification successful');
    
    res.json({
      success: true,
      valid: isValid,
      message: isValid ? 'Proof is valid' : 'Proof is invalid'
    });
    
  } catch (error) {
    console.error(`[${sessionId}] Verification error:`, error);
    
    // Clean up on error
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[${sessionId}] Cleanup error:`, cleanupErr);
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify proof'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Psephos Proof Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Generate proof: POST http://localhost:${PORT}/generate-proof`);
  console.log(`   Verify proof: POST http://localhost:${PORT}/verify-proof`);
});
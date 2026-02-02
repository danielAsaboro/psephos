# Browser Proving Test Plan

## ✅ What's Implemented

1. **Backend Selector UI** - Added to VoteForm.tsx
   - Radio buttons for Server vs Browser proving
   - Shows estimated time for each backend
   - Availability indicators

2. **Dual-Backend Integration** - Wired up
   - `setProvingBackend()` called when user switches
   - `generateVoteProof()` receives selected backend
   - Status messages show which backend is being used

3. **Build Status** - ✅ Success
   - No TypeScript errors
   - Bundle includes Barretenberg WASM (65MB)
   - All imports resolved correctly

## 🧪 Manual Testing Steps

### Test 1: Server Proving (Default)

1. Start dev server: `npm run dev`
2. Open `http://localhost:5173`
3. Connect wallet
4. Create a proposal
5. Select "Server-Side (Sunspot)" backend (should be selected by default)
6. Cast vote
7. **Expected**: Proof generates in ~5-10 seconds
8. **Console should show**: "🚀 Using server-side proving (Sunspot)"

### Test 2: Browser Proving (NEW!)

1. On the vote form, select "Browser-Side (Barretenberg/bb.js)"
2. Should see purple banner: "🌐 Browser proving enabled!"
3. Cast vote
4. **Expected**: Proof generates in ~30-60 seconds
5. **Console should show**:
   - "🔧 Switched to browser proving backend"
   - "🌐 Generating ZK proof in browser with Barretenberg..."
   - "🔐 Generating proof with Barretenberg (this may take 30-60s)..."
   - "✅ Proof generated successfully in XX.Xs"

### Test 3: Backend Availability Check

1. Stop proof server (if running)
2. Refresh page
3. **Expected**: Server backend shows "❌ Unavailable" (or no checkmark)
4. Browser backend should still show "✓ Available"
5. Can still vote using browser backend

## 🔍 What to Verify in Browser Console

### Server Proving Console Output
```
🔧 Proving backend set to: server
🚀 Using server-side proving (Sunspot/gnark)
Generating vote proof via server API (Sunspot)...
✅ Proof generated successfully
📦 Proof size: 388 bytes
```

### Browser Proving Console Output
```
🔧 Switched to browser proving backend
🔐 Generating proof with backend: browser
🌐 Generating ZK proof in browser with Barretenberg...
🔧 Initializing Barretenberg backend for browser proving...
✅ Browser proving initialized with Barretenberg
📊 Circuit inputs prepared: { ... }
🔐 Generating proof with Barretenberg (this may take 30-60s)...
⏱️  Started at: [timestamp]
✅ Proof generated successfully in 45.3s
📦 Proof size: [proof bytes] bytes
```

## ⚠️ Known Issues / Limitations

### Issue 1: Circuit Artifact Loading
**Problem**: Browser proving needs `/circuits/psephos_circuits.json`
**Status**: ✅ FIXED - File copied to `public/circuits/`
**Verify**: Check that file exists at `public/circuits/psephos_circuits.json`

### Issue 2: Hash Computation Mismatch
**Problem**: Browser uses placeholder SHA-256 hash, circuit uses Pedersen hash
**Impact**: Proofs may not verify correctly
**Workaround**: Let circuit compute hashes internally
**Status**: ⚠️ NEEDS TESTING

### Issue 3: Proof Format Compatibility
**Problem**: Barretenberg and Sunspot may produce different proof formats
**Status**: ⚠️ NEEDS TESTING - Both should produce Groth16 but encoding may differ

## 🚀 Quick Smoke Test

```bash
# 1. Build
npm run build

# 2. Start dev server
npm run dev

# 3. Open browser
open http://localhost:5173

# 4. Check console for errors
# Should NOT see:
# - "Failed to load circuit artifact"
# - "Browser proving not available"
# - TypeScript errors

# 5. Try switching backends
# Should see:
# - "🔧 Switched to browser proving backend"
# - Purple banner appears/disappears
```

## 📊 Expected Results

### If Everything Works ✅
- Backend selector shows both options
- Switching backends shows console log
- Server proving works in ~5-10s
- Browser proving works in ~30-60s
- Both proofs can be submitted on-chain
- Transaction succeeds for both backends

### If Browser Proving Fails ❌
**Likely causes**:
1. Circuit artifact not found → Check `public/circuits/psephos_circuits.json`
2. WASM not loading → Check network tab for .wasm files
3. Proof verification fails → Check nullifier/commitment hash computation
4. Out of memory → Browser can't handle large circuit

**Fallback**: Server proving still works, so submission is not blocked

## 🎯 Success Criteria

- [x] Build succeeds with no errors
- [x] UI shows backend selector
- [x] Switching backends triggers re-render
- [ ] Server proving works (regression test)
- [ ] Browser proving generates proof
- [ ] Browser proof can be submitted on-chain
- [ ] Console logs show correct backend being used

## 📝 Testing Log

### Test Run #1: [Date/Time]
- **Tester**:
- **Backend**: Server
- **Result**:
- **Duration**:
- **Notes**:

### Test Run #2: [Date/Time]
- **Tester**:
- **Backend**: Browser
- **Result**:
- **Duration**:
- **Notes**:

## 🐛 Debugging Tips

### If browser proving fails with "Circuit not found"
```bash
# Check if circuit artifact exists
ls -la public/circuits/psephos_circuits.json

# If missing, copy it:
cp circuits/target/psephos_circuits.json public/circuits/
```

### If browser console shows "Cannot read property 'execute'"
- Circuit artifact format may be wrong
- Check that circuits/target/psephos_circuits.json is the compiled Noir circuit
- Try: `cd circuits && nargo compile`

### If proof generation hangs
- Open browser DevTools → Performance
- Check if WASM is executing
- Check memory usage (may run out on large circuits)
- Check console for errors

### If "Proof verification failed" on-chain
- Nullifier/commitment may not match circuit expectations
- Check that Pedersen hash is computed correctly
- Compare server vs browser proof formats

## 🎬 Demo Preparation

For demo video / live demo:
1. ✅ UI is polished with backend selector
2. ✅ Console logs are clear and informative
3. ✅ Status messages explain what's happening
4. [ ] Test both backends work end-to-end
5. [ ] Record console output for demo
6. [ ] Prepare side-by-side comparison

## 🚧 Next Steps

1. **Manual test both backends** - Priority #1
2. **Fix any hash computation issues** - If browser proving fails
3. **Record demo video** - Show dual-backend in action
4. **Update HACKATHON_STATUS.md** - Mark browser proving as tested

---

**Status**: ✅ Code complete, ready for testing
**Estimated testing time**: 30-60 minutes
**Risk**: Medium - Browser proving may need hash fixes

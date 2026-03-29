# WS8: WrapSplitter Smart Contract + Integration

## Objective

Deploy a `WrapSplitter` contract on Base mainnet that receives USDC via EIP-3009 `transferWithAuthorization`, atomically splits the payment between the endpoint owner and the platform wallet, and replace the current CDP facilitator settle path with a direct backend signer call to this contract.

---

## Context

- Current flow: proxy verifies payment via CDP facilitator, settles via CDP (USDC goes directly to endpoint owner wallet)
- New flow: proxy verifies payment via CDP facilitator, backend signer calls `WrapSplitter.settle()` which splits USDC between owner and platform
- Payment is still EIP-3009 `transferWithAuthorization` signed by the payer
- `payTo` in every 402 challenge becomes the contract address

---

## Contract: `WrapSplitter.sol`

### Storage

```solidity
address public immutable platformWallet;
address public immutable usdc;
uint16 public defaultFeeBps; // e.g. 100 = 1%

mapping(bytes32 => uint16) public endpointFeeBps;    // endpointId => feeBps
mapping(bytes32 => address) public endpointOwner;    // endpointId => owner wallet
```

### Functions

#### `registerEndpoint(bytes32 endpointId, address owner, uint16 feeBps)`
- Called by backend when an endpoint is registered (after payment)
- Stores owner + feeBps for the endpoint
- `feeBps` must be >= some minimum (e.g. 50 = 0.5%) and <= 10000
- Only callable by backend signer (add `onlyOperator` modifier)

#### `settle(bytes32 endpointId, EIP3009AuthorizationStruct calldata auth, bytes calldata signature)`
- Called by backend signer after verifying payment
- Calls `USDC.transferWithAuthorization(auth.from, address(this), auth.value, auth.validAfter, auth.validBefore, auth.nonce, v, r, s)`
- Splits: `ownerAmount = value * (10000 - feeBps) / 10000`, `platformAmount = value - ownerAmount`
- Transfers `ownerAmount` to `endpointOwner[endpointId]`
- Transfers `platformAmount` to `platformWallet`
- Emits `PaymentSettled(endpointId, from, owner, ownerAmount, platformAmount)`

#### `updateOperator(address newOperator)` — owner only (deployer)

### Constructor
```solidity
constructor(address _usdc, address _platformWallet, address _operator, uint16 _defaultFeeBps)
```

### Constants (Base mainnet)
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Platform wallet: `0x348Df429BD49A7506128c74CE1124A81B4B7dC9d`
- Default feeBps: `100` (1%)

---

## EIP-3009 Interface

USDC on Base supports `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`.

The payer signs authorization to `address(this)` (the contract). Signature is decomposed into `v, r, s` in the contract.

The payment payload the proxy receives has:
```json
{
  "payload": {
    "signature": "0x...", 
    "authorization": { "from", "to", "value", "validAfter", "validBefore", "nonce" }
  }
}
```

Decompose `signature` into `v, r, s` using `ecrecover` / standard split.

---

## Tooling

Use **Foundry** (forge + cast):
- `forge init` in `/mnt/c/Users/Administrator/.openclaw/workspace/projects/x402-splitter/`
- Write contract in `src/WrapSplitter.sol`
- Write tests in `test/WrapSplitter.t.sol`
- Deploy script in `script/Deploy.s.sol`

Install Foundry if not present: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

---

## Deploy

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://mainnet.base.org \
  --private-key REDACTED \
  --broadcast \
  --verify \
  --etherscan-api-key REDACTED
```

Constructor args:
- `_usdc`: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `_platformWallet`: `0x348Df429BD49A7506128c74CE1124A81B4B7dC9d`
- `_operator`: `0xfE5C036d1382744cCAcd99Ee2b10b064e5471717` (backend signer)
- `_defaultFeeBps`: `100`

---

## Proxy Integration (after contract deployed)

In `/mnt/c/Users/Administrator/.openclaw/workspace/projects/x402-wrap/`:

### New env vars needed
```
CONTRACT_ADDRESS=<deployed address>
BACKEND_SIGNER_PRIVATE_KEY=REDACTED
```

### Changes to `src/middleware/x402.ts`

Replace `settlePaymentHeader` implementation:
- Instead of calling CDP `/settle`, call `WrapSplitter.settle()` via viem
- Use backend signer wallet
- Parse `paymentHeader` to extract `authorization` + `signature`
- Call contract with `endpointId`, `authorization`, `signature`

### Changes to `src/routes/register.ts`

After saving endpoint to Redis, also call `contract.registerEndpoint(endpointId, walletAddress, feeBps)` via backend signer.

### Changes to `src/middleware/x402.ts` — `buildPaymentRequirements`

`payTo` must now be the contract address, not the endpoint owner wallet.

### Changes to `src/routes/proxy.ts`

Pass `endpointId` through to the settle call so the contract knows which endpoint to look up.

---

## Registration Fee Update

Change `REGISTRATION_FEE` from `"1"` to `"2"` in `src/routes/register.ts`.

---

## Output Required

When done, print:
1. Deployed contract address
2. Basescan verification link
3. Confirmation that tests pass
4. Summary of proxy changes made

Then run:
```
openclaw system event --text "Done: WrapSplitter deployed at <address>, proxy integrated, tests passing" --mode now
```

/**
 * WrapSplitter contract integration.
 * Calls registerEndpoint and settle on the deployed WrapSplitter contract.
 */
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS ?? "") as `0x${string}`;
const BACKEND_SIGNER_PRIVATE_KEY = (process.env.BACKEND_SIGNER_PRIVATE_KEY ?? "") as `0x${string}`;

const ABI = parseAbi([
  "function registerEndpoint(bytes32 endpointId, address epOwner, uint16 feeBps) external",
  "function settle(bytes32 endpointId, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external",
]);

function getClients() {
  const account = privateKeyToAccount(BACKEND_SIGNER_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });
  return { account, publicClient, walletClient };
}

function endpointIdToBytes32(endpointId: string): `0x${string}` {
  // Pad/hash the nanoid string to bytes32
  const encoder = new TextEncoder();
  const bytes = encoder.encode(endpointId);
  const padded = new Uint8Array(32);
  padded.set(bytes.slice(0, 32));
  return ("0x" + Buffer.from(padded).toString("hex")) as `0x${string}`;
}

export async function registerEndpointOnChain(
  endpointId: string,
  ownerAddress: string,
  feeBps: number,
): Promise<string> {
  const { walletClient, publicClient } = getClients();
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: "registerEndpoint",
    args: [endpointIdToBytes32(endpointId), ownerAddress as `0x${string}`, feeBps],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[splitter] registered endpoint ${endpointId} on-chain: ${hash}`);
  return hash;
}

export async function settleOnChain(
  endpointId: string,
  from: string,
  value: string,
  validAfter: string,
  validBefore: string,
  nonce: string,
  signature: string,
): Promise<string> {
  const { walletClient, publicClient } = getClients();
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: "settle",
    args: [
      endpointIdToBytes32(endpointId),
      from as `0x${string}`,
      BigInt(value),
      BigInt(validAfter),
      BigInt(validBefore),
      nonce as `0x${string}`,
      signature as `0x${string}`,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[splitter] settled payment for ${endpointId}: ${hash}`);
  return hash;
}

import { nanoid } from "nanoid";

import { getVerificationPath } from "./origin-security.js";
import type { EndpointRecord, RegisterPayload } from "./types.js";

export function createRegistrationIntent(payload: RegisterPayload & {
  encryptedHeaders?: EndpointRecord["encryptedHeaders"];
}): { endpointId: string; record: EndpointRecord } {
  const endpointId = nanoid(12);
  const verificationToken = nanoid(24);

  return {
    endpointId,
    record: {
      originUrl: payload.originUrl!,
      price: payload.price!,
      walletAddress: payload.walletAddress!,
      pathPattern: payload.pathPattern ?? "*",
      encryptedHeaders: payload.encryptedHeaders,
      status: "pending_verification",
      visibility: payload.visibility ?? "private",
      verificationToken,
      verificationPath: getVerificationPath(verificationToken),
      verifiedAt: null,
      activatedAt: null,
      lastVerificationError: null,
      paymentTxHash: null,
      activationTxHash: null,
    },
  };
}

export function getNextStatus(record: EndpointRecord, verified: boolean): EndpointRecord["status"] {
  if (!verified) return "failed_verification";
  return record.paymentTxHash ? "active" : "pending_payment";
}

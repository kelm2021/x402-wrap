export interface EncryptedHeaders {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EndpointConfig {
  originUrl: string;
  price: string;
  walletAddress: string;
  pathPattern: string;
  encryptedHeaders?: EncryptedHeaders;
}

export type EndpointStatus =
  | "pending_verification"
  | "failed_verification"
  | "pending_payment"
  | "active";

export type EndpointVisibility = "private" | "public";

export interface EndpointRecord extends EndpointConfig {
  status: EndpointStatus;
  visibility: EndpointVisibility;
  verificationToken?: string;
  verificationPath?: string;
  verifiedAt?: string | null;
  activatedAt?: string | null;
  lastVerificationError?: string | null;
  paymentTxHash?: string | null;
  activationTxHash?: string | null;
}

export interface RegisterPayload {
  originUrl?: string;
  price?: string;
  walletAddress?: string;
  pathPattern?: string;
  originHeaders?: Record<string, string>;
  visibility?: EndpointVisibility;
}

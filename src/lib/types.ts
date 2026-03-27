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

export interface RegisterPayload {
  originUrl?: string;
  price?: string;
  walletAddress?: string;
  pathPattern?: string;
  originHeaders?: Record<string, string>;
}

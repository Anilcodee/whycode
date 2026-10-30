import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class EncryptedPayload {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32) throw new Error('Invalid storage encryption key');
  }
  encode(value: unknown): Buffer {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }
  decode<T>(data: Buffer): T {
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0,12));
    cipher.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')) as T;
  }
}

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Encrypted single-server session persistence. Keep the encryption key outside backups. */
export class SessionVault<T> {
  private readonly key: Buffer;
  private readonly path: string;
  constructor(directory: string, encodedKey: string, filename = 'account-sessions.enc') {
    if (!/^[a-z0-9-]+\.enc$/.test(filename)) throw new Error('Invalid vault filename');
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must encode exactly 32 random bytes.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, filename);
  }
  remove(): void { if (existsSync(this.path)) unlinkSync(this.path); }
  load(): Map<string, T> {
    if (!existsSync(this.path)) return new Map();
    try {
      const data = readFileSync(this.path);
      if (data.length < 29) throw new Error('Invalid vault');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return new Map(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')));
    } catch { throw new Error('Account session storage cannot be decrypted. Check its key and backup.'); }
  }
  save(sessions: Map<string, T>): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify([...sessions]), 'utf8'), cipher.final()]);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

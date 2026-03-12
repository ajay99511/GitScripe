import * as Minio from 'minio';
import pino from 'pino';

const logger = pino({ name: 'DiffStorage' });

export class DiffStorage {
  private client: Minio.Client;
  private bucket: string;

  constructor(
    endpoint: string,
    port: number,
    accessKey: string,
    secretKey: string,
    bucket: string,
    useSSL: boolean = false
  ) {
    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      accessKey,
      secretKey,
      useSSL,
    });
    this.bucket = bucket;
  }

  /**
   * Ensure the storage bucket exists, creating it if necessary.
   */
  async initialize(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        logger.info({ bucket: this.bucket }, 'Created storage bucket');
      }
    } catch (error) {
      logger.error({ error, bucket: this.bucket }, 'Failed to initialize storage');
      throw error;
    }
  }

  /**
   * Store a diff text, keyed by SHA. Returns the object key.
   */
  async saveDiff(sha: string, diffText: string): Promise<string> {
    const objectKey = `diffs/${sha}.diff`;

    try {
      const buffer = Buffer.from(diffText, 'utf-8');
      await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
        'Content-Type': 'text/plain',
      });

      logger.debug({ sha, objectKey }, 'Stored diff');
      return objectKey;
    } catch (error) {
      logger.error({ error, sha }, 'Failed to store diff');
      throw error;
    }
  }

  /**
   * Retrieve a diff text by its object key.
   */
  async getDiff(objectKey: string): Promise<string> {
    try {
      const stream = await this.client.getObject(this.bucket, objectKey);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error({ error, objectKey }, 'Failed to retrieve diff');
      throw error;
    }
  }

  /**
   * Check if a diff already exists (for idempotency).
   */
  async exists(sha: string): Promise<boolean> {
    const objectKey = `diffs/${sha}.diff`;
    try {
      await this.client.statObject(this.bucket, objectKey);
      return true;
    } catch {
      return false;
    }
  }
}

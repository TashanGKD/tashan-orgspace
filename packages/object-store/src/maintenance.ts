import {
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";

export class S3FileMaintenanceStore {
  public constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  public async *readObject(key: string): AsyncIterable<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (body === undefined || !(Symbol.asyncIterator in body)) {
      throw new Error("S3 object body is not an async byte stream");
    }
    for await (const chunk of body as AsyncIterable<Uint8Array>) yield chunk;
  }

  public async copyObject(source: string, target: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: target,
        CopySource: `${this.bucket}/${source}`,
      }),
    );
  }

  public async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  public async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  public async headObject(key: string): Promise<{ sizeBytes: number } | undefined> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: response.ContentLength ?? 0 };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        ["NoSuchKey", "NotFound"].includes(String(error.name))
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async *listObjects(prefix: string): AsyncIterable<string> {
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key !== undefined) yield object.Key;
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
  }
}

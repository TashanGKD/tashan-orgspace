import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { presignS3Command } from "./presign.js";

const ACTIVE_CONTENT =
  /^(?:text\/html|image\/svg\+xml|application\/(?:javascript|x-javascript|xml|xhtml\+xml))/i;

type Presign = typeof presignS3Command;

export class S3FileDataStore {
  public constructor(
    private readonly options: {
      internalClient: S3Client;
      presignClient: S3Client;
      bucket: string;
      presign?: Presign;
    },
  ) {}

  public async createMultipart(input: { key: string; contentType: string }): Promise<string> {
    const response = await this.options.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ChecksumAlgorithm: "SHA256",
      }),
    );
    if (response.UploadId === undefined || response.UploadId === "") {
      throw new Error("S3 multipart creation omitted its upload ID");
    }
    return response.UploadId;
  }

  public async presignPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<string> {
    return (this.options.presign ?? presignS3Command)(
      this.options.presignClient,
      new UploadPartCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
        ChecksumAlgorithm: "SHA256",
      }),
      input.expiresInSeconds,
    );
  }

  public async listParts(input: { key: string; uploadId: string }) {
    const items: Array<{
      partNumber: number;
      etag: string;
      checksumSha256: string;
      sizeBytes: number;
    }> = [];
    let marker: string | undefined;
    do {
      const response = await this.options.internalClient.send(
        new ListPartsCommand({
          Bucket: this.options.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          ...(marker === undefined ? {} : { PartNumberMarker: marker }),
        }),
      );
      for (const part of response.Parts ?? []) {
        if (
          part.PartNumber === undefined ||
          part.ETag === undefined ||
          part.ChecksumSHA256 === undefined ||
          part.Size === undefined
        ) {
          throw new Error("S3 returned an incomplete multipart part record");
        }
        items.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          checksumSha256: part.ChecksumSHA256,
          sizeBytes: part.Size,
        });
      }
      marker = response.IsTruncated === true ? response.NextPartNumberMarker : undefined;
      if (response.IsTruncated === true && marker === undefined) {
        throw new Error("S3 truncated multipart listing without a continuation marker");
      }
    } while (marker !== undefined);
    return items;
  }

  public async completeMultipart(input: {
    key: string;
    uploadId: string;
    parts: readonly { partNumber: number; etag: string; checksumSha256: string }[];
  }): Promise<void> {
    await this.options.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
            ChecksumSHA256: part.checksumSha256,
          })),
        },
      }),
    );
  }

  public async abortMultipart(input: { key: string; uploadId: string }): Promise<void> {
    await this.options.internalClient.send(
      new AbortMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
  }

  public async sign(input: {
    objectKey: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const safeType = ACTIVE_CONTENT.test(input.contentType)
      ? "application/octet-stream"
      : input.contentType;
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(input.fileName)}`;
    return (this.options.presign ?? presignS3Command)(
      this.options.presignClient,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: input.objectKey,
        ResponseContentType: safeType,
        ResponseContentDisposition: disposition,
      }),
      input.expiresInSeconds,
    );
  }
}

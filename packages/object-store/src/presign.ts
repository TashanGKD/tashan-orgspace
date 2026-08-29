import {
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function presignS3Command(
  client: S3Client,
  command: GetObjectCommand | PutObjectCommand | UploadPartCommand,
  expiresInSeconds: number,
): Promise<string> {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 900) {
    throw new Error("S3 presign expiry must be between 1 and 900 seconds");
  }
  if (command instanceof GetObjectCommand) {
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }
  if (command instanceof PutObjectCommand) {
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

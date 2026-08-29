import { z } from "zod";

export {
  createInternalS3Client,
  createPresignS3Client,
  parseObjectStoreConfig,
  type ObjectStoreConfig,
} from "./client.js";
export { sha256Stream } from "./checksum.js";
export { presignS3Command } from "./presign.js";

const ObjectId = z.uuid("object ID must be a UUID");

export function temporaryObjectKey(uploadSessionId: string): string {
  return `temporary/${ObjectId.parse(uploadSessionId)}`;
}

export function versionObjectKey(versionId: string): string {
  return `versions/${ObjectId.parse(versionId)}`;
}

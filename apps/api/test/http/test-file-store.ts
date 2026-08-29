import type { FileDownloadSigner } from "../../src/files/file-service.js";
import type { MultipartObjectStore } from "../../src/files/upload-service.js";

export function testFileDataStore(): MultipartObjectStore & FileDownloadSigner {
  return {
    createMultipart: async () => "test-upload-id",
    presignPart: async ({ partNumber }) => `https://files.test/part/${partNumber}`,
    listParts: async () => [],
    completeMultipart: async () => undefined,
    abortMultipart: async () => undefined,
    sign: async () => "https://files.test/download",
  };
}

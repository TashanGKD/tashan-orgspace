import { chmod, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { EncryptedFileStore } from "../src/credentials/encrypted-file-store.js";
import { LinuxSecretServiceStore } from "../src/credentials/linux-secret-service-store.js";
import { MacOSKeychainStore } from "../src/credentials/macos-keychain-store.js";
import { MemoryCredentialStore } from "../src/credentials/memory-store.js";
import {
  CredentialBackendUnavailableError,
  withMemoryFallback,
  type SpawnFile,
} from "../src/credentials/credential-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("OS credential-store command safety", () => {
  test.each(["name;open /tmp/pwned", "$(touch /tmp/pwned)", "`id`"])(
    "passes a macOS keychain label as one argv without a shell: %s",
    async (label) => {
      const spawn = vi.fn<SpawnFile>().mockResolvedValue({
        exitCode: 0,
        stdout: "stored-token\n",
        stderr: "",
      });
      await new MacOSKeychainStore(spawn).read(label);
      expect(spawn).toHaveBeenCalledWith(
        "/usr/bin/security",
        expect.arrayContaining([label]),
        expect.objectContaining({ shell: false }),
      );
      expect(spawn.mock.calls[0]?.[1].filter((argument) => argument === label)).toHaveLength(1);
    },
  );

  test("passes a Secret Service label as one argv and sends the secret only on stdin", async () => {
    const spawn = vi.fn<SpawnFile>().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const store = new LinuxSecretServiceStore(spawn);
    await store.write("alice; rm -rf /", "refresh-secret");
    const [, argv, options] = spawn.mock.calls[0] ?? [];
    expect(argv).toContain("alice; rm -rf /");
    expect(argv).not.toContain("refresh-secret");
    expect(options).toMatchObject({ shell: false, stdin: "refresh-secret" });
  });
});

describe("encrypted file credential store", () => {
  test("round-trips encrypted credentials with mode 0600 and no plaintext", async () => {
    const directory = await mkdtemp(join(tmpdir(), "torg-credentials-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "credentials.enc");
    const getPassphrase = vi.fn(async () => "long-passphrase");
    const store = new EncryptedFileStore({ path, getPassphrase });
    await store.write("alice", "refresh-secret");
    expect(getPassphrase).toHaveBeenCalledTimes(1);

    expect(await store.read("alice")).toBe("refresh-secret");
    expect(getPassphrase).toHaveBeenCalledTimes(2);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("refresh-secret");
    expect(await readdir(directory)).toEqual(["credentials.enc"]);
  });

  test("rejects an insecure existing file mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "torg-credentials-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "credentials.enc");
    const store = new EncryptedFileStore({ path, getPassphrase: async () => "long-passphrase" });
    await store.write("alice", "refresh-secret");
    await chmod(path, 0o644);
    await expect(store.read("alice")).rejects.toThrow("permissions must be 0600");
  });

  test("cleans the temporary file when the atomic rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "torg-credentials-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "credentials.enc");
    const store = new EncryptedFileStore({
      path,
      getPassphrase: async () => "long-passphrase",
      rename: async () => {
        throw new Error("fixture rename failure");
      },
    });

    await expect(store.write("alice", "refresh-secret")).rejects.toThrow("fixture rename failure");
    expect(await readdir(directory)).toEqual([]);
  });
});

test("memory store is process-local and supports deletion", async () => {
  const store = new MemoryCredentialStore();
  await store.write("alice", "token");
  expect(await store.read("alice")).toBe("token");
  await store.delete("alice");
  expect(await store.read("alice")).toBeUndefined();
});

test("falls back to process memory only when the OS backend is unavailable", async () => {
  const memory = new MemoryCredentialStore();
  const unavailable = {
    read: async () => {
      throw new CredentialBackendUnavailableError("missing helper");
    },
    write: async () => {
      throw new CredentialBackendUnavailableError("missing helper");
    },
    delete: async () => {
      throw new CredentialBackendUnavailableError("missing helper");
    },
  };
  const store = withMemoryFallback(unavailable, memory);
  await store.write("alice", "token");
  expect(await store.read("alice")).toBe("token");
});

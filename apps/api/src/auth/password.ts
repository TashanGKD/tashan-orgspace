import argon2 from "argon2";

export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, passwordOptions);
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(encoded, password);
  } catch {
    return false;
  }
}

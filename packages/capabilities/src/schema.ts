import { z } from "zod";

export const Capability = z
  .object({
    id: z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/),
    version: z.literal(1),
    inputSchema: z.string().min(1),
    outputSchema: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    sideEffect: z.enum(["none", "session", "write", "revoke"]),
    idempotent: z.boolean(),
    confirmation: z.enum(["none", "required"]),
    cli: z.string().min(1),
    web: z.enum(["required", "deferred"]),
    auditAction: z.string().min(1),
  })
  .strict();

export type Capability = z.infer<typeof Capability>;

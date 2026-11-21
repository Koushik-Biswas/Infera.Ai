/**
 * Outbound webhook endpoint validation shared by the /api/v1/webhooks routes.
 * Signing secrets are `whsec_` + 24 random bytes (base64url), stored AES-GCM encrypted
 * and shown to the admin exactly once (on create and on rotation).
 */
import { z } from "zod";
import { DOMAIN_EVENT_TYPES, type DomainEventType } from "@/lib/shared/types";
import { unprocessable } from "../api/handler";
import { encrypt, newToken } from "../crypto";
import { cleanText } from "../http";
import { checkWebhookUrl } from "./ssrf";

export const MAX_ENDPOINTS_PER_WORKSPACE = 20;

export const newWebhookSecret = () => `whsec_${newToken(24)}`;
export const encryptWebhookSecret = (secret: string) => encrypt(secret);

export const endpointEventsSchema = z
  .array(z.enum(DOMAIN_EVENT_TYPES))
  .min(1, "Pick at least one event.")
  .max(DOMAIN_EVENT_TYPES.length * 2)
  .transform((list): DomainEventType[] => DOMAIN_EVENT_TYPES.filter((t) => list.includes(t)));

const url = z.string().trim().min(1, "Enter the endpoint URL.").max(2000);
const description = z
  .string()
  .max(2000)
  .transform((v) => cleanText(v, 500));

export const endpointCreateSchema = z.object({
  url,
  description: description.optional(),
  events: endpointEventsSchema,
  enabled: z.boolean().optional(),
});

export const endpointPatchSchema = z
  .object({
    url: url.optional(),
    description: description.optional(),
    events: endpointEventsSchema.optional(),
    enabled: z.boolean().optional(),
    /** Generate a new signing secret (returned once in the response). */
    rotateSecret: z.boolean().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), "Nothing to update.");

/** Synchronous URL validation (https in production, no credentials, no private literals). 422 on failure. */
export function validatedEndpointUrl(raw: string): string {
  const checked = checkWebhookUrl(raw);
  if (!checked.ok) throw unprocessable(`url: ${checked.reason}`, [{ path: "url", message: checked.reason }]);
  return checked.url.toString();
}

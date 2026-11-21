/**
 * Validation rules shared by the browser forms and the API routes, so the
 * client and server can never disagree about what is valid.
 * Pure functions only — safe to import from client and server code.
 */

export const COUNTRY_CODES = [
  { code: "+91", label: "IN +91" },
  { code: "+971", label: "AE +971" },
  { code: "+966", label: "SA +966" },
  { code: "+65", label: "SG +65" },
  { code: "+62", label: "ID +62" },
  { code: "+55", label: "BR +55" },
  { code: "+52", label: "MX +52" },
  { code: "+234", label: "NG +234" },
  { code: "+44", label: "UK +44" },
  { code: "+1", label: "US +1" },
] as const;

export const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"] as const;

export const CHANNEL_IDS = ["instagram", "facebook", "linkedin", "telegram", "slack", "gmail"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** Name of the hidden honeypot field. Humans never fill it; naive bots do. */
export const HONEYPOT_FIELD = "website";

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** National number may contain spaces, dashes, dots or brackets; 6–14 digits. */
export function nationalDigits(phone: string): string | null {
  if (!/^[0-9\s\-.()]{6,20}$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 14 ? digits : null;
}

export function isValidCountryCode(code: string): boolean {
  return COUNTRY_CODES.some((c) => c.code === code);
}

/** E.164 (max 15 digits incl. country code), e.g. "+919847011234", or null if invalid. */
export function toE164(country: string, phone: string): string | null {
  if (!isValidCountryCode(country)) return null;
  const digits = nationalDigits(phone);
  if (!digits) return null;
  const full = country.slice(1) + digits.replace(/^0+/, "");
  return full.length <= 15 ? `+${full}` : null;
}

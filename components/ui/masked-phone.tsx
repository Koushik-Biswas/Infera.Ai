import { maskPhone } from "@/lib/phone";

/**
 * Shows the country code and first digits of a phone number; the rest is a
 * blurred placeholder. The hidden digits are never put in the DOM — the blur
 * is purely visual over dummy characters, so it can't be copied or un-blurred.
 */
export function MaskedPhone({ phone, keep = 4, className = "" }: { phone: string; keep?: number; className?: string }) {
  const { visible, hidden } = maskPhone(phone, keep);
  return (
    <span className={className}>
      {visible}
      {hidden && (
        <>
          <span aria-hidden className="pointer-events-none inline-block blur-[3px] select-none">
            {hidden.replace(/•/g, "0")}
          </span>
          <span className="sr-only"> (rest of number hidden)</span>
        </>
      )}
    </span>
  );
}

/**
 * Phone-number masking for anything rendered in the browser.
 * Keeps the country code and the first `keep` subscriber digits; every later
 * digit becomes "•". "+91 98470 11234" → visible "+91 9847", hidden "• •••••".
 */
export function maskPhone(phone: string, keep = 4): { visible: string; hidden: string } {
  const m = phone.match(/^(\+\d{1,4}\s?)(.*)$/);
  const prefix = m ? m[1] : "";
  const rest = m ? m[2] : phone;

  let seen = 0;
  let cut = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (/[\d•]/.test(rest[i]) && ++seen === keep) {
      cut = i + 1;
      break;
    }
  }
  return {
    visible: prefix + rest.slice(0, cut),
    hidden: rest.slice(cut).replace(/\d/g, "•"),
  };
}

/** Plain-text masked form, for CSV exports and search. */
export const maskedPhoneText = (phone: string, keep = 4) => {
  const { visible, hidden } = maskPhone(phone, keep);
  return visible + hidden;
};

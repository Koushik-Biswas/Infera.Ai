"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { QRCodeSVG as QRCodeSVGType } from "qrcode.react";

const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), { ssr: false });

/**
 * QR code whose encoder loads after hydration, for decorative/below-the-fold codes on marketing
 * pages (keeps qrcode.react out of their initial JavaScript). Reserves `size`×`size` while loading,
 * so nothing shifts. Codes users must scan right away (console linking) import qrcode.react directly.
 */
export function LazyQRCode({ size = 128, ...props }: ComponentProps<typeof QRCodeSVGType>) {
  return (
    <span className="block" style={{ width: size, height: size }}>
      <QRCodeSVG size={size} {...props} />
    </span>
  );
}

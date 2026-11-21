import { NextResponse } from "next/server";

/**
 * Share-target fallback. The service worker normally intercepts this POST and
 * keeps the shared files on the device; if it isn't active yet, send the user
 * to the import screen so they can pick the file manually. Nothing is stored.
 */
export function POST(request: Request) {
  return NextResponse.redirect(new URL("/offline#/chats?import=1", request.url), 303);
}

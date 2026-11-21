/**
 * "Open the app": sign in (the /console proxy sends signed-out visitors to /login),
 * then connect WhatsApp — or go straight to the Inbox when it is already linked.
 * The offline, on-device importer lives at /offline.
 */
import { redirect } from "next/navigation";

export default function AppEntry() {
  redirect("/console/connect");
}

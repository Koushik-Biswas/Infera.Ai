/**
 * Run freshly queued jobs right after the HTTP response is sent (Next.js
 * `after()`), so webhooks are acknowledged fast and processed immediately even
 * on serverless. No-op in tests (tests call drainJobs() explicitly).
 */
import { after } from "next/server";
import { isTest } from "../env";
import { kickJobs } from "./queue";

export function kickSoon(max = 5) {
  if (isTest) return;
  try {
    after(() => kickJobs(max));
  } catch {
    void kickJobs(max);
  }
}

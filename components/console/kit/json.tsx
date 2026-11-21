"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

/**
 * Collapsible JSON viewer with copy — `<JsonView value={event.result} openDepth={2} label="Processing result" />`.
 * Loaded on demand with next/dynamic (a skeleton shows meanwhile), so it never weighs down route bundles.
 */
export const JsonView = dynamic(() => import("./json-view").then((m) => m.JsonViewer), {
  loading: () => <Skeleton className="h-40 w-full rounded-xl" />,
});

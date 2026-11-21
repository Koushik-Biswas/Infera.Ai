"use client";

/** Settings section frame: page header + sub-navigation tabs (General, Members, API keys, Webhooks, Data). */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Building2, Database, KeyRound, Users, Webhook } from "lucide-react";
import { useSession } from "../session";
import { Page, PageHeader } from "../kit/surface";
import { Tabs, type TabItem } from "../kit/misc";

/** Cache keys of the settings pages (shared with their prefetch warm-ups). */
export const WORKSPACE_PATH = "/api/v1/workspace";
export const MEMBERS_PATH = "/api/v1/members";
export const INVITATIONS_PATH = "/api/v1/invitations?status=open";
export const API_KEYS_PATH = "/api/v1/api-keys";
export const WEBHOOKS_PATH = "/api/v1/webhooks";

type Section = "general" | "members" | "api-keys" | "webhooks" | "data";

export function SettingsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, ready } = useSession();
  const admin = ready && can("admin");
  const seg = pathname.split("/")[3] as Section | undefined;
  const active: Section = seg && ["members", "api-keys", "webhooks", "data"].includes(seg) ? seg : "general";

  const tabs: TabItem<Section>[] = [
    { id: "general", label: "General", icon: <Building2 />, href: "/console/settings", prefetchData: [WORKSPACE_PATH] },
    { id: "members", label: "Members", icon: <Users />, href: "/console/settings/members", prefetchData: [MEMBERS_PATH, ...(admin ? [INVITATIONS_PATH] : [])] },
    ...(admin || active === "api-keys" ? [{ id: "api-keys" as const, label: "API keys", icon: <KeyRound />, href: "/console/settings/api-keys", prefetchData: [API_KEYS_PATH] }] : []),
    ...(admin || active === "webhooks" ? [{ id: "webhooks" as const, label: "Webhooks", icon: <Webhook />, href: "/console/settings/webhooks", prefetchData: [WEBHOOKS_PATH] }] : []),
    { id: "data", label: "Data & privacy", icon: <Database />, href: "/console/settings/data", prefetchData: [WORKSPACE_PATH] },
  ];

  return (
    <Page>
      <PageHeader title="Settings" description="Workspace configuration, team, API access and your data." className="mb-4" />
      <Tabs label="Settings sections" items={tabs} value={active} />
      <div className="mt-6">{children}</div>
    </Page>
  );
}

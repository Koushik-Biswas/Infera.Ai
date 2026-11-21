"use client";

/**
 * /console/search — one box over every synced message, record and contact.
 * Message search runs on the encrypted index (word prefixes: "bask" finds "basketball").
 */
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Contact, FolderKanban, MessageSquare, Search as SearchIcon } from "lucide-react";
import { qs, useApi, useDebounced } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import type { SearchHitDTO } from "@/lib/shared/types";
import { Page, PageHeader, Card, EmptyState, Spinner } from "../kit/surface";
import { SearchInput } from "../kit/form";
import { ErrorState, Tabs } from "../kit/misc";

type T = "all" | "messages" | "records" | "contacts";

export function SearchPage() {
  return (
    <Suspense fallback={null}>
      <Search_ />
    </Suspense>
  );
}

const hrefOf = (h: SearchHitDTO) =>
  h.type === "message" ? `/console/inbox?c=${h.conversationId}` : h.type === "record" ? `/console/collections/${h.collectionId}` : `/console/search?q=${encodeURIComponent(h.title)}`;

function Search_() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [type, setType] = useState<T>("all");
  const dq = useDebounced(q.trim(), 250);
  const { data, error, loading, validating, isPreviousData, reload } = useApi<{ items: SearchHitDTO[] }>(dq ? `/api/v1/search${qs({ q: dq, type, limit: 50 })}` : null, { keepPreviousData: true });
  const items = data?.items ?? [];

  return (
    <Page>
      <PageHeader title="Search" description="Every chat, record and contact. Messages stay encrypted at rest — search runs on an encrypted index." />
      <div className="mb-4 space-y-3">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            router.replace(v ? `/console/search?q=${encodeURIComponent(v)}` : "/console/search", { scroll: false });
          }}
          placeholder="Search messages, records and contacts…"
          autoFocus
        />
        <Tabs<T>
          label="Result type"
          variant="pills"
          size="sm"
          value={type}
          onChange={setType}
          items={[
            { id: "all", label: "All" },
            { id: "messages", label: "Messages" },
            { id: "records", label: "Records" },
            { id: "contacts", label: "Contacts" },
          ]}
        />
      </div>
      {!dq ? (
        <Card>
          <EmptyState icon={<SearchIcon />} title="Search everything" body="Try a name, a product, an amount or a phone number." />
        </Card>
      ) : error && !data ? (
        <ErrorState error={error} retry={reload} />
      ) : loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> Searching…</div>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<SearchIcon />} title={`No results for “${dq}”`} body="Messages match whole words or the start of words." />
        </Card>
      ) : (
        <Card padded={false} className={isPreviousData || validating ? "opacity-80" : ""}>
          <ul className="divide-y divide-line">
            {items.map((h) => (
              <li key={`${h.type}:${h.id}`}>
                <Link href={hrefOf(h)} className="flex items-start gap-3 px-4 py-3 hover:bg-sunken">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-muted">
                    {h.type === "message" ? <MessageSquare className="size-4" /> : h.type === "record" ? <FolderKanban className="size-4" /> : <Contact className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{h.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{relativeTime(h.at)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] text-fg-soft">{h.snippet}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}

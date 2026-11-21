"use client";

/** /console/settings/members — members with roles, invitations (link shown once), revoke, remove, leave. */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogOut, MailPlus, TriangleAlert, UserMinus, UserPlus, Users } from "lucide-react";
import { useUI } from "@/components/providers";
import { Avatar } from "@/components/app/ui-base";
import { api, invalidate, setCached, useApi } from "@/lib/client/api";
import { useCursorList } from "@/lib/client/pagination";
import { errorMessage, fieldErrors } from "@/lib/client/errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, formatDate } from "@/lib/client/format";
import { ROLES, roleAtLeast, type InvitationDTO, type MemberDTO, type Role } from "@/lib/shared/types";
import { useSession } from "../session";
import { Card, Callout, EmptyState } from "../kit/surface";
import { Badge, RoleBadge } from "../kit/badges";
import { Button, Select, TextField } from "../kit/form";
import { ConfirmDialog, Dialog } from "../kit/overlay";
import { DataTable } from "../kit/table";
import { CopyButton, ErrorState, LoadMore, TimeAgo } from "../kit/misc";
import { INVITATIONS_PATH, MEMBERS_PATH } from "./frame";

type Members = { items: MemberDTO[] };

/** Roles `me` may assign/manage: owners manage everyone, admins manage viewers and members. */
function assignableRoles(myRole: Role | null): Role[] {
  if (myRole === "owner") return [...ROLES];
  if (myRole === "admin") return ["viewer", "member"];
  return [];
}

export function MembersSettings() {
  const router = useRouter();
  const { toast } = useUI();
  const { user, role: myRole, can, workspace, reset } = useSession();
  const admin = can("admin");
  const members = useApi<Members>(MEMBERS_PATH);
  const invites = useCursorList<InvitationDTO>(admin ? INVITATIONS_PATH : null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<MemberDTO | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [revokePending, setRevokePending] = useState<string | null>(null);
  const assignable = assignableRoles(myRole);

  async function changeRole(m: MemberDTO, role: Role) {
    if (role === m.role) return;
    setCached<Members>(MEMBERS_PATH, (prev) => ({ items: (prev?.items ?? []).map((x) => (x.userId === m.userId ? { ...x, role } : x)) }));
    try {
      await api<MemberDTO>(`/api/v1/members/${encodeURIComponent(m.userId)}`, { method: "PATCH", body: { role } });
      toast({ title: "Role updated", body: `${m.name || m.email} is now ${ROLE_LABELS[role].toLowerCase()}.` });
    } catch (e) {
      setCached<Members>(MEMBERS_PATH, (prev) => ({ items: (prev?.items ?? []).map((x) => (x.userId === m.userId ? { ...x, role: m.role } : x)) }));
      toast({ tone: "info", title: "Couldn't change role", body: errorMessage(e) });
    } finally {
      invalidate(MEMBERS_PATH);
    }
  }

  async function remove(m: MemberDTO) {
    await api(`/api/v1/members/${encodeURIComponent(m.userId)}`, { method: "DELETE" });
    if (m.userId === user?.id) {
      toast({ title: `You left ${workspace?.name ?? "the workspace"}` });
      await reset();
      router.replace("/console");
      return;
    }
    setCached<Members>(MEMBERS_PATH, (prev) => ({ items: (prev?.items ?? []).filter((x) => x.userId !== m.userId) }));
    toast({ title: "Member removed", body: `${m.name || m.email} no longer has access.` });
    invalidate(MEMBERS_PATH);
  }

  async function revoke(inv: InvitationDTO) {
    setRevokePending(inv.id);
    setRevoked((s) => new Set(s).add(inv.id));
    try {
      await api(`/api/v1/invitations/${encodeURIComponent(inv.id)}`, { method: "DELETE" });
      toast({ title: "Invitation revoked", body: `The link sent to ${inv.email} no longer works.` });
      invalidate("/api/v1/invitations");
    } catch (e) {
      setRevoked((s) => {
        const n = new Set(s);
        n.delete(inv.id);
        return n;
      });
      toast({ tone: "info", title: "Couldn't revoke invitation", body: errorMessage(e) });
    } finally {
      setRevokePending(null);
    }
  }

  const rows = members.data?.items ?? [];
  const owners = rows.filter((m) => m.role === "owner").length;
  const openInvites = invites.items.filter((i) => !revoked.has(i.id));

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Members"
        description={members.data ? `${rows.length} ${rows.length === 1 ? "person has" : "people have"} access to this workspace.` : "People with access to this workspace."}
        padded={false}
        actions={
          admin && (
            <Button variant="primary" size="sm" icon={<UserPlus />} onClick={() => setInviteOpen(true)}>
              Invite
            </Button>
          )
        }
      >
        {members.error && !members.data ? (
          <ErrorState compact error={members.error} retry={members.reload} />
        ) : (
          <DataTable
            caption="Workspace members"
            rows={members.data?.items}
            loading={members.loading}
            skeletonRows={3}
            rowKey={(m) => m.userId}
            empty={<EmptyState compact icon={<Users />} title="No members" />}
            columns={[
              {
                key: "member",
                header: "Member",
                cell: (m) => (
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.name || m.email} className="size-8 text-xs" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-fg">{m.name || m.email}</span>
                        {m.userId === user?.id && <Badge tone="brand">You</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">{m.email}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: "role",
                header: "Role",
                width: "w-44",
                cell: (m) => {
                  const self = m.userId === user?.id;
                  const canEdit = admin && !self && assignable.includes(m.role);
                  if (!canEdit) return <RoleBadge role={m.role} />;
                  return (
                    <Select
                      size="sm"
                      aria-label={`Role for ${m.name || m.email}`}
                      value={m.role}
                      onChange={(e) => void changeRole(m, e.target.value as Role)}
                      options={assignable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                      containerClassName="max-w-36"
                    />
                  );
                },
              },
              { key: "joined", header: "Joined", hideBelow: "sm", cell: (m) => <span className="text-muted">{formatDate(m.joinedAt)}</span> },
              {
                key: "actions",
                header: "Actions",
                srHeader: true,
                align: "right",
                cell: (m) => {
                  const self = m.userId === user?.id;
                  const lastOwner = m.role === "owner" && owners <= 1;
                  if (self) {
                    return lastOwner ? (
                      <span className="text-xs text-muted" title="Make someone else an owner first">
                        Only owner
                      </span>
                    ) : (
                      <Button size="xs" variant="danger-ghost" icon={<LogOut />} onClick={() => setRemoving(m)}>
                        Leave
                      </Button>
                    );
                  }
                  if (!admin || !assignable.includes(m.role) || lastOwner) return null;
                  return (
                    <Button size="xs" variant="danger-ghost" icon={<UserMinus />} onClick={() => setRemoving(m)} aria-label={`Remove ${m.name || m.email}`}>
                      Remove
                    </Button>
                  );
                },
              },
            ]}
          />
        )}
      </Card>

      {admin && (
        <Card title="Pending invitations" description="Invitations that haven't been accepted yet." padded={false}>
          {invites.error && !invites.data ? (
            <ErrorState compact error={invites.error} retry={invites.reload} />
          ) : (
            <>
              <DataTable
                caption="Pending invitations"
                rows={invites.data ? openInvites : undefined}
                loading={invites.loading}
                skeletonRows={2}
                rowKey={(i) => i.id}
                dimmed={invites.isPreviousData}
                empty={
                  <EmptyState
                    compact
                    icon={<MailPlus />}
                    title="No pending invitations"
                    body="Invite teammates and give each the right role."
                    action={
                      <Button size="sm" icon={<UserPlus />} onClick={() => setInviteOpen(true)}>
                        Invite someone
                      </Button>
                    }
                  />
                }
                columns={[
                  { key: "email", header: "Email", cell: (i) => <span className="truncate font-medium text-fg">{i.email}</span> },
                  { key: "role", header: "Role", cell: (i) => <RoleBadge role={i.role} /> },
                  { key: "expires", header: "Expires", hideBelow: "sm", cell: (i) => <TimeAgo date={i.expiresAt} className="text-muted" /> },
                  { key: "sent", header: "Sent", hideBelow: "md", cell: (i) => <span className="text-muted">{formatDate(i.createdAt)}</span> },
                  {
                    key: "actions",
                    header: "Actions",
                    srHeader: true,
                    align: "right",
                    cell: (i) => (
                      <Button size="xs" variant="danger-ghost" pending={revokePending === i.id} onClick={() => revoke(i)} aria-label={`Revoke invitation for ${i.email}`}>
                        Revoke
                      </Button>
                    ),
                  },
                ]}
              />
              <LoadMore hasMore={invites.hasMore} loading={invites.loadingMore} onLoadMore={invites.loadMore} error={invites.loadMoreError} />
            </>
          )}
        </Card>
      )}

      {!admin && (
        <Callout tone="info">
          Only admins can invite people or change roles{myRole ? ` — you're a ${ROLE_LABELS[myRole].toLowerCase()}` : ""}.
        </Callout>
      )}

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} assignable={assignable.filter((r) => r !== "owner" || myRole === "owner")} />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        danger
        title={removing?.userId === user?.id ? `Leave ${workspace?.name ?? "this workspace"}?` : `Remove ${removing?.name || removing?.email}?`}
        body={
          removing?.userId === user?.id
            ? "You'll lose access to its conversations, records and settings. An admin can invite you again."
            : "They'll lose access immediately. Records they created stay in the workspace."
        }
        confirmLabel={removing?.userId === user?.id ? "Leave workspace" : "Remove member"}
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </div>
  );
}

/** Invite form → shows the one-time invitation link with copy. */
function InviteDialog({ open, onClose, assignable }: { open: boolean; onClose: () => void; assignable: Role[] }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ email?: string; form?: string }>({});
  const [created, setCreated] = useState<InvitationDTO | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail("");
      setRole("member");
      setError({});
      setCreated(null);
    }
  }
  const roles = assignable.length ? assignable : (["viewer", "member"] as Role[]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!email.trim()) {
      setError({ email: "Enter an email address." });
      return;
    }
    setPending(true);
    setError({});
    try {
      const inv = await api<InvitationDTO>("/api/v1/invitations", { body: { email: email.trim(), role } });
      setCreated(inv);
      invalidate("/api/v1/invitations");
    } catch (err) {
      const f = fieldErrors(err);
      setError(f.email ? { email: f.email } : { form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Invitation created"
        description={`Send this link to ${created.email}. They'll join as ${ROLE_LABELS[created.role].toLowerCase()}.`}
        footer={
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {created.url ? (
            <TextField label="Invitation link" value={created.url} readOnly onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" trailing={<CopyButton value={created.url} iconOnly size="xs" label="Copy link" />} />
          ) : (
            <Callout tone="info">The invitation was created. Ask the server admin to resend the link if you didn&apos;t receive it.</Callout>
          )}
          <Callout tone="warning" icon={<TriangleAlert className="text-amber-600 dark:text-amber-400" />} title="Copy it now — it's shown only once">
            For security the link can&apos;t be displayed again. It expires on {formatDate(created.expiresAt)}. You can revoke it from the pending list.
          </Callout>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      title="Invite someone"
      description="They'll get a link to join this workspace with the role you choose."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" variant="primary" size="sm" pending={pending}>
            Create invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Email" type="email" autoComplete="off" inputMode="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} required error={error.email} />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} hint={ROLE_DESCRIPTIONS[role]} />
        {roleAtLeast(role, "admin") && <Callout tone="warning">Admins can manage channels, automations, API keys, members and settings.</Callout>}
        {error.form && <Callout tone="danger">{error.form}</Callout>}
      </form>
    </Dialog>
  );
}

/**
 * DTO mappers for identity & tenancy (users, workspaces, members, invitations,
 * API keys). DTOs never carry password hashes, token hashes or key hashes.
 */
import { defaultWorkspaceSettings, type ApiKeyDTO, type InvitationDTO, type MeDTO, type MemberDTO, type Role, type UserDTO, type WorkspaceDTO, type WorkspaceSettings } from "@/lib/shared/types";
import type { UserRow, WorkspaceRow } from "../db/schema";
import type { apiKeys, invitations } from "../db/schema";

type InvitationRow = typeof invitations.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Settings with defaults filled in, so rows written by older versions always have every key. */
export function effectiveSettings(settings: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings {
  return { ...defaultWorkspaceSettings, ...(settings ?? {}) };
}

export function toUserDTO(u: UserRow): UserDTO {
  return { id: u.id, email: u.email, name: u.name, createdAt: iso(u.createdAt) };
}

export function toWorkspaceDTO(w: WorkspaceRow): WorkspaceDTO {
  return { id: w.id, name: w.name, slug: w.slug, settings: effectiveSettings(w.settings), createdAt: iso(w.createdAt) };
}

export type WorkspaceSummary = { id: string; name: string; slug: string; role: Role };

export function toMeDTO(user: UserRow, workspace: WorkspaceRow | null, role: Role | null, workspaces: WorkspaceSummary[]): MeDTO {
  return {
    user: toUserDTO(user),
    workspace: workspace ? toWorkspaceDTO(workspace) : null,
    role: workspace ? role : null,
    workspaces,
  };
}

export function toMemberDTO(m: { userId: string; email: string; name: string; role: Role; createdAt: Date }): MemberDTO {
  return { userId: m.userId, email: m.email, name: m.name, role: m.role, joinedAt: iso(m.createdAt) };
}

/** `url` is only passed right after creation — the raw token is never stored. */
export function toInvitationDTO(i: InvitationRow, url?: string): InvitationDTO {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: iso(i.expiresAt),
    createdAt: iso(i.createdAt),
    acceptedAt: isoOrNull(i.acceptedAt),
    ...(url ? { url } : {}),
  };
}

/** `key` is only passed right after creation (shown once). */
export function toApiKeyDTO(k: ApiKeyRow, key?: string): ApiKeyDTO {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: [...k.scopes],
    createdAt: iso(k.createdAt),
    lastUsedAt: isoOrNull(k.lastUsedAt),
    expiresAt: isoOrNull(k.expiresAt),
    revokedAt: isoOrNull(k.revokedAt),
    ...(key ? { key } : {}),
  };
}

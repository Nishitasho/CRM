import { OrganizationRole } from "@prisma/client";

export const Permission = {
  CRM_READ: "crm:read",
  CRM_WRITE: "crm:write",
  CRM_DELETE: "crm:delete",
  MANAGE_PIPELINES: "pipelines:manage",
  MANAGE_MEMBERS: "members:manage",
  MANAGE_ORGANIZATION: "organization:manage",
  MANAGE_CUSTOM_PROPERTIES: "custom-properties:manage",
  VIEW_AUDIT_LOG: "audit:read",
  IMPORT_DATA: "data:import",
  EXPORT_DATA: "data:export",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const rolePermissions: Record<OrganizationRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(Object.values(Permission)),
  ADMIN: new Set([
    Permission.CRM_READ,
    Permission.CRM_WRITE,
    Permission.CRM_DELETE,
    Permission.MANAGE_PIPELINES,
    Permission.MANAGE_MEMBERS,
    Permission.MANAGE_CUSTOM_PROPERTIES,
    Permission.VIEW_AUDIT_LOG,
    Permission.IMPORT_DATA,
    Permission.EXPORT_DATA,
  ]),
  MANAGER: new Set([
    Permission.CRM_READ,
    Permission.CRM_WRITE,
    Permission.MANAGE_PIPELINES,
    Permission.IMPORT_DATA,
    Permission.EXPORT_DATA,
  ]),
  USER: new Set([
    Permission.CRM_READ,
    Permission.CRM_WRITE,
    Permission.IMPORT_DATA,
    Permission.EXPORT_DATA,
  ]),
  READ_ONLY: new Set([Permission.CRM_READ, Permission.EXPORT_DATA]),
};

export function hasPermission(role: OrganizationRole, permission: Permission) {
  return rolePermissions[role].has(permission);
}

export class AuthorizationError extends Error {
  constructor(message = "この操作を行う権限がありません。") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function requirePermission(
  role: OrganizationRole,
  permission: Permission,
) {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError();
  }
}

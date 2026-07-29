export type OrganizationContext = Readonly<{
  organizationId: string;
  requestId: string;
}>;

export function assertOrganizationContext(
  context: OrganizationContext,
): void {
  if (!context.organizationId.trim() || !context.requestId.trim()) {
    throw new Error("OrganizationContext incompleto.");
  }
}


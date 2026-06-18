"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MembershipOption = {
  organization: { id: string; name: string };
};

export function OrganizationSwitcher({
  activeOrganizationId,
  memberships,
}: {
  activeOrganizationId: string;
  memberships: MembershipOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchOrganization(organizationId: string) {
    setPending(true);
    const response = await fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    setPending(false);
    if (response.ok) router.refresh();
  }

  return (
    <select
      aria-label="利用する組織"
      className="max-w-[220px] rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-brand-500 disabled:opacity-60"
      value={activeOrganizationId}
      disabled={pending}
      onChange={(event) => switchOrganization(event.target.value)}
    >
      {memberships.map(({ organization }) => (
        <option key={organization.id} value={organization.id}>
          {organization.name}
        </option>
      ))}
    </select>
  );
}

import type { Metadata } from "next";
import { InvitationForm } from "@/components/auth/invitation-form";

export const metadata: Metadata = { title: "チームへの招待" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationForm token={token} />;
}

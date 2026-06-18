import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const context = await getAuthContext();
  redirect(context ? "/dashboard" : "/login");
}

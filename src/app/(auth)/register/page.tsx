import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { getAuthContext } from "@/lib/auth";

export const metadata: Metadata = { title: "アカウント登録" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getAuthContext()) redirect("/dashboard");

  return (
    <div>
      <p className="eyebrow">Start your workspace</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight">営業の土台をつくる</h2>
      <p className="mb-7 mt-3 text-sm leading-6 text-slate-500">
        最初のアカウントは組織の最高管理者として登録されます。
      </p>
      <RegisterForm />
      <p className="mt-7 text-center text-sm text-slate-500">
        すでにアカウントをお持ちですか？{" "}
        <Link className="font-bold text-brand-700 hover:underline" href="/login">
          ログイン
        </Link>
      </p>
    </div>
  );
}

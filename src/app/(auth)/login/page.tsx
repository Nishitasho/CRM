import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthContext } from "@/lib/auth";

export const metadata: Metadata = { title: "ログイン" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getAuthContext()) redirect("/dashboard");

  return (
    <div>
      <p className="eyebrow">Welcome back</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight">ログイン</h2>
      <p className="mb-8 mt-3 text-sm leading-6 text-slate-500">
        チームの営業状況を確認して、次のアクションへ進みましょう。
      </p>
      <LoginForm />
      <p className="mt-7 text-center text-sm text-slate-500">
        アカウントをお持ちでないですか？{" "}
        <Link className="font-bold text-brand-700 hover:underline" href="/register">
          新規登録
        </Link>
      </p>
    </div>
  );
}

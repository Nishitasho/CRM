"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER" | "READ_ONLY";
type WorkFunction = "IS" | "FS" | "CS";
type Member = {
  id: string;
  role: Role;
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  user: {
    id: string;
    name: string;
    email: string;
    businessUnitMemberships: Array<{
      businessUnitId: string;
      workFunction: WorkFunction;
      isManager: boolean;
    }>;
  };
  team: { name: string } | null;
};
type BusinessUnit = { id: string; name: string };

const roleLabels: Record<Role, string> = {
  SUPER_ADMIN: "最高管理者",
  ADMIN: "管理者",
  MANAGER: "マネージャー",
  USER: "一般ユーザー",
  READ_ONLY: "閲覧のみ",
};

export function MemberManagement({
  members,
  businessUnits,
  canManage,
  currentRole,
}: {
  members: Member[];
  businessUnits: BusinessUnit[];
  canManage: boolean;
  currentRole: Role;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    setInvitationUrl("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/organizations/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        role: data.get("role"),
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "招待を作成できませんでした。");
      return;
    }
    setMessage(
      "招待URLを発行しました。メール配信連携前は、このURLを招待先へ共有してください。",
    );
    setInvitationUrl(result.invitationUrl);
    event.currentTarget.reset();
  }

  async function updateMember(memberId: string, role: Role) {
    setError("");
    const response = await fetch(`/api/organizations/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "権限を変更できませんでした。");
      return;
    }
    setMessage("メンバーの権限を更新しました。");
    router.refresh();
  }

  async function updateBusinessUnits(member: Member, form: HTMLFormElement) {
    setError("");
    const data = new FormData(form);
    const memberships = data.getAll("membership").map((value) => {
      const [businessUnitId, workFunction] = String(value).split(":") as [
        string,
        WorkFunction,
      ];
      return {
        businessUnitId,
        workFunction,
        isManager:
          data.get(`manager.${businessUnitId}.${workFunction}`) === "on",
      };
    });
    const response = await fetch("/api/business-unit-memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.user.id, memberships }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "事業部所属を更新できませんでした。");
      return;
    }
    setMessage("事業部所属を更新しました。");
    router.refresh();
  }

  async function copyInvitationUrl() {
    await navigator.clipboard.writeText(invitationUrl);
    setMessage("招待URLをコピーしました。");
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <form onSubmit={invite} className="card p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <h2 className="text-lg font-bold">メンバーを招待</h2>
              <p className="mt-1 text-sm text-slate-500">
                メールアドレスごとにアカウントを発行します。
              </p>
            </div>
            <div className="grid flex-1 gap-3 md:max-w-2xl md:grid-cols-[1fr_180px_auto]">
              <input
                className="text-field"
                name="email"
                type="email"
                placeholder="member@example.com"
                required
              />
              <select className="text-field" name="role" defaultValue="USER">
                {Object.entries(roleLabels).map(([value, label]) =>
                  value !== "SUPER_ADMIN" || currentRole === "SUPER_ADMIN" ? (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ) : null,
                )}
              </select>
              <button
                className="primary-button whitespace-nowrap"
                type="submit"
                disabled={pending}
              >
                {pending ? "発行中..." : "招待する"}
              </button>
            </div>
          </div>
          {error ? (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
              {message}
            </p>
          ) : null}
          {invitationUrl ? (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-canvas p-3 sm:flex-row">
              <input
                className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-600 outline-none"
                readOnly
                value={invitationUrl}
              />
              <button
                type="button"
                className="secondary-button min-h-9 py-1.5"
                onClick={copyInvitationUrl}
              >
                URLをコピー
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-bold">所属メンバー</h2>
          <p className="mt-1 text-sm text-slate-500">
            {members.length}名がこの組織に登録されています。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-canvas text-xs text-slate-500">
              <tr>
                <th className="px-6 py-3 font-semibold">メンバー</th>
                <th className="px-6 py-3 font-semibold">チーム</th>
                <th className="px-6 py-3 font-semibold">事業部 / 職種</th>
                <th className="px-6 py-3 font-semibold">ステータス</th>
                <th className="px-6 py-3 font-semibold">権限</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-6 py-4">
                    <p className="font-bold">{member.user.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {member.user.email}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {member.team?.name ?? "未設定"}
                  </td>
                  <td className="px-6 py-4">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        updateBusinessUnits(member, event.currentTarget);
                      }}
                      className="space-y-3"
                    >
                      <div className="grid gap-2">
                        {businessUnits.map((unit) => (
                          <div
                            key={unit.id}
                            className="rounded-lg border border-line p-2"
                          >
                            <p className="mb-2 text-xs font-semibold text-slate-600">
                              {unit.name}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {(["IS", "FS", "CS"] as const).map(
                                (workFunction) => {
                                  const checked =
                                    member.user.businessUnitMemberships.some(
                                      (item) =>
                                        item.businessUnitId === unit.id &&
                                        item.workFunction === workFunction,
                                    );
                                  const manager =
                                    member.user.businessUnitMemberships.some(
                                      (item) =>
                                        item.businessUnitId === unit.id &&
                                        item.workFunction === workFunction &&
                                        item.isManager,
                                    );
                                  return (
                                    <label
                                      key={workFunction}
                                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600"
                                    >
                                      <input
                                        name="membership"
                                        type="checkbox"
                                        value={`${unit.id}:${workFunction}`}
                                        defaultChecked={checked}
                                        disabled={!canManage}
                                      />
                                      {workFunction}
                                      <span className="ml-1 text-slate-400">
                                        管理
                                      </span>
                                      <input
                                        name={`manager.${unit.id}.${workFunction}`}
                                        type="checkbox"
                                        defaultChecked={manager}
                                        disabled={!canManage}
                                      />
                                    </label>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {canManage ? (
                        <button className="secondary-button min-h-8 px-3 py-1 text-xs">
                          所属を保存
                        </button>
                      ) : null}
                    </form>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${member.status === "ACTIVE" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}
                    >
                      {member.status === "ACTIVE"
                        ? "有効"
                        : member.status === "SUSPENDED"
                          ? "停止中"
                          : "招待中"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {canManage ? (
                      <select
                        className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
                        value={member.role}
                        onChange={(event) =>
                          updateMember(member.id, event.target.value as Role)
                        }
                      >
                        {Object.entries(roleLabels).map(([value, label]) =>
                          value !== "SUPER_ADMIN" ||
                          currentRole === "SUPER_ADMIN" ? (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ) : null,
                        )}
                      </select>
                    ) : (
                      <span>{roleLabels[member.role]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

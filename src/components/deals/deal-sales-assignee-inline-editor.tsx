"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SalesRole = "IS" | "FS";

export function DealSalesAssigneeInlineEditor({
  dealId,
  role,
  currentUserId,
  currentUserName,
  options,
  canEdit,
}: {
  dealId: string;
  role: SalesRole;
  currentUserId: string | null;
  currentUserName: string | null;
  options: Array<{ value: string; label: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentUserId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pending) setValue(currentUserId ?? "");
  }, [currentUserId, pending]);

  async function update(nextValue: string) {
    const previousValue = value;
    setValue(nextValue);
    setPending(true);
    setError("");

    const response = await fetch(`/api/deals/${dealId}/sales-assignments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, userId: nextValue || null }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setValue(previousValue);
      setError(result.message ?? "担当者を保存できませんでした。");
      return;
    }

    router.refresh();
  }

  if (!canEdit) {
    return (
      <div>
        <p>{currentUserName ?? "未設定"}</p>
        <p className="mt-1 text-[11px] font-semibold text-slate-400">
          帰属売上 50%
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        aria-label={`${role}担当者`}
        className="text-field w-full"
        value={value}
        disabled={pending}
        onChange={(event) => void update(event.target.value)}
      >
        <option value="">未設定</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] font-semibold text-slate-400">
        {pending
          ? "保存中..."
          : !currentUserId && currentUserName
            ? `現在: ${currentUserName}（ユーザー未紐付け）`
            : "帰属売上 50%"}
      </p>
      {error ? <p className="text-xs font-bold text-red-600">{error}</p> : null}
    </div>
  );
}

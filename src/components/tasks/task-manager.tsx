"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ObjectType = "CONTACT" | "COMPANY" | "DEAL";
type RelatedObjectType = ObjectType | "DELIVERY_PROJECT";
type Task = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | string | null;
  status: string;
  priority: string;
  taskType: string;
  owner: { id: string; name: string };
  related: { type: RelatedObjectType; id: string; name: string } | null;
};
type Option = { id: string; name: string };

const statusLabels: Record<string, string> = {
  TODO: "未着手",
  IN_PROGRESS: "進行中",
  COMPLETED: "完了",
  CANCELED: "キャンセル",
};
const typeLabels: Record<string, string> = {
  CALL: "電話",
  EMAIL: "メール",
  FOLLOW_UP: "フォロー",
  MEETING: "ミーティング",
  OTHER: "その他",
};
const priorityLabels: Record<string, string> = {
  HIGH: "優先度 高",
  MEDIUM: "優先度 中",
  LOW: "優先度 低",
};
const objectLabels: Record<RelatedObjectType, string> = {
  CONTACT: "担当者",
  COMPANY: "会社",
  DEAL: "商談",
  DELIVERY_PROJECT: "CS案件",
};
const objectPaths: Record<RelatedObjectType, string> = {
  CONTACT: "contacts",
  COMPANY: "companies",
  DEAL: "deals",
  DELIVERY_PROJECT: "delivery-projects",
};

export function TaskManager({
  items,
  members,
  options,
  filter,
  currentUserId,
  canCreate,
}: {
  items: Task[];
  members: Option[];
  options: Record<ObjectType, Option[]>;
  filter: string;
  currentUserId: string;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createRelatedType, setCreateRelatedType] =
    useState<ObjectType>("CONTACT");
  const [editRelatedType, setEditRelatedType] = useState<ObjectType>("CONTACT");
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        readTaskForm(event.currentTarget, createRelatedType),
      ),
    });
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "作成できませんでした。");
    setOpen(false);
    setError("");
    event.currentTarget.reset();
    router.refresh();
  }

  async function save(id: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readTaskForm(event.currentTarget, editRelatedType)),
    });
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "更新できませんでした。");
    setEditingId(null);
    setError("");
    router.refresh();
  }

  async function setStatus(id: string, status: string) {
    const response = await fetch(`/api/tasks/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const result = await response.json();
      setError(result.message);
      return;
    }
    setError("");
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("このタスクを削除しますか？")) return;
    const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json();
      setError(result.message ?? "削除できませんでした。");
      return;
    }
    setError("");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "すべて"],
            ["today", "今日"],
            ["overdue", "期限切れ"],
            ["mine", "自分のタスク"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => router.push(`/tasks?filter=${value}`)}
              className={
                filter === value
                  ? "primary-button min-h-9 py-1.5"
                  : "secondary-button min-h-9 py-1.5"
              }
            >
              {label}
            </button>
          ))}
        </div>
        {canCreate ? (
          <button
            className="primary-button"
            onClick={() => {
              setOpen(!open);
              setEditingId(null);
            }}
          >
            タスクを追加
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {open ? (
        <TaskForm
          members={members}
          options={options}
          currentUserId={currentUserId}
          relatedType={createRelatedType}
          setRelatedType={setCreateRelatedType}
          submitLabel="作成する"
          onCancel={() => setOpen(false)}
          onSubmit={create}
        />
      ) : null}

      <section className="card overflow-hidden">
        {items.length ? (
          <div className="divide-y divide-line">
            {items.map((task) => {
              const overdue =
                task.dueDate &&
                new Date(task.dueDate) < new Date() &&
                task.status !== "COMPLETED";
              return (
                <div key={task.id} className="p-5">
                  {editingId === task.id ? (
                    <TaskForm
                      task={task}
                      members={members}
                      options={options}
                      currentUserId={currentUserId}
                      relatedType={editRelatedType}
                      setRelatedType={setEditRelatedType}
                      submitLabel="保存する"
                      embedded
                      onCancel={() => setEditingId(null)}
                      onSubmit={(event) => save(task.id, event)}
                    />
                  ) : (
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <button
                        aria-label="完了にする"
                        onClick={() =>
                          setStatus(
                            task.id,
                            task.status === "COMPLETED" ? "TODO" : "COMPLETED",
                          )
                        }
                        className={`h-6 w-6 shrink-0 rounded-full border-2 ${
                          task.status === "COMPLETED"
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-slate-300"
                        }`}
                      >
                        {task.status === "COMPLETED" ? "✓" : ""}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`font-bold ${
                            task.status === "COMPLETED"
                              ? "text-slate-400 line-through"
                              : ""
                          }`}
                        >
                          {task.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {typeLabels[task.taskType]} ・ {task.owner.name} ・{" "}
                          {statusLabels[task.status]}
                        </p>
                        {task.related ? (
                          <Link
                            href={`/${objectPaths[task.related.type]}/${task.related.id}`}
                            className="mt-2 inline-flex text-xs font-bold text-brand-700"
                          >
                            {objectLabels[task.related.type]}:{" "}
                            {task.related.name}
                          </Link>
                        ) : null}
                        {task.description ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-500">
                            {task.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            task.priority === "HIGH"
                              ? "bg-red-50 text-red-700"
                              : task.priority === "LOW"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {priorityLabels[task.priority]}
                        </span>
                        <p
                          className={`text-xs ${
                            overdue
                              ? "font-bold text-red-600"
                              : "text-slate-400"
                          }`}
                        >
                          {task.dueDate
                            ? new Intl.DateTimeFormat("ja-JP", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(task.dueDate))
                            : "期限なし"}
                        </p>
                        {canCreate ? (
                          <div className="flex gap-2">
                            <button
                              className="text-xs font-bold text-brand-700"
                              onClick={() => {
                                setEditingId(task.id);
                                setOpen(false);
                                setEditRelatedType(
                                  task.related?.type === "DELIVERY_PROJECT"
                                    ? "CONTACT"
                                    : task.related?.type ?? "CONTACT",
                                );
                              }}
                            >
                              編集
                            </button>
                            <button
                              className="text-xs font-bold text-red-500"
                              onClick={() => remove(task.id)}
                            >
                              削除
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center text-sm text-slate-400">
            該当するタスクはありません。
          </div>
        )}
      </section>
    </div>
  );
}

function TaskForm({
  task,
  members,
  options,
  currentUserId,
  relatedType,
  setRelatedType,
  submitLabel,
  embedded = false,
  onCancel,
  onSubmit,
}: {
  task?: Task;
  members: Option[];
  options: Record<ObjectType, Option[]>;
  currentUserId: string;
  relatedType: ObjectType;
  setRelatedType: (type: ObjectType) => void;
  submitLabel: string;
  embedded?: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={embedded ? "rounded-xl bg-canvas p-4" : "card mb-6 p-6"}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <label className="md:col-span-2">
          <span className="field-label">タスク名</span>
          <input
            className="text-field"
            name="title"
            defaultValue={task?.title}
            required
          />
        </label>
        <label>
          <span className="field-label">担当者</span>
          <select
            className="text-field"
            name="ownerUserId"
            defaultValue={task?.owner.id ?? currentUserId}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">期限</span>
          <input
            className="text-field"
            name="dueDate"
            type="datetime-local"
            defaultValue={toDateTimeLocal(task?.dueDate)}
          />
        </label>
        <label>
          <span className="field-label">ステータス</span>
          <select
            className="text-field"
            name="status"
            defaultValue={task?.status ?? "TODO"}
          >
            <option value="TODO">未着手</option>
            <option value="IN_PROGRESS">進行中</option>
            <option value="COMPLETED">完了</option>
            <option value="CANCELED">キャンセル</option>
          </select>
        </label>
        <label>
          <span className="field-label">優先度</span>
          <select
            className="text-field"
            name="priority"
            defaultValue={task?.priority ?? "MEDIUM"}
          >
            <option value="HIGH">高</option>
            <option value="MEDIUM">中</option>
            <option value="LOW">低</option>
          </select>
        </label>
        <label>
          <span className="field-label">種別</span>
          <select
            className="text-field"
            name="taskType"
            defaultValue={task?.taskType ?? "FOLLOW_UP"}
          >
            <option value="CALL">電話</option>
            <option value="EMAIL">メール</option>
            <option value="FOLLOW_UP">フォロー</option>
            <option value="MEETING">ミーティング</option>
            <option value="OTHER">その他</option>
          </select>
        </label>
        <label>
          <span className="field-label">関連する種類</span>
          <select
            className="text-field"
            value={relatedType}
            onChange={(event) =>
              setRelatedType(event.target.value as ObjectType)
            }
          >
            <option value="CONTACT">担当者</option>
            <option value="COMPANY">会社</option>
            <option value="DEAL">商談</option>
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="field-label">関連レコード</span>
          <select
            key={relatedType}
            className="text-field"
            name="relatedObjectId"
            defaultValue={
              task?.related?.type === relatedType ? task.related.id : ""
            }
          >
            <option value="">関連付けなし</option>
            {options[relatedType].map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-3">
          <span className="field-label">説明</span>
          <textarea
            className="text-field min-h-20"
            name="description"
            defaultValue={task?.description ?? ""}
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="secondary-button" onClick={onCancel}>
          閉じる
        </button>
        <button className="primary-button">{submitLabel}</button>
      </div>
    </form>
  );
}

function readTaskForm(form: HTMLFormElement, relatedType: ObjectType) {
  const data = new FormData(form);
  const relatedObjectId = String(data.get("relatedObjectId") ?? "");
  return {
    title: data.get("title"),
    description: data.get("description"),
    ownerUserId: data.get("ownerUserId"),
    dueDate: data.get("dueDate"),
    status: data.get("status"),
    priority: data.get("priority"),
    taskType: data.get("taskType"),
    relatedObjectType: relatedObjectId ? relatedType : null,
    relatedObjectId,
  };
}

function toDateTimeLocal(value?: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

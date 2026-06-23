"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Task = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | string | null;
  durationMinutes: number | null;
  timezone: string;
  status: string;
  priority: string;
  taskType: string;
  calendarSyncEnabled: boolean;
  calendarSyncStatus: string;
  googleEventHtmlLink: string | null;
  calendarSyncErrorMessage: string | null;
  owner: { id: string; name: string };
  reminders: Array<{ scheduledAt: Date | string; status: string }>;
};

type Option = { id: string; name: string };
type TaskContext =
  | { contextType: "DEAL"; contextId: string }
  | { contextType: "DELIVERY_PROJECT"; contextId: string };

const typeLabels: Record<string, string> = {
  CALL: "電話",
  EMAIL: "メール",
  FOLLOW_UP: "フォロー",
  MEETING: "ミーティング",
  OTHER: "その他",
};

const priorityLabels: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const calendarLabels: Record<string, string> = {
  NOT_REQUIRED: "同期なし",
  PENDING: "同期待ち",
  SYNCED: "同期済み",
  RETRY_PENDING: "再試行待ち",
  ERROR: "同期失敗",
  REAUTH_REQUIRED: "再認可が必要",
};

const reminderOptions = [
  { value: 0, label: "期限時刻" },
  { value: 10, label: "10分前" },
  { value: 30, label: "30分前" },
  { value: 60, label: "1時間前" },
  { value: 180, label: "3時間前" },
  { value: 1440, label: "1日前" },
];

export function RecordTaskCard({
  context,
  items,
  members,
  defaultOwnerUserId,
  canEdit,
  title = "タスク",
  description,
}: {
  context: TaskContext;
  items: Task[];
  members: Option[];
  defaultOwnerUserId: string;
  canEdit: boolean;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const activeTasks = items.filter(
    (task) => !["COMPLETED", "CANCELED"].includes(task.status),
  );
  const completedTasks = items.filter((task) =>
    ["COMPLETED", "CANCELED"].includes(task.status),
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingId("create");
    const payload = readTaskForm(event.currentTarget, context);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setPendingId(null);
    if (!response.ok)
      return setError(result.message ?? "作成できませんでした。");
    setOpen(false);
    setError("");
    event.currentTarget.reset();
    router.refresh();
  }

  async function save(id: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingId(id);
    const response = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readTaskForm(event.currentTarget, context)),
    });
    const result = await response.json();
    setPendingId(null);
    if (!response.ok)
      return setError(result.message ?? "更新できませんでした。");
    setEditingId(null);
    setError("");
    router.refresh();
  }

  async function setStatus(id: string, status: string) {
    setPendingId(id);
    const response = await fetch(`/api/tasks/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPendingId(null);
    if (!response.ok) {
      const result = await response.json();
      setError(result.message ?? "更新できませんでした。");
      return;
    }
    setError("");
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("このタスクを削除しますか？")) return;
    setPendingId(id);
    const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setPendingId(null);
    if (!response.ok) {
      const result = await response.json();
      setError(result.message ?? "削除できませんでした。");
      return;
    }
    setError("");
    router.refresh();
  }

  async function retrySync(id: string) {
    setPendingId(id);
    const response = await fetch(`/api/tasks/${id}/sync`, { method: "POST" });
    const result = await response.json();
    setPendingId(null);
    if (!response.ok)
      return setError(result.message ?? "再同期できませんでした。");
    if (result.status === "REAUTH_REQUIRED") {
      setError("担当者のGoogle Calendarが未接続です。");
    } else {
      setError("");
    }
    router.refresh();
  }

  return (
    <section className="card p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-bold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {description ??
              "次回対応、リマインド、Google Calendar同期をこのレコードに紐付けて管理します。"}
          </p>
        </div>
        {canEdit ? (
          <button
            className="primary-button"
            onClick={() => {
              setOpen(!open);
              setEditingId(null);
            }}
          >
            ＋ タスク作成
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {open ? (
        <TaskForm
          members={members}
          defaultOwnerUserId={defaultOwnerUserId}
          pending={pendingId === "create"}
          submitLabel="作成する"
          onCancel={() => setOpen(false)}
          onSubmit={create}
        />
      ) : null}

      <div className="mt-5 space-y-3">
        {activeTasks.map((task) =>
          editingId === task.id ? (
            <TaskForm
              key={task.id}
              task={task}
              members={members}
              defaultOwnerUserId={defaultOwnerUserId}
              pending={pendingId === task.id}
              submitLabel="保存する"
              onCancel={() => setEditingId(null)}
              onSubmit={(event) => save(task.id, event)}
            />
          ) : (
            <TaskRow
              key={task.id}
              task={task}
              canEdit={canEdit}
              pending={pendingId === task.id}
              onComplete={() => setStatus(task.id, "COMPLETED")}
              onEdit={() => setEditingId(task.id)}
              onDelete={() => remove(task.id)}
              onRetrySync={() => retrySync(task.id)}
            />
          ),
        )}
        {!activeTasks.length ? (
          <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-slate-400">
            未完了タスクはありません。
          </p>
        ) : null}
      </div>

      {completedTasks.length ? (
        <div className="mt-5">
          <button
            className="text-sm font-bold text-slate-500 hover:text-brand-700"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            完了済みタスク {completedTasks.length}件
          </button>
          {showCompleted ? (
            <div className="mt-3 space-y-3">
              {completedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  canEdit={canEdit}
                  pending={pendingId === task.id}
                  completed
                  onComplete={() => setStatus(task.id, "TODO")}
                  onEdit={() => setEditingId(task.id)}
                  onDelete={() => remove(task.id)}
                  onRetrySync={() => retrySync(task.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function DealTaskCard({
  dealId,
  items,
  members,
  defaultOwnerUserId,
  canEdit,
}: {
  dealId: string;
  items: Task[];
  members: Option[];
  defaultOwnerUserId: string;
  canEdit: boolean;
}) {
  return (
    <RecordTaskCard
      context={{ contextType: "DEAL", contextId: dealId }}
      items={items}
      members={members}
      defaultOwnerUserId={defaultOwnerUserId}
      canEdit={canEdit}
      description="次回対応、リマインド、Google Calendar同期をこの商談に紐付けて管理します。"
    />
  );
}

function TaskRow({
  task,
  canEdit,
  pending,
  completed = false,
  onComplete,
  onEdit,
  onDelete,
  onRetrySync,
}: {
  task: Task;
  canEdit: boolean;
  pending: boolean;
  completed?: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetrySync: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <button
          aria-label="完了"
          disabled={!canEdit || pending}
          onClick={onComplete}
          className={`mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 ${
            completed || task.status === "COMPLETED"
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-slate-300"
          }`}
        >
          {completed || task.status === "COMPLETED" ? "✓" : ""}
        </button>
        <div className="min-w-0 flex-1">
          <p
            className={`font-bold ${completed ? "text-slate-400 line-through" : "text-ink"}`}
          >
            {task.title}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {typeLabels[task.taskType]} ・ {task.owner.name} ・ 優先度
            {priorityLabels[task.priority]}
          </p>
          {task.description ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {task.description}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              期限: {formatDate(task.dueDate, task.timezone)}
            </span>
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-700">
              リマインド:{" "}
              {task.reminders.length ? `${task.reminders.length}件` : "なし"}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              Calendar:{" "}
              {calendarLabels[task.calendarSyncStatus] ??
                task.calendarSyncStatus}
            </span>
            {task.googleEventHtmlLink ? (
              <a
                className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"
                href={task.googleEventHtmlLink}
                target="_blank"
                rel="noreferrer"
              >
                Googleで開く
              </a>
            ) : null}
          </div>
          {task.calendarSyncErrorMessage ? (
            <p className="mt-2 text-xs font-bold text-red-600">
              {task.calendarSyncErrorMessage}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            {["ERROR", "RETRY_PENDING", "REAUTH_REQUIRED"].includes(
              task.calendarSyncStatus,
            ) ? (
              <button
                className="secondary-button min-h-9 py-1.5 text-xs"
                disabled={pending}
                onClick={onRetrySync}
              >
                再同期
              </button>
            ) : null}
            <button
              className="secondary-button min-h-9 py-1.5 text-xs"
              disabled={pending}
              onClick={onEdit}
            >
              編集
            </button>
            <button
              className="secondary-button min-h-9 py-1.5 text-xs text-red-600"
              disabled={pending}
              onClick={onDelete}
            >
              削除
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TaskForm({
  task,
  members,
  defaultOwnerUserId,
  pending,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  task?: Task;
  members: Option[];
  defaultOwnerUserId: string;
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const defaultOffsets = task ? offsetsFromTask(task) : [30];
  return (
    <form onSubmit={onSubmit} className="mt-5 rounded-xl bg-canvas p-4">
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
            defaultValue={task?.owner.id ?? defaultOwnerUserId}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">期限日時</span>
          <input
            className="text-field"
            name="dueDate"
            type="datetime-local"
            defaultValue={toDateTimeLocal(task?.dueDate)}
          />
        </label>
        <label>
          <span className="field-label">所要時間</span>
          <select
            className="text-field"
            name="durationMinutes"
            defaultValue={task?.durationMinutes ?? 30}
          >
            <option value="15">15分</option>
            <option value="30">30分</option>
            <option value="60">60分</option>
            <option value="90">90分</option>
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
        <fieldset className="md:col-span-2">
          <span className="field-label">リマインド</span>
          <div className="grid gap-2 rounded-lg border border-line bg-white p-3 sm:grid-cols-3">
            {reminderOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm font-medium text-slate-600"
              >
                <input
                  type="checkbox"
                  name="reminderOffsets"
                  value={option.value}
                  defaultChecked={defaultOffsets.includes(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-slate-600">
          <input
            type="checkbox"
            name="calendarSyncEnabled"
            defaultChecked={task?.calendarSyncEnabled ?? false}
          />
          Google Calendarへ追加
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
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
          disabled={pending}
        >
          閉じる
        </button>
        <button className="primary-button" disabled={pending}>
          {pending ? "保存中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function readTaskForm(form: HTMLFormElement, context: TaskContext) {
  const data = new FormData(form);
  const reminderOffsets = data
    .getAll("reminderOffsets")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  return {
    title: data.get("title"),
    description: data.get("description"),
    ownerUserId: data.get("ownerUserId"),
    dueDate: data.get("dueDate"),
    durationMinutes: data.get("durationMinutes"),
    timezone: "Asia/Tokyo",
    reminderOffsets,
    calendarSyncEnabled: data.get("calendarSyncEnabled") === "on",
    status: data.get("status"),
    priority: data.get("priority"),
    taskType: data.get("taskType"),
    relatedObjectType: context.contextType === "DEAL" ? "DEAL" : null,
    relatedObjectId: context.contextType === "DEAL" ? context.contextId : null,
    deliveryProjectId:
      context.contextType === "DELIVERY_PROJECT" ? context.contextId : null,
  };
}

function formatDate(value: Date | string | null, timezone: string) {
  if (!value) return "期限なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "期限なし";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateTimeLocal(value?: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(" ", "T");
}

function offsetsFromTask(task: Task) {
  if (!task.dueDate) return [];
  const due = new Date(task.dueDate).getTime();
  return task.reminders
    .map((reminder) =>
      Math.round((due - new Date(reminder.scheduledAt).getTime()) / 60_000),
    )
    .filter((offset) => offset >= 0);
}

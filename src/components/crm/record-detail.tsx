import { ActivityComposer } from "./activity-composer";
import { AssociationManager } from "./association-manager";
import { EmailLogComposer } from "./email-log-composer";
import { RecordPropertyDescriptor, RecordPropertyList } from "./inline-property-field";
import { RecordActions } from "./record-actions";

type Activity = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  occurredAt: Date;
  actor: { name: string } | null;
};
type Related = {
  associationId: string;
  id: string;
  name: string;
  type: "CONTACT" | "COMPANY" | "DEAL";
  label: string | null;
  isPrimary: boolean;
};
type Option = { id: string; name: string };

export function RecordDetail({
  objectType,
  objectId,
  fields,
  properties,
  activities,
  related,
  options,
  editHref,
  endpoint,
  canEdit,
  canDelete,
  defaultEmail = "",
}: {
  objectType: "CONTACT" | "COMPANY" | "DEAL";
  objectId: string;
  fields: Array<{ label: string; value: React.ReactNode }>;
  properties?: RecordPropertyDescriptor[];
  activities: Activity[];
  related: Related[];
  options: Record<"CONTACT" | "COMPANY" | "DEAL", Option[]>;
  editHref: string;
  endpoint: string;
  canEdit: boolean;
  canDelete: boolean;
  defaultEmail?: string;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      <aside className="space-y-4">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">基本情報</h2>
            <RecordActions
              editHref={editHref}
              endpoint={endpoint}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          </div>
          {properties ? (
            <RecordPropertyList
              objectType={objectType}
              objectId={objectId}
              properties={properties}
              canEdit={canEdit}
            />
          ) : (
            <dl className="mt-5 space-y-4">
              {fields.map((field) => (
                <div key={field.label}>
                  <dt className="text-xs font-semibold text-slate-400">
                    {field.label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium text-ink">
                    {field.value || "未設定"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </aside>
      <main className="space-y-4">
        <EmailLogComposer
          objectType={objectType}
          objectId={objectId}
          defaultTo={defaultEmail}
          canEdit={canEdit}
        />
        <ActivityComposer
          objectType={objectType}
          objectId={objectId}
          canEdit={canEdit}
        />
        <section className="card p-6">
          <h2 className="font-bold">活動タイムライン</h2>
          <div className="mt-6 space-y-6">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="relative border-l-2 border-brand-100 pl-5"
              >
                <span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
                <div className="flex flex-col justify-between gap-1 sm:flex-row">
                  <p className="text-sm font-bold">{activity.title}</p>
                  <time className="text-xs text-slate-400">
                    {new Intl.DateTimeFormat("ja-JP", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(activity.occurredAt)}
                  </time>
                </div>
                {activity.body ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {activity.body}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-slate-400">
                  {activity.actor?.name ?? "システム"} ・{" "}
                  {activityTypeLabel(activity.type)}
                </p>
              </div>
            ))}
            {!activities.length ? (
              <p className="text-sm text-slate-400">
                活動履歴はまだありません。
              </p>
            ) : null}
          </div>
        </section>
      </main>
      <aside className="card p-5">
        <h2 className="mb-5 font-bold">関連データ</h2>
        <AssociationManager
          objectType={objectType}
          objectId={objectId}
          related={related}
          options={options}
          canEdit={canEdit}
        />
      </aside>
    </div>
  );
}

function activityTypeLabel(type: string) {
  return (
    (
      {
        NOTE: "メモ",
        EMAIL: "メール",
        CALL: "通話",
        MEETING: "ミーティング",
        FORM_SUBMITTED: "フォーム送信",
        CHAT_MESSAGE: "チャット",
        PROPERTY_UPDATED: "更新",
        STAGE_CHANGED: "ステージ変更",
        SYSTEM_EVENT: "システム",
      } as Record<string, string>
    )[type] ?? type
  );
}

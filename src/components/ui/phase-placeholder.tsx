import { PageHeading } from "./page-heading";

export function PhasePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading eyebrow="CRM workspace" title={title} description={description} />
      <section className="card grid min-h-[360px] place-items-center p-8 text-center">
        <div className="max-w-md">
          <span className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
            {phase} で実装
          </span>
          <h2 className="mt-5 text-xl font-bold">基盤は準備できています</h2>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            組織分離、所有者、権限、監査ログを前提に、この画面の実データCRUDを次フェーズで追加します。
          </p>
        </div>
      </section>
    </div>
  );
}

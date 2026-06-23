"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Deal = {
  id: string;
  name: string;
  amount: number | null;
  expectedCloseDate: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  ownerName: string;
  companyName: string | null;
  stageId: string;
};

type Stage = {
  id: string;
  name: string;
  stageType: "OPEN" | "WON" | "LOST";
  probability: number;
  deals: Deal[];
};

type PendingMove = {
  deal: Deal;
  stage: Stage;
};

export function KanbanBoard({ stages }: { stages: Stage[] }) {
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [active, setActive] = useState<Deal | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [error, setError] = useState("");

  const allDeals = stages.flatMap((stage) => stage.deals);

  async function dragEnd(event: DragEndEvent) {
    setActive(null);
    const deal = allDeals.find((item) => item.id === event.active.id);
    const stage = stages.find((item) => item.id === event.over?.id);
    if (!deal || !stage || deal.stageId === stage.id) return;

    if (stage.stageType === "LOST") {
      setPendingMove({ deal, stage });
      setLostReason("");
      return;
    }

    await updateStage(deal, stage);
  }

  async function submitLostReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingMove || !lostReason.trim()) return;
    await updateStage(pendingMove.deal, pendingMove.stage, lostReason.trim());
  }

  async function updateStage(deal: Deal, stage: Stage, reason?: string) {
    const response = await fetch(`/api/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: stage.id, lostReason: reason ?? null }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "ステージを変更できませんでした。");
      return;
    }

    setError("");
    setPendingMove(null);
    setLostReason("");
    router.refresh();
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(event) =>
          setActive(
            allDeals.find((deal) => deal.id === event.active.id) ?? null,
          )
        }
        onDragEnd={dragEnd}
        onDragCancel={() => setActive(null)}
      >
        {error ? (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex gap-4 overflow-x-auto pb-5">
          {stages.map((stage) => (
            <StageColumn key={stage.id} stage={stage} />
          ))}
        </div>
        <DragOverlay>
          {active ? <DealCard deal={active} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {pendingMove ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/35 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="失注理由"
        >
          <form
            onSubmit={submitLostReason}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="font-bold">失注理由を入力</h2>
            <p className="mt-2 text-sm text-slate-500">
              {pendingMove.deal.name} を「{pendingMove.stage.name}
              」へ移動します。
            </p>
            <textarea
              className="text-field mt-4 min-h-28"
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value)}
              autoFocus
              required
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setPendingMove(null);
                  setLostReason("");
                }}
              >
                キャンセル
              </button>
              <button className="primary-button">ステージを変更</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function StageColumn({ stage }: { stage: Stage }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = stage.deals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);

  return (
    <section
      ref={setNodeRef}
      className={`w-[300px] shrink-0 rounded-2xl border p-3 transition ${
        isOver ? "border-brand-500 bg-brand-50" : "border-line bg-[#eef1ed]"
      }`}
    >
      <div className="mb-3 px-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{stage.name}</h2>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500">
            {stage.deals.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {total.toLocaleString("ja-JP")}円 ・ 確度{stage.probability}%
        </p>
      </div>
      <div className="min-h-24 space-y-3">
        {stage.deals.map((deal) => (
          <DraggableCard key={deal.id} deal={deal} />
        ))}
        {!stage.deals.length ? (
          <div className="grid min-h-24 place-items-center rounded-xl border border-dashed border-slate-300 text-xs font-bold text-slate-400">
            ここに移動
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DraggableCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className={
        isDragging ? "opacity-30" : "cursor-grab active:cursor-grabbing"
      }
    >
      <DealCard deal={deal} />
    </div>
  );
}

function DealCard({
  deal,
  overlay = false,
}: {
  deal: Deal;
  overlay?: boolean;
}) {
  const nextActionDate = deal.nextActionDate
    ? new Intl.DateTimeFormat("ja-JP", {
        month: "short",
        day: "numeric",
      }).format(new Date(deal.nextActionDate))
    : "日付未設定";

  return (
    <article
      className={`rounded-xl border border-line bg-white p-4 ${
        overlay ? "w-[285px] rotate-2 shadow-xl" : "shadow-sm"
      }`}
    >
      <Link
        href={`/deals/${deal.id}`}
        onClick={(event) => event.stopPropagation()}
        className="text-sm font-bold hover:text-brand-700"
      >
        {deal.name}
      </Link>
      <p className="mt-2 text-xs text-slate-500">
        {deal.companyName ?? "会社未設定"}
      </p>
      <p className="mt-4 text-lg font-bold">
        {deal.amount
          ? `${deal.amount.toLocaleString("ja-JP")}円`
          : "金額未設定"}
      </p>
      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
          <span>ネクストアクション</span>
          <span className="shrink-0">{nextActionDate}</span>
        </div>
        <p className="mt-1 max-h-10 overflow-hidden break-words text-xs leading-5 text-slate-600">
          {deal.nextAction?.trim() || "メモ未設定"}
        </p>
      </div>
      <div className="mt-3 flex items-end justify-between text-xs text-slate-400">
        <span>{deal.ownerName}</span>
        <span>
          {deal.expectedCloseDate
            ? new Intl.DateTimeFormat("ja-JP", {
                month: "short",
                day: "numeric",
              }).format(new Date(deal.expectedCloseDate))
            : "予定日なし"}
        </span>
      </div>
    </article>
  );
}

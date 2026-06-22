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
import { useState } from "react";

type DeliveryProjectCard = {
  id: string;
  name: string;
  companyName: string | null;
  ownerName: string;
  expectedPublishDate: string | null;
  nextAction: string | null;
  healthStatus: string;
  blocker: string | null;
  stageId: string | null;
  stageEnteredAt: string | null;
};

type DeliveryStage = {
  id: string;
  name: string;
  color: string | null;
  staleDays: number | null;
  projects: DeliveryProjectCard[];
};

const healthLabels: Record<string, string> = {
  ON_TRACK: "順調",
  AT_RISK: "注意",
  OFF_TRACK: "遅延",
  BLOCKED: "停止",
};

const healthClass: Record<string, string> = {
  ON_TRACK: "bg-emerald-50 text-emerald-700",
  AT_RISK: "bg-amber-50 text-amber-700",
  OFF_TRACK: "bg-red-50 text-red-700",
  BLOCKED: "bg-slate-900 text-white",
};

function formatDate(value: string | null) {
  if (!value) return "予定日なし";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function stayedDays(value: string | null) {
  if (!value) return null;
  const entered = new Date(value);
  const today = new Date();
  const diff = Math.max(
    Math.floor((today.getTime() - entered.getTime()) / 86400000),
    0,
  );
  return diff;
}

export function DeliveryPipelineBoard({ stages }: { stages: DeliveryStage[] }) {
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [active, setActive] = useState<DeliveryProjectCard | null>(null);
  const [error, setError] = useState("");
  const allProjects = stages.flatMap((stage) => stage.projects);

  async function dragEnd(event: DragEndEvent) {
    setActive(null);
    const project = allProjects.find((item) => item.id === event.active.id);
    const stage = stages.find((item) => item.id === event.over?.id);
    if (!project || !stage || project.stageId === stage.id) return;
    const response = await fetch(`/api/delivery-projects/${project.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: stage.id }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "制作ステージを変更できませんでした。");
      return;
    }
    setError("");
    router.refresh();
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) =>
        setActive(
          allProjects.find((project) => project.id === event.active.id) ?? null,
        )
      }
      onDragEnd={dragEnd}
      onDragCancel={() => setActive(null)}
    >
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-4 overflow-x-auto pb-5">
        {stages.map((stage) => (
          <DeliveryStageColumn key={stage.id} stage={stage} />
        ))}
      </div>
      <DragOverlay>
        {active ? <ProjectCard project={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function DeliveryStageColumn({ stage }: { stage: DeliveryStage }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      ref={setNodeRef}
      className={`w-[310px] shrink-0 rounded-lg border p-3 transition ${
        isOver ? "border-brand-500 bg-brand-50" : "border-line bg-slate-50"
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <h2 className="text-sm font-bold text-ink">{stage.name}</h2>
          <p className="mt-1 text-xs text-slate-500">
            停滞判定 {stage.staleDays ?? "-"}日
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500">
          {stage.projects.length}
        </span>
      </div>
      <div className="min-h-28 space-y-3">
        {stage.projects.map((project) => (
          <DraggableProjectCard key={project.id} project={project} />
        ))}
        {!stage.projects.length ? (
          <div className="grid min-h-24 place-items-center rounded-md border border-dashed border-slate-300 text-xs font-bold text-slate-400">
            移動先
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DraggableProjectCard({ project }: { project: DeliveryProjectCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: project.id });
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
      <ProjectCard project={project} />
    </div>
  );
}

function ProjectCard({
  project,
  overlay = false,
}: {
  project: DeliveryProjectCard;
  overlay?: boolean;
}) {
  const days = stayedDays(project.stageEnteredAt);
  return (
    <article
      className={`rounded-lg border border-line bg-white p-4 ${
        overlay ? "w-[295px] rotate-1 shadow-xl" : "shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/delivery-projects/${project.id}`}
          onClick={(event) => event.stopPropagation()}
          className="text-sm font-bold leading-5 text-ink hover:text-brand-700"
        >
          {project.name}
        </Link>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            healthClass[project.healthStatus] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {healthLabels[project.healthStatus] ?? project.healthStatus}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {project.companyName ?? "会社未設定"}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-400">CS</dt>
          <dd className="mt-1 font-semibold text-slate-700">
            {project.ownerName}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">公開予定</dt>
          <dd className="mt-1 font-semibold text-slate-700">
            {formatDate(project.expectedPublishDate)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">
        {project.nextAction ?? "次回アクション未設定"}
      </p>
      <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-400">
        <span>{days === null ? "滞在日数 -" : `${days}日滞在`}</span>
        {project.blocker ? <span className="text-red-700">blockerあり</span> : null}
      </div>
    </article>
  );
}

import { ObjectType, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { TaskManager } from "@/components/tasks/task-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAssociationOptions } from "@/lib/record-data";
import { taskOwnerScope } from "@/lib/tasks";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const { filter = "all" } = await searchParams;
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const where: Prisma.TaskWhereInput = {
    organizationId: context.organization.id,
    ...(await taskOwnerScope(context)),
    ...(filter === "mine" ? { ownerUserId: context.user.id } : {}),
    ...(filter === "today"
      ? {
          dueDate: { gte: today, lt: tomorrow },
          status: { notIn: ["COMPLETED", "CANCELED"] },
        }
      : {}),
    ...(filter === "overdue"
      ? {
          dueDate: { lt: today },
          status: { notIn: ["COMPLETED", "CANCELED"] },
        }
      : {}),
  };

  const [tasks, members, options] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { owner: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
    }),
    getAssociationOptions(context.organization.id),
  ]);

  const relatedByTaskId = await getTaskRelatedRecords(
    context.organization.id,
    tasks.map((task) => task.id),
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Tasks"
        title="タスク"
        description="今日の対応、期限切れ、担当タスクを一つの画面で管理します。"
      />
      <TaskManager
        items={tasks.map((task) => ({
          ...task,
          related: relatedByTaskId.get(task.id) ?? null,
        }))}
        members={members.map((member) => member.user)}
        options={options}
        filter={filter}
        currentUserId={context.user.id}
        canCreate={hasPermission(context.membership.role, Permission.CRM_WRITE)}
      />
    </div>
  );
}

async function getTaskRelatedRecords(
  organizationId: string,
  taskIds: string[],
) {
  const related = new Map<
    string,
    {
      type: "CONTACT" | "COMPANY" | "DEAL" | "DELIVERY_PROJECT";
      id: string;
      name: string;
    }
  >();
  if (!taskIds.length) return related;

  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId,
      sourceObjectType: ObjectType.TASK,
      sourceObjectId: { in: taskIds },
      targetObjectType: {
        in: [ObjectType.CONTACT, ObjectType.COMPANY, ObjectType.DEAL],
      },
    },
  });

  const [contacts, companies, deals] = await Promise.all([
    prisma.contact.findMany({
      where: {
        organizationId,
        id: {
          in: links
            .filter((link) => link.targetObjectType === ObjectType.CONTACT)
            .map((link) => link.targetObjectId),
        },
        deletedAt: null,
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    prisma.company.findMany({
      where: {
        organizationId,
        id: {
          in: links
            .filter((link) => link.targetObjectType === ObjectType.COMPANY)
            .map((link) => link.targetObjectId),
        },
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        id: {
          in: links
            .filter((link) => link.targetObjectType === ObjectType.DEAL)
            .map((link) => link.targetObjectId),
        },
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
  ]);

  const names = new Map<string, string>();
  contacts.forEach((contact) =>
    names.set(
      contact.id,
      `${contact.lastName ?? ""} ${contact.firstName ?? ""}`.trim() ||
        contact.email ||
        "名称未設定",
    ),
  );
  companies.forEach((company) => names.set(company.id, company.name));
  deals.forEach((deal) => names.set(deal.id, deal.name));

  for (const link of links) {
    const name = names.get(link.targetObjectId);
    if (!name) continue;
    related.set(link.sourceObjectId, {
      type: link.targetObjectType as "CONTACT" | "COMPANY" | "DEAL",
      id: link.targetObjectId,
      name,
    });
  }

  const deliveryTasks = await prisma.task.findMany({
    where: {
      organizationId,
      id: { in: taskIds },
      deliveryProjectId: { not: null },
    },
    select: {
      id: true,
      deliveryProject: { select: { id: true, name: true } },
    },
  });
  for (const task of deliveryTasks) {
    if (!task.deliveryProject || related.has(task.id)) continue;
    related.set(task.id, {
      type: "DELIVERY_PROJECT",
      id: task.deliveryProject.id,
      name: task.deliveryProject.name,
    });
  }

  return related;
}

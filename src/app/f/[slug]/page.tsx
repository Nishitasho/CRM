import { notFound } from "next/navigation";
import { PublicForm } from "@/components/public/public-form";
import { prisma } from "@/lib/prisma";
import { formFieldSchema } from "@/lib/validation";

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const form = await prisma.form.findUnique({
    where: { slug },
    include: { organization: { select: { name: true } } },
  });
  if (!form || form.status === "PAUSED" || form.status === "ARCHIVED") notFound();
  const version = form.publishedVersionId
    ? await prisma.formVersion.findFirst({
        where: { id: form.publishedVersionId, formId: form.id },
      })
    : null;
  const fieldSchema = version?.fieldSchema ?? form.fields;
  const fields = Array.isArray(fieldSchema)
    ? fieldSchema.map((field) => formFieldSchema.parse(field))
    : [];
  return (
    <main className="min-h-screen bg-white px-4 py-8 md:py-12">
      <div className="mx-auto max-w-xl">
        <div className="border-b border-line pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">
            {form.organization.name}
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-950">
            {version?.nameSnapshot ?? form.name}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {version?.descriptionSnapshot ?? form.description ?? "必要事項をご入力ください。"}
          </p>
        </div>
        <div className="py-8">
          <PublicForm
            slug={slug}
            fields={fields}
            buttonText={version?.submitButtonTextSnapshot ?? form.submitButtonText}
            completionMessage={
              version?.completionMessageSnapshot ?? form.completionMessage
            }
          />
        </div>
      </div>
    </main>
  );
}

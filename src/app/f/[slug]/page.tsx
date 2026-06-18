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
  if (!form) notFound();
  const fields = Array.isArray(form.fields)
    ? form.fields.map((field) => formFieldSchema.parse(field))
    : [];
  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="card p-7 md:p-10">
          <p className="eyebrow">{form.organization.name}</p>
          <h1 className="mb-2 mt-3 text-3xl font-bold">{form.name}</h1>
          <p className="mb-8 text-sm text-slate-500">
            必要事項をご入力ください。
          </p>
          <PublicForm
            slug={slug}
            fields={fields}
            buttonText={form.submitButtonText}
          />
        </div>
      </div>
    </main>
  );
}

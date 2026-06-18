import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  createPublicContactActivity,
  upsertPublicContact,
} from "@/lib/public-intake";
import { formFieldSchema, publicFormSubmissionSchema } from "@/lib/validation";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const form = await prisma.form.findUnique({ where: { slug } });
    if (!form)
      return NextResponse.json(
        { message: "フォームが見つかりません。" },
        { status: 404 },
      );
    const fields = Array.isArray(form.fields)
      ? form.fields.map((field) => formFieldSchema.parse(field))
      : [];
    const payload = publicFormSubmissionSchema.parse(await request.json());
    for (const field of fields) {
      if (field.required && !payload[field.name]) {
        return NextResponse.json(
          { message: `${field.label}を入力してください。` },
          { status: 400 },
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const contact = await upsertPublicContact(tx, {
        organizationId: form.organizationId,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        phone: payload.phone,
        jobTitle: payload.jobTitle,
        source: `フォーム: ${form.name}`,
      });
      const submission = await tx.formSubmission.create({
        data: {
          organizationId: form.organizationId,
          formId: form.id,
          contactId: contact.id,
          rawPayload: payload as Prisma.InputJsonValue,
        },
      });
      await createPublicContactActivity(tx, {
        organizationId: form.organizationId,
        contactId: contact.id,
        type: "FORM_SUBMITTED",
        title: `フォーム「${form.name}」が送信されました`,
        body: payload.message,
        metadata: { formId: form.id, submissionId: submission.id },
      });
      return submission;
    });

    return NextResponse.json({
      ok: true,
      id: result.id,
      redirectUrl: form.redirectUrl,
    });
  } catch (error) {
    return apiError(error);
  }
}

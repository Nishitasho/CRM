import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  createPublicContactActivity,
  upsertPublicContact,
} from "@/lib/public-intake";
import { chatSubmissionSchema } from "@/lib/validation";
type Params = { params: Promise<{ organizationSlug: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationSlug } = await params;
    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug },
    });
    if (!organization)
      return NextResponse.json(
        { message: "受付ページが見つかりません。" },
        { status: 404 },
      );
    const input = chatSubmissionSchema.parse(await request.json());
    await prisma.$transaction(async (tx) => {
      const contact = await upsertPublicContact(tx, {
        organizationId: organization.id,
        email: input.visitorEmail,
        firstName: input.visitorName,
        source: "チャット問い合わせ",
      });
      const conversation = await tx.conversation.create({
        data: {
          organizationId: organization.id,
          contactId: contact.id,
          visitorName: input.visitorName,
          visitorEmail: input.visitorEmail.toLowerCase(),
          message: input.message,
          metadata: { channel: "web_widget" } as Prisma.InputJsonValue,
        },
      });
      await createPublicContactActivity(tx, {
        organizationId: organization.id,
        contactId: contact.id,
        type: "CHAT_MESSAGE",
        title: "Webチャットから問い合わせがありました",
        body: input.message,
        metadata: { conversationId: conversation.id },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

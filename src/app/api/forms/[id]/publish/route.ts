import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { publishForm } from "@/lib/form-submissions";
import { Permission, requirePermission } from "@/lib/permissions";
import { formPublishSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    formPublishSchema.parse(await request.json().catch(() => ({})));
    const { id } = await params;
    const result = await publishForm({
      organizationId: context.organization.id,
      formId: id,
      userId: context.user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext, switchActiveOrganization } from "@/lib/auth";
import { switchOrganizationSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    }
    const input = switchOrganizationSchema.parse(await request.json());
    const switched = await switchActiveOrganization(context, input.organizationId);
    if (!switched) {
      return NextResponse.json(
        { message: "この組織を利用する権限がありません。" },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createInternalAppointment } from "@/lib/appointments";
import { getAuthContext } from "@/lib/auth";
import { canCreateInternalAppointment } from "@/lib/internal-appointments";
import { Permission, requirePermission } from "@/lib/permissions";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    if (!(await canCreateInternalAppointment(context))) {
      return NextResponse.json(
        { message: "IS所属ユーザーのみアポ登録できます。" },
        { status: 403 },
      );
    }
    const result = await createInternalAppointment(context, await request.json());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}

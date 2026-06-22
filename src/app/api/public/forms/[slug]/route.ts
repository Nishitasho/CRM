import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { submitPublicForm } from "@/lib/form-submissions";
import { publicFormSubmissionSchema } from "@/lib/validation";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const body = publicFormSubmissionSchema.parse(await request.json());
    const metadata = getRequestMetadata(request);
    const result = await submitPublicForm({
      slug,
      body,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

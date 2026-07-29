type SmokeResult = {
  name: string;
  url: string;
  expected: string;
  status: number | null;
  location: string | null;
  result: "PASS" | "FAIL" | "SKIPPED";
  notes: string;
};

const previewUrl =
  process.env.VERCEL_PREVIEW_URL ?? process.env.PREVIEW_URL ?? "";
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const allowAuth = process.env.PREVIEW_SMOKE_ALLOW_AUTH === "true";
const dbKind = process.env.PREVIEW_SMOKE_DB_KIND ?? "";
const smokeEmail = process.env.PREVIEW_SMOKE_EMAIL ?? "e2e-admin@example.com";
const smokePassword = process.env.PREVIEW_SMOKE_PASSWORD ?? "E2eSample123!";

function normalizeBaseUrl(url: string) {
  if (!url) return "";
  return url.startsWith("http") ? url.replace(/\/+$/, "") : `https://${url.replace(/\/+$/, "")}`;
}

function isVercelSso(location: string | null) {
  return Boolean(location?.includes("vercel.com/sso-api"));
}

function headers(cookie?: string) {
  const next: Record<string, string> = {
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  };
  if (bypassSecret) next["x-vercel-protection-bypass"] = bypassSecret;
  if (cookie) next.cookie = cookie;
  return next;
}

function setCookieHeader(response: Response) {
  const getSetCookie = (response.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie;
  const values = typeof getSetCookie === "function"
    ? getSetCookie.call(response.headers)
    : [response.headers.get("set-cookie")].filter(Boolean) as string[];

  return values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function classify(input: {
  name: string;
  url: string;
  expected: string;
  status: number | null;
  location: string | null;
  acceptableStatuses: number[];
}) {
  if (input.status === null) {
    return { result: "FAIL" as const, notes: "Request failed before receiving a response." };
  }
  if (isVercelSso(input.location)) {
    return {
      result: "FAIL" as const,
      notes: "Reached Vercel Deployment Protection SSO instead of the app.",
    };
  }
  if (input.acceptableStatuses.includes(input.status)) {
    return { result: "PASS" as const, notes: "Reached app or app-owned auth boundary." };
  }
  return {
    result: "FAIL" as const,
    notes: `Unexpected status. Expected one of ${input.acceptableStatuses.join(", ")}.`,
  };
}

async function requestStep(input: {
  baseUrl: string;
  name: string;
  path: string;
  expected: string;
  acceptableStatuses: number[];
  cookie?: string;
}): Promise<SmokeResult> {
  const url = `${input.baseUrl}${input.path}`;
  try {
    const response = await fetch(url, {
      headers: headers(input.cookie),
      redirect: "manual",
    });
    const location = response.headers.get("location");
    return {
      name: input.name,
      url,
      expected: input.expected,
      status: response.status,
      location,
      ...classify({
        name: input.name,
        url,
        expected: input.expected,
        status: response.status,
        location,
        acceptableStatuses: input.acceptableStatuses,
      }),
    };
  } catch (error) {
    return {
      name: input.name,
      url,
      expected: input.expected,
      status: null,
      location: null,
      result: "FAIL",
      notes: error instanceof Error ? error.message : "Unknown request error.",
    };
  }
}

async function login(baseUrl: string) {
  if (!allowAuth) {
    return {
      cookie: "",
      result: {
        name: "authenticated login",
        url: `${baseUrl}/api/auth/login`,
        expected: "Skipped unless PREVIEW_SMOKE_ALLOW_AUTH=true.",
        status: null,
        location: null,
        result: "SKIPPED" as const,
        notes: "Authenticated smoke disabled.",
      },
    };
  }

  if (dbKind !== "dedicated-test") {
    return {
      cookie: "",
      result: {
        name: "authenticated login",
        url: `${baseUrl}/api/auth/login`,
        expected: "Preview must use a dedicated test DB.",
        status: null,
        location: null,
        result: "SKIPPED" as const,
        notes: "Set PREVIEW_SMOKE_DB_KIND=dedicated-test only after confirming the Preview DATABASE_URL is not production.",
      },
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        ...headers(),
        "content-type": "application/json",
      },
      redirect: "manual",
      body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
    });
    const location = response.headers.get("location");
    const cookie = setCookieHeader(response);
    const blockedBySso = isVercelSso(location);
    const ok = response.status === 200 && Boolean(cookie) && !blockedBySso;
    return {
      cookie,
      result: {
        name: "authenticated login",
        url: `${baseUrl}/api/auth/login`,
        expected: "200 with app session cookie from dedicated test DB user.",
        status: response.status,
        location,
        result: ok ? "PASS" as const : "FAIL" as const,
        notes: ok
          ? "Authenticated against Preview dedicated test DB user."
          : blockedBySso
            ? "Reached Vercel Deployment Protection SSO instead of the app."
            : "Login failed or no app session cookie was returned.",
      },
    };
  } catch (error) {
    return {
      cookie: "",
      result: {
        name: "authenticated login",
        url: `${baseUrl}/api/auth/login`,
        expected: "200 with app session cookie from dedicated test DB user.",
        status: null,
        location: null,
        result: "FAIL" as const,
        notes: error instanceof Error ? error.message : "Unknown login error.",
      },
    };
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(previewUrl);
  if (!baseUrl) {
    console.error("Set VERCEL_PREVIEW_URL or PREVIEW_URL before running preview smoke.");
    process.exit(1);
  }

  const results: SmokeResult[] = [];
  const unauthenticated = [
    { name: "unauth /login", path: "/login", expected: "200 app login page", acceptableStatuses: [200] },
    { name: "unauth /dashboard", path: "/dashboard", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /companies", path: "/companies", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /deals", path: "/deals", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /deals/board", path: "/deals/board", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /appointments/new", path: "/appointments/new", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /daily-metrics", path: "/daily-metrics", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /reports", path: "/reports", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /delivery-projects", path: "/delivery-projects", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /tasks", path: "/tasks", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /notifications", path: "/notifications", expected: "app-owned auth redirect or page", acceptableStatuses: [200, 302, 303, 307, 308] },
    { name: "unauth /api/auth/me", path: "/api/auth/me", expected: "app API auth boundary", acceptableStatuses: [200, 401, 403, 404] },
    { name: "unauth /api/companies", path: "/api/companies", expected: "app API auth boundary", acceptableStatuses: [200, 401, 403] },
    { name: "unauth /api/deals", path: "/api/deals", expected: "app API auth boundary", acceptableStatuses: [200, 401, 403] },
    { name: "unauth /api/tasks", path: "/api/tasks", expected: "app API auth boundary", acceptableStatuses: [200, 401, 403] },
    { name: "unauth /api/reports/sales-progress", path: "/api/reports/sales-progress", expected: "app API auth boundary", acceptableStatuses: [200, 400, 401, 403] },
  ];

  for (const step of unauthenticated) {
    results.push(await requestStep({ baseUrl, ...step }));
  }

  const auth = await login(baseUrl);
  results.push(auth.result);

  if (auth.cookie) {
    const authenticated = [
      { name: "auth /dashboard", path: "/dashboard", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /companies", path: "/companies", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /deals", path: "/deals", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /deals/board", path: "/deals/board", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /appointments/new", path: "/appointments/new", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /daily-metrics", path: "/daily-metrics", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /reports", path: "/reports", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /delivery-projects", path: "/delivery-projects", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /tasks", path: "/tasks", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /notifications", path: "/notifications", expected: "200 app page", acceptableStatuses: [200] },
      { name: "auth /api/companies", path: "/api/companies", expected: "200 app API", acceptableStatuses: [200] },
      { name: "auth /api/deals", path: "/api/deals", expected: "200 app API", acceptableStatuses: [200] },
      { name: "auth /api/tasks", path: "/api/tasks", expected: "200 app API", acceptableStatuses: [200] },
      { name: "auth /api/reports/sales-progress", path: "/api/reports/sales-progress", expected: "200 app API or validation response", acceptableStatuses: [200, 400] },
    ];
    for (const step of authenticated) {
      results.push(await requestStep({ baseUrl, cookie: auth.cookie, ...step }));
    }
  }

  const summary = {
    previewUrl: baseUrl,
    bypassHeaderConfigured: Boolean(bypassSecret),
    authenticatedSmokeRequested: allowAuth,
    previewDbKind: dbKind || null,
    results,
    passed: results.filter((result) => result.result === "PASS").length,
    failed: results.filter((result) => result.result === "FAIL").length,
    skipped: results.filter((result) => result.result === "SKIPPED").length,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exit(1);
}

main();

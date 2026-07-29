import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { e2eCredentials, seedE2eData } from "../../scripts/e2e-seed";

const prisma = new PrismaClient();

let fixture: Awaited<ReturnType<typeof seedE2eData>>;

test.describe.serial("pre-production critical CRM flows", () => {
  test.beforeAll(async () => {
    fixture = await seedE2eData();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("login, create company/deal, change stage, verify rollback and org isolation", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(e2eCredentials.adminEmail);
    await page.getByLabel("パスワード").fill(e2eCredentials.adminPassword);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("ダッシュボード")).toBeVisible();

    const unique = Date.now();
    const companyName = `E2E UI Company ${unique}`;
    await page.goto("/companies/new");
    await page.getByLabel("会社名").fill(companyName);
    await page.getByLabel("ドメイン").fill(`e2e-ui-${unique}.example.test`);
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

    const dealName = `E2E UI Deal ${unique}`;
    await page.goto("/deals/new");
    await page.getByLabel("商談名").fill(dealName);
    await page.getByLabel("金額").fill("123000");
    await page.getByLabel("パイプライン").selectOption({
      label: "E2E営業パイプライン",
    });
    await page.getByLabel("ステージ").selectOption({ label: "新規リード" });
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: dealName })).toBeVisible();

    const dealId = page.url().split("/").pop();
    expect(dealId).toBeTruthy();
    const appointmentStage = fixture.orgA.stages.find(
      (stage) => stage.name === "アポ獲得",
    );
    const meetingStage = fixture.orgA.stages.find(
      (stage) => stage.name === "商談予定",
    );
    expect(appointmentStage).toBeTruthy();
    expect(meetingStage).toBeTruthy();

    const appointmentResponse = await page.request.patch(`/api/deals/${dealId}/stage`, {
      data: {
        pipelineId: fixture.orgA.pipeline.id,
        stageId: appointmentStage!.id,
        propertyValues: {
          "customFields.appointmentAcquiredDate": "2026-06-24",
          nextAction: "E2E follow-up",
          nextActionDate: "2026-06-24",
        },
      },
    });
    expect(appointmentResponse.status()).toBe(200);
    await expect
      .poll(async () => {
        const item = await prisma.deal.findUnique({ where: { id: dealId! } });
        return item?.stageId;
      })
      .toBe(appointmentStage!.id);

    await page.goto(`/deals/${dealId}`);
    await expect(
      page.getByText("E2E営業パイプライン ・ アポ獲得", { exact: true }),
    ).toBeVisible();
    const beforeFailedChange = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId! },
    });
    const failedStageResponse = await page.request.patch(`/api/deals/${dealId}/stage`, {
      data: {
        pipelineId: fixture.orgA.pipeline.id,
        stageId: meetingStage!.id,
        propertyValues: {
          "customFields.meetingDate": "2026-06-25",
          forecastCategoryId: fixture.orgA.forecastCategory.id,
        },
      },
    });
    expect(failedStageResponse.status()).toBe(400);
    await expect(failedStageResponse.json()).resolves.toMatchObject({
      missingRequirementKeys: ["line_items"],
    });

    await expect
      .poll(async () => {
        const item = await prisma.deal.findUniqueOrThrow({ where: { id: dealId! } });
        return {
          stageId: item.stageId,
          forecastCategoryId: item.forecastCategoryId,
          customFields: item.customFields,
        };
      })
      .toEqual({
        stageId: beforeFailedChange.stageId,
        forecastCategoryId: beforeFailedChange.forecastCategoryId,
        customFields: beforeFailedChange.customFields,
      });

    await page.reload();
    await expect(
      page.getByText("E2E営業パイプライン ・ アポ獲得", { exact: true }),
    ).toBeVisible();

    const hiddenCompanyResponse = await page.request.get(
      `/api/companies?q=${encodeURIComponent(fixture.orgB.company.name)}`,
    );
    expect(hiddenCompanyResponse.status()).toBe(200);
    const hiddenCompanyJson = await hiddenCompanyResponse.json();
    expect(
      hiddenCompanyJson.items.some(
        (item: { id: string }) => item.id === fixture.orgB.company.id,
      ),
    ).toBe(false);

    const tamperedDealResponse = await page.request.patch(
      `/api/deals/${fixture.orgB.deal.id}/stage`,
      {
        data: {
          pipelineId: fixture.orgB.pipeline.id,
          stageId: fixture.orgB.stages[1].id,
        },
      },
    );
    expect(tamperedDealResponse.status()).toBe(404);
  });
});

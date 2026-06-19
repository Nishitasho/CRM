import {
  CustomFieldType,
  CustomPropertyObjectType,
  OrganizationRole,
  PrismaClient,
  StageType,
} from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const stages = [
  { name: "新規リード", probability: 10, stageType: StageType.OPEN },
  { name: "アポ獲得", probability: 20, stageType: StageType.OPEN },
  { name: "商談予定", probability: 35, stageType: StageType.OPEN },
  { name: "提案中", probability: 55, stageType: StageType.OPEN },
  { name: "契約確認中", probability: 80, stageType: StageType.OPEN },
  { name: "受注", probability: 100, stageType: StageType.WON },
  { name: "失注", probability: 0, stageType: StageType.LOST },
];

async function main() {
  const passwordHash = await hash("Sample123!", 12);
  const organization = await prisma.organization.upsert({
    where: { slug: "sample" },
    update: { name: "株式会社サンプル" },
    create: { name: "株式会社サンプル", slug: "sample" },
  });
  const firstBusinessUnit = await prisma.businessUnit.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "first",
      },
    },
    update: {
      name: "第1事業部",
      description: "IS / FSで営業活動を管理する初期事業部",
      status: "ACTIVE",
      displayOrder: 1,
    },
    create: {
      organizationId: organization.id,
      name: "第1事業部",
      slug: "first",
      description: "IS / FSで営業活動を管理する初期事業部",
      displayOrder: 1,
    },
  });
  const hdBusinessUnit = await prisma.businessUnit.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "hd",
      },
    },
    update: {
      name: "HD事業部",
      description: "IS / FS / CSで営業から制作進行まで管理する初期事業部",
      status: "ACTIVE",
      displayOrder: 2,
    },
    create: {
      organizationId: organization.id,
      name: "HD事業部",
      slug: "hd",
      description: "IS / FS / CSで営業から制作進行まで管理する初期事業部",
      displayOrder: 2,
    },
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { name: "管理者", passwordHash, emailVerifiedAt: new Date() },
    create: {
      email: "admin@example.com",
      name: "管理者",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.user.upsert({
    where: { email: "sales@example.com" },
    update: { name: "営業担当", passwordHash, emailVerifiedAt: new Date() },
    create: {
      email: "sales@example.com",
      name: "営業担当",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const salesTeam = await prisma.team.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "営業チーム",
      },
    },
    update: {},
    create: { organizationId: organization.id, name: "営業チーム" },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: superAdmin.id,
      },
    },
    update: {
      role: OrganizationRole.SUPER_ADMIN,
      teamId: salesTeam.id,
      selectedBusinessUnitId: null,
    },
    create: {
      organizationId: organization.id,
      userId: superAdmin.id,
      role: OrganizationRole.SUPER_ADMIN,
      teamId: salesTeam.id,
    },
  });

  const customProperties = [
    {
      objectType: CustomPropertyObjectType.CONTACT,
      name: "customer_rank",
      label: "顧客ランク",
      fieldType: CustomFieldType.SELECT,
      options: ["A", "B", "C"],
      sortOrder: 1,
    },
    {
      objectType: CustomPropertyObjectType.COMPANY,
      name: "company_size",
      label: "従業員帯",
      fieldType: CustomFieldType.SELECT,
      options: ["1〜49名", "50〜299名", "300名以上"],
      sortOrder: 1,
    },
    {
      objectType: CustomPropertyObjectType.DEAL,
      name: "contract_type",
      label: "契約種別",
      fieldType: CustomFieldType.SELECT,
      options: ["スポット", "月額", "年間"],
      sortOrder: 1,
    },
  ];
  for (const property of customProperties) {
    await prisma.customProperty.upsert({
      where: {
        organizationId_objectType_name: {
          organizationId: organization.id,
          objectType: property.objectType,
          name: property.name,
        },
      },
      update: property,
      create: { organizationId: organization.id, ...property },
    });
  }

  await prisma.savedView.upsert({
    where: {
      organizationId_userId_objectType_name: {
        organizationId: organization.id,
        userId: superAdmin.id,
        objectType: CustomPropertyObjectType.CONTACT,
        name: "対応中リード",
      },
    },
    update: { filters: { q: "対応中" } },
    create: {
      organizationId: organization.id,
      userId: superAdmin.id,
      objectType: CustomPropertyObjectType.CONTACT,
      name: "対応中リード",
      filters: { q: "対応中" },
      columns: [],
      sort: { updatedAt: "desc" },
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: member.id,
      },
    },
    update: {
      role: OrganizationRole.USER,
      teamId: salesTeam.id,
      selectedBusinessUnitId: firstBusinessUnit.id,
    },
    create: {
      organizationId: organization.id,
      userId: member.id,
      role: OrganizationRole.USER,
      teamId: salesTeam.id,
      selectedBusinessUnitId: firstBusinessUnit.id,
    },
  });

  for (const item of [
    {
      userId: superAdmin.id,
      businessUnitId: firstBusinessUnit.id,
      workFunction: "IS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: firstBusinessUnit.id,
      workFunction: "FS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "IS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "FS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "CS",
    },
    {
      userId: member.id,
      businessUnitId: firstBusinessUnit.id,
      workFunction: "IS",
    },
    {
      userId: member.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "FS",
    },
  ] as const) {
    await prisma.businessUnitMembership.upsert({
      where: {
        businessUnitId_userId_workFunction: {
          businessUnitId: item.businessUnitId,
          userId: item.userId,
          workFunction: item.workFunction,
        },
      },
      update: { organizationId: organization.id, status: "ACTIVE" },
      create: {
        organizationId: organization.id,
        userId: item.userId,
        businessUnitId: item.businessUnitId,
        workFunction: item.workFunction,
        isManager: item.userId === superAdmin.id,
      },
    });
  }

  const pipeline = await prisma.pipeline.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "標準営業パイプライン",
      },
    },
    update: { businessUnitId: firstBusinessUnit.id, isDefault: true },
    create: {
      organizationId: organization.id,
      businessUnitId: firstBusinessUnit.id,
      name: "標準営業パイプライン",
      isDefault: true,
    },
  });
  const hdPipeline = await prisma.pipeline.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "HD営業パイプライン",
      },
    },
    update: { businessUnitId: hdBusinessUnit.id, isDefault: true },
    create: {
      organizationId: organization.id,
      businessUnitId: hdBusinessUnit.id,
      name: "HD営業パイプライン",
      isDefault: true,
    },
  });

  for (const [index, stage] of stages.entries()) {
    await prisma.pipelineStage.upsert({
      where: {
        pipelineId_sortOrder: { pipelineId: pipeline.id, sortOrder: index + 1 },
      },
      update: stage,
      create: {
        organizationId: organization.id,
        pipelineId: pipeline.id,
        sortOrder: index + 1,
        ...stage,
      },
    });
    await prisma.pipelineStage.upsert({
      where: {
        pipelineId_sortOrder: {
          pipelineId: hdPipeline.id,
          sortOrder: index + 1,
        },
      },
      update: stage,
      create: {
        organizationId: organization.id,
        pipelineId: hdPipeline.id,
        sortOrder: index + 1,
        ...stage,
      },
    });
  }

  await prisma.objectAssociation.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.activity.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.task.deleteMany({ where: { organizationId: organization.id } });
  await prisma.meetingBooking.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.formSubmission.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.conversation.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deal.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contact.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.company.deleteMany({
    where: { organizationId: organization.id },
  });

  await prisma.company.createMany({
    data: [
      [
        "株式会社アークデザイン",
        "arc-design.jp",
        "Web制作",
        "東京都",
        "渋谷区",
      ],
      ["ネクスト広告株式会社", "next-ads.jp", "広告代理店", "東京都", "港区"],
      [
        "株式会社みらいソリューション",
        "mirai-solution.jp",
        "ITサービス",
        "大阪府",
        "大阪市",
      ],
      [
        "北斗コンサルティング株式会社",
        "hokuto-consulting.jp",
        "コンサルティング",
        "北海道",
        "札幌市",
      ],
      [
        "サクラリテール株式会社",
        "sakura-retail.jp",
        "小売",
        "福岡県",
        "福岡市",
      ],
    ].map(([name, domain, industry, prefecture, city]) => ({
      organizationId: organization.id,
      ownerUserId: superAdmin.id,
      name,
      domain,
      industry,
      prefecture,
      city,
      phone: "03-1234-5678",
      websiteUrl: `https://${domain}`,
      customFields: {
        company_size: name.includes("みらい") ? "300名以上" : "50〜299名",
      },
    })),
  });

  const lastNames = [
    "佐藤",
    "鈴木",
    "高橋",
    "田中",
    "伊藤",
    "渡辺",
    "山本",
    "中村",
    "小林",
    "加藤",
  ];
  const firstNames = [
    "健太",
    "美咲",
    "翔太",
    "陽子",
    "直樹",
    "恵",
    "大輔",
    "彩",
    "隆",
    "由美",
  ];
  await prisma.contact.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      organizationId: organization.id,
      ownerUserId: index % 3 === 0 ? member.id : superAdmin.id,
      lastName: lastNames[index % lastNames.length],
      firstName: firstNames[(index * 3) % firstNames.length],
      email: `contact${index + 1}@example.com`,
      phone: `03-5000-${String(1000 + index).slice(-4)}`,
      jobTitle:
        index % 4 === 0
          ? "代表取締役"
          : index % 3 === 0
            ? "営業部長"
            : "営業担当",
      lifecycleStage: index % 2 === 0 ? "商談化" : "リード",
      leadStatus: index % 3 === 0 ? "対応中" : "未対応",
      source: index % 2 === 0 ? "Webフォーム" : "紹介",
      customFields: {
        customer_rank: index % 3 === 0 ? "A" : index % 3 === 1 ? "B" : "C",
      },
    })),
  });

  const [companies, contacts, pipelineStages] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId: organization.id },
      orderBy: { name: "asc" },
    }),
    prisma.contact.findMany({
      where: { organizationId: organization.id },
      orderBy: { email: "asc" },
    }),
    prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const publicForm = await prisma.form.upsert({
    where: { slug: "sample-contact" },
    update: {
      organizationId: organization.id,
      businessUnitId: firstBusinessUnit.id,
      name: "無料相談フォーム",
      fields: [
        { name: "lastName", label: "姓", type: "text", required: true },
        { name: "firstName", label: "名", type: "text", required: true },
        {
          name: "email",
          label: "メールアドレス",
          type: "email",
          required: true,
        },
        { name: "phone", label: "電話番号", type: "tel", required: false },
        {
          name: "message",
          label: "ご相談内容",
          type: "textarea",
          required: true,
        },
      ],
      submitButtonText: "無料相談を申し込む",
    },
    create: {
      organizationId: organization.id,
      businessUnitId: firstBusinessUnit.id,
      name: "無料相談フォーム",
      slug: "sample-contact",
      fields: [
        { name: "lastName", label: "姓", type: "text", required: true },
        { name: "firstName", label: "名", type: "text", required: true },
        {
          name: "email",
          label: "メールアドレス",
          type: "email",
          required: true,
        },
        { name: "phone", label: "電話番号", type: "tel", required: false },
        {
          name: "message",
          label: "ご相談内容",
          type: "textarea",
          required: true,
        },
      ],
      submitButtonText: "無料相談を申し込む",
    },
  });

  for (const weekday of [1, 2, 3, 4, 5]) {
    await prisma.availabilityRule.upsert({
      where: {
        organizationId_userId_weekday: {
          organizationId: organization.id,
          userId: superAdmin.id,
          weekday,
        },
      },
      update: { startMinutes: 600, endMinutes: 1020 },
      create: {
        organizationId: organization.id,
        userId: superAdmin.id,
        weekday,
        startMinutes: 600,
        endMinutes: 1020,
      },
    });
  }

  const meetingLink = await prisma.meetingLink.upsert({
    where: { slug: "sample-consultation" },
    update: {
      organizationId: organization.id,
      userId: superAdmin.id,
      name: "30分オンライン相談",
      durationMinutes: 30,
      isActive: true,
    },
    create: {
      organizationId: organization.id,
      userId: superAdmin.id,
      name: "30分オンライン相談",
      slug: "sample-consultation",
      durationMinutes: 30,
    },
  });

  for (const template of [
    {
      name: "初回お礼",
      subject: "お問い合わせありがとうございます",
      body: "お問い合わせいただきありがとうございます。\n内容を確認し、改めてご連絡いたします。",
    },
    {
      name: "商談後フォロー",
      subject: "本日のお打ち合わせのお礼",
      body: "本日はお時間をいただき、ありがとうございました。\nご案内した内容について、ご不明点があればお気軽にご連絡ください。",
    },
  ]) {
    await prisma.emailTemplate.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: template.name,
        },
      },
      update: template,
      create: {
        organizationId: organization.id,
        createdByUserId: superAdmin.id,
        ...template,
      },
    });
  }

  await prisma.formSubmission.create({
    data: {
      organizationId: organization.id,
      formId: publicForm.id,
      contactId: contacts[0].id,
      rawPayload: {
        lastName: contacts[0].lastName,
        firstName: contacts[0].firstName,
        email: contacts[0].email,
        message: "Webサイト制作について相談したいです。",
      },
    },
  });
  await prisma.conversation.create({
    data: {
      organizationId: organization.id,
      contactId: contacts[1].id,
      visitorName:
        `${contacts[1].lastName ?? ""} ${contacts[1].firstName ?? ""}`.trim(),
      visitorEmail: contacts[1].email,
      message: "広告運用の支援内容と料金について教えてください。",
      metadata: { channel: "web_widget" },
    },
  });
  const sampleStart = new Date(Date.now() + 7 * 86400000);
  sampleStart.setUTCHours(2, 0, 0, 0);
  await prisma.meetingBooking.create({
    data: {
      organizationId: organization.id,
      meetingLinkId: meetingLink.id,
      contactId: contacts[2].id,
      guestName:
        `${contacts[2].lastName ?? ""} ${contacts[2].firstName ?? ""}`.trim(),
      guestEmail: contacts[2].email!,
      startsAt: sampleStart,
      endsAt: new Date(sampleStart.getTime() + 30 * 60000),
    },
  });

  await prisma.deal.createMany({
    data: Array.from({ length: 15 }, (_, index) => {
      const stage = pipelineStages[index % pipelineStages.length];
      return {
        organizationId: organization.id,
        businessUnitId: firstBusinessUnit.id,
        ownerUserId: index % 3 === 0 ? member.id : superAdmin.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        name: `${companies[index % companies.length].name} ${index % 2 === 0 ? "サイト刷新" : "営業支援"}案件`,
        amount: 500000 + index * 150000,
        expectedCloseDate: new Date(2026, 5 + (index % 3), 15 + (index % 10)),
        probability: stage.probability,
        status: stage.stageType,
        closeDate: stage.stageType === "WON" ? new Date() : null,
        lostReason: stage.stageType === "LOST" ? "予算見送り" : null,
        source: index % 2 === 0 ? "問い合わせ" : "既存顧客紹介",
        customFields: {
          contract_type:
            index % 3 === 0 ? "年間" : index % 3 === 1 ? "月額" : "スポット",
        },
      };
    }),
  });

  const deals = await prisma.deal.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  for (const [index, contact] of contacts.entries()) {
    const company = companies[index % companies.length];
    await prisma.objectAssociation.create({
      data: {
        organizationId: organization.id,
        sourceObjectType: "CONTACT",
        sourceObjectId: contact.id,
        targetObjectType: "COMPANY",
        targetObjectId: company.id,
        label: "所属企業",
        isPrimary: true,
      },
    });
  }
  for (const [index, deal] of deals.entries()) {
    const company = companies[index % companies.length];
    const contact = contacts[index % contacts.length];
    await prisma.objectAssociation.createMany({
      data: [
        {
          organizationId: organization.id,
          sourceObjectType: "DEAL",
          sourceObjectId: deal.id,
          targetObjectType: "COMPANY",
          targetObjectId: company.id,
          label: "取引先",
          isPrimary: true,
        },
        {
          organizationId: organization.id,
          sourceObjectType: "DEAL",
          sourceObjectId: deal.id,
          targetObjectType: "CONTACT",
          targetObjectId: contact.id,
          label: index % 3 === 0 ? "決裁者" : "担当者",
          isPrimary: true,
        },
      ],
    });
  }

  for (let index = 0; index < 30; index += 1) {
    const contact = contacts[index % contacts.length];
    const activity = await prisma.activity.create({
      data: {
        organizationId: organization.id,
        actorUserId: index % 4 === 0 ? member.id : superAdmin.id,
        type:
          index % 4 === 0
            ? "CALL"
            : index % 4 === 1
              ? "EMAIL"
              : index % 4 === 2
                ? "NOTE"
                : "MEETING",
        title:
          index % 4 === 0
            ? "初回ヒアリングを実施"
            : index % 4 === 1
              ? "提案資料を送付"
              : index % 4 === 2
                ? "顧客メモを追加"
                : "オンライン商談を実施",
        body: "サンプル活動履歴です。次回アクションと顧客の検討状況を記録しています。",
        occurredAt: new Date(Date.now() - index * 86400000),
      },
    });
    await prisma.objectAssociation.create({
      data: {
        organizationId: organization.id,
        sourceObjectType: "ACTIVITY",
        sourceObjectId: activity.id,
        targetObjectType: "CONTACT",
        targetObjectId: contact.id,
      },
    });
  }

  for (let index = 0; index < 10; index += 1) {
    const task = await prisma.task.create({
      data: {
        organizationId: organization.id,
        ownerUserId: index % 3 === 0 ? member.id : superAdmin.id,
        createdByUserId: superAdmin.id,
        title:
          index % 2 === 0
            ? `提案後フォロー ${index + 1}`
            : `ヒアリング日程調整 ${index + 1}`,
        description: "顧客へ連絡し、次回アクションを確定する。",
        dueDate: new Date(Date.now() + (index - 3) * 86400000),
        status:
          index === 0 ? "COMPLETED" : index % 4 === 0 ? "IN_PROGRESS" : "TODO",
        priority: index % 3 === 0 ? "HIGH" : index % 3 === 1 ? "MEDIUM" : "LOW",
        taskType: index % 2 === 0 ? "FOLLOW_UP" : "CALL",
        completedAt: index === 0 ? new Date() : null,
      },
    });
    const deal = deals[index % deals.length];
    await prisma.objectAssociation.create({
      data: {
        organizationId: organization.id,
        sourceObjectType: "TASK",
        sourceObjectId: task.id,
        targetObjectType: "DEAL",
        targetObjectId: deal.id,
      },
    });
  }

  console.info("Seed completed: admin@example.com / Sample123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

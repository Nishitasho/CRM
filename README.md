# SalesNest CRM

営業代行会社・Web制作会社・広告代理店向けの営業CRMです。HubSpotのCRM思想を参考にしつつ、UI・名称・文言は独自に設計しています。

現在は既存CRM機能に加えて、営業オペレーション管理CRMへ拡張するための **事業部基盤 Phase 1** まで実装済みです。認証・CRMコア、インポート、公開フォーム、日程調整、メールログ、Web問い合わせ受付、事業部切り替えを利用できます。

## 技術構成

- Next.js 15 / React 19 / TypeScript
- PostgreSQL 16
- Prisma ORM
- Zod
- Tailwind CSS
- bcryptjs
- Vitest / ESLint / Prettier

## セットアップ

### 1. 依存関係

```bash
npm install
```

### 2. 環境変数

```bash
cp .env.example .env
```

| 変数                  | 用途                     |
| --------------------- | ------------------------ |
| `DATABASE_URL`        | PostgreSQL接続URL        |
| `SESSION_COOKIE_NAME` | 認証Cookie名             |
| `SESSION_TTL_DAYS`    | セッション有効日数       |
| `APP_URL`             | 招待URL生成に使う公開URL |

### 3. PostgreSQL

この作業フォルダに用意済みのローカルPostgreSQLを利用する場合:

```bash
npm run db:local:start
```

停止する場合:

```bash
npm run db:local:stop
```

Dockerを利用する場合は、代わりに次を実行します。

```bash
docker compose up -d postgres
```

### 4. マイグレーションとseed

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

seed後の確認アカウント:

- 最高管理者: `admin@example.com` / `Sample123!`
- 一般ユーザー: `sales@example.com` / `Sample123!`

### 5. 開発サーバー

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開きます。

次回以降は、通常次の2コマンドだけで再開できます。

```bash
npm run db:local:start
npm run dev
```

## 検証コマンド

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Phase 1の実装範囲

### 認証

- メールアドレス（グローバル一意）とパスワードによる登録・ログイン
- bcrypt（cost 12）によるパスワードハッシュ
- ランダムなセッショントークンをHttpOnly / SameSite=Lax Cookieに保存
- DBにはセッショントークンのSHA-256ハッシュのみ保存
- ログアウト時のセッション失効
- `email_verified_at` を保持（メール配送・検証フローは後続）

### 組織とテナント分離

- 1ユーザーが複数組織へ所属可能
- 現在の組織をセッションに保持し、切り替え時に所属を検証
- 認証コンテキスト取得時に、有効な所属をDBで毎回再確認
- CRM系全テーブルに `organization_id` と複合インデックスを設定
- APIはクライアントから渡された組織IDではなく、認証済み組織IDを使用

### 招待と権限

- 招待トークンはランダム生成し、DBにはSHA-256ハッシュのみ保存
- 招待URLの有効期限は7日
- 既存アカウント、新規アカウントの両方で招待承認可能
- `super_admin` / `admin` / `manager` / `user` / `read_only` の権限表を実装
- 最後の有効な最高管理者は降格・停止できない
- 管理者は最高管理者の付与・変更ができない
- 組織作成、招待、招待承認、権限変更を監査ログへ記録

### UI

- ログイン、アカウント登録、招待承認
- ダッシュボード
- 組織追加、組織切り替え
- メンバー招待、メンバー一覧、ロール変更
- PC優先かつモバイル対応のサイドバー/ボトムナビ
- CRM各機能へつながる実画面

## Phase 2の実装範囲

- コンタクト・会社・商談の一覧、検索、ページネーション
- 新規作成、編集、論理削除
- メールアドレスとドメインによる組織内重複チェック
- 商談のパイプライン・ステージ必須化
- ステージに連動した確度・受注日・失注理由の処理
- コンタクト・会社・商談の汎用関連付けと主要レコード指定
- メモ、メール、通話、ミーティングの手動活動ログ
- 作成、プロパティ更新、ステージ変更の自動活動ログ
- 左: 基本情報、中央: タイムライン、右: 関連データの詳細画面
- `user` は自分の所有データ、`manager` は同一チームの所有データを中心に表示

## Phase 3の実装範囲

- dnd-kitによる商談パイプライン
- ドロップ時のステージ変更、受注日の自動入力、失注理由の入力
- 複数パイプライン切り替え
- ステージ名、順番、確度、受注/失注区分の管理
- タスク作成、今日・期限切れ・自分のタスク絞り込み
- タスクの担当者、期限、優先度、種別、関連レコード
- タスク完了時の活動履歴自動作成
- 今月の商談金額、受注金額、新規コンタクト、期限切れタスク
- ステージ別商談件数・金額、今日のタスク、最近の活動

## Phase 4の実装範囲

- UTF-8 / UTF-8 BOM / Shift_JIS対応のCSVプレビュー
- Google Sheets / ExcelからダウンロードしたXLSX、TSV、表データ貼り付けのプレビュー
- スプレッドシート列と標準・カスタム項目のマッピング
- コンタクトメール、会社ドメイン、商談外部IDによる重複判定
- コンタクトと会社、商談と会社/コンタクトの自動関連付け
- 新規作成のみ / 更新を含むインポートモードと行単位エラー結果
- コンタクト・会社・商談のUTF-8 BOM付きCSVエクスポート
- 現在の検索条件を個人ビューとして保存・呼び出し・削除
- コンタクト・会社・商談のカスタム項目定義、入力、詳細表示、CSV入出力
- 管理者向けカスタム項目管理権限

## 事業部基盤 Phase 1の実装範囲

- `BusinessUnit` / `BusinessUnitMembership`
- 第1事業部、HD事業部の初期seed
- IS / FS / CSを権限ロールとは別の職種として管理
- ヘッダーの事業部セレクター
- 商談、パイプライン、フォームへの `businessUnitId`
- ダッシュボード、商談、パイプライン、フォーム、パイプライン設定の事業部絞り込み
- 設定画面での事業部管理
- メンバー設定での事業部・職種所属管理
- 詳細な設計メモ: `docs/business-units-phase1.md`

## Phase 5の実装範囲

- 項目を選択して作成できる公開フォームとiframe埋め込みコード
- フォーム送信時のコンタクト作成・更新、送信履歴、活動タイムライン記録
- ユーザーごとの曜日・時間設定と公開会議URL
- 予約枠生成、予約確定時の再検証、ダブルブッキング防止
- 予約者のコンタクト作成・更新とミーティング活動記録
- 組織共有のメールテンプレートとmailtoリンク
- 宛先・件名・本文・送信日時を保持する手動メールログ
- 組織slugごとの公開問い合わせページとiframe埋め込みコード
- 問い合わせの会話一覧、コンタクト作成・更新、チャット活動記録

## Prismaスキーマ

主要なモデルは以下です。

- `User`
- `Organization`
- `OrganizationMember`
- `Team`
- `Invitation`
- `AuthSession`
- `AuditLog`
- `Pipeline` / `PipelineStage`（組織作成時に標準7ステージを生成）

後続フェーズのマイグレーション互換性を保つため、以下も先行してスキーマ定義しています。

- `Contact` / `Company` / `Deal`
- `ObjectAssociation` / `Activity` / `Task`
- `CustomProperty` / `ImportJob` / `SavedView`
- `EmailTemplate`
- `AvailabilityRule` / `MeetingLink` / `MeetingBooking`
- `Form` / `FormSubmission` / `Conversation`
- `BusinessUnit` / `BusinessUnitMembership`

初期SQLは `prisma/migrations/20260612000000_init/migration.sql`、Phase 4追加分は `prisma/migrations/20260613000000_phase4/migration.sql`、事業部基盤は `prisma/migrations/20260619043656_business_units/migration.sql` にあります。

## API

| Method         | Path                                   | 説明                     |
| -------------- | -------------------------------------- | ------------------------ |
| `POST`         | `/api/auth/register`                   | ユーザー・初期組織を作成 |
| `POST`         | `/api/auth/login`                      | ログイン                 |
| `POST`         | `/api/auth/logout`                     | ログアウト               |
| `GET` / `POST` | `/api/organizations`                   | 所属組織一覧 / 組織作成  |
| `POST`         | `/api/organizations/switch`            | 利用中の組織を切り替え   |
| `GET` / `POST` | `/api/business-units`                  | 事業部一覧 / 事業部作成  |
| `PATCH`        | `/api/business-units/:id`              | 事業部更新               |
| `POST`         | `/api/business-units/select`           | 表示中の事業部を保存     |
| `POST`         | `/api/business-unit-memberships`       | 事業部・職種所属を更新   |
| `POST`         | `/api/organizations/invitations`       | 招待URLを発行            |
| `GET` / `POST` | `/api/invitations/:token`              | 招待確認 / 承認          |
| `PATCH`        | `/api/organizations/members/:memberId` | ロール・状態変更         |
| `POST`         | `/api/imports/preview`                 | CSV/XLSX/貼り付け解析    |
| `POST`         | `/api/imports/execute`                 | データインポート実行     |
| `GET`          | `/api/exports/:objectType`             | CSVエクスポート          |
| `GET` / `POST` | `/api/saved-views`                     | 保存ビュー一覧 / 作成    |
| `GET` / `POST` | `/api/custom-properties`               | カスタム項目一覧 / 作成  |
| `GET` / `POST` | `/api/forms`                           | フォーム一覧 / 作成      |
| `POST`         | `/api/public/forms/:slug`              | 公開フォーム送信         |
| `POST`         | `/api/availability`                    | 予約可能時間を保存       |
| `POST`         | `/api/meeting-links`                   | 会議URLを作成            |
| `POST`         | `/api/public/meetings/:slug`           | 公開予約を確定           |
| `GET` / `POST` | `/api/email-templates`                 | メールテンプレート管理   |
| `POST`         | `/api/email-logs`                      | 手動メールログを作成     |
| `POST`         | `/api/public/chat/:organizationSlug`   | Web問い合わせを送信      |

すべての書き込み入力はZodで検証します。

## 残タスク

- PostgreSQLを使ったAPI統合テストとPlaywright E2E

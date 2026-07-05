-- CreateTable: single-row global settings, editable from the admin UI
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "telegram_bot_token" TEXT,
    "telegram_chat_id" TEXT,
    "notify_webhook_url" TEXT,
    "notify_min_severity" TEXT,
    "base_currency" TEXT,
    "fx_rates" TEXT,
    "report_timezone" TEXT,
    "fraud_velocity_window_seconds" INTEGER,
    "fraud_velocity_max_clicks" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- Per-step funnel analytics.
--
-- Conversions are unique per (click_id, event_type), so a multi-step LP (quiz,
-- multi-stage form) recorded only the FIRST click_button per visit: every later
-- step came back as a duplicate and was dropped, making the drop-off between
-- steps invisible. Splitting these out also keeps them from firing postbacks —
-- a 5-step quiz would otherwise send 5 CAPI events per visitor.

CREATE TABLE "funnel_step_events" (
    "id" TEXT NOT NULL,
    "click_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_label" TEXT,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_step_events_pkey" PRIMARY KEY ("id")
);

-- A visitor re-answering a step must not be counted twice: the table answers
-- "how many visits reached this step".
CREATE UNIQUE INDEX "funnel_step_events_click_id_step_key_key"
    ON "funnel_step_events"("click_id", "step_key");

CREATE INDEX "funnel_step_events_campaign_id_created_at_idx"
    ON "funnel_step_events"("campaign_id", "created_at");

CREATE INDEX "funnel_step_events_campaign_id_step_index_idx"
    ON "funnel_step_events"("campaign_id", "step_index");

ALTER TABLE "funnel_step_events"
    ADD CONSTRAINT "funnel_step_events_click_id_fkey"
    FOREIGN KEY ("click_id") REFERENCES "clicks"("click_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funnel_step_events"
    ADD CONSTRAINT "funnel_step_events_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

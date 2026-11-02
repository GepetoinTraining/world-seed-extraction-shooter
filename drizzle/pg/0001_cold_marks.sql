CREATE TABLE "cold_changes" (
	"tbl" text NOT NULL,
	"id" text NOT NULL,
	"seq" bigint NOT NULL,
	CONSTRAINT "cold_changes_tbl_id_pk" PRIMARY KEY("tbl","id")
);
--> statement-breakpoint
CREATE TABLE "cold_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cold_changes_seq_idx" ON "cold_changes" USING btree ("seq");
--> statement-breakpoint
CREATE SEQUENCE "cold_change_seq";
--> statement-breakpoint
CREATE FUNCTION "mark_for_the_record"() RETURNS trigger AS $$
BEGIN
  -- A load from the record is what the record already holds, so it marks nothing.
  IF current_setting('worldseed.loading_up', true) = 'on' THEN
    RETURN NEW;
  END IF;
  INSERT INTO cold_changes (tbl, id, seq) VALUES (TG_TABLE_NAME, NEW.id, nextval('cold_change_seq'))
  ON CONFLICT (tbl, id) DO UPDATE SET seq = EXCLUDED.seq;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "documents_marked" AFTER INSERT OR UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION "mark_for_the_record"();
--> statement-breakpoint
CREATE TRIGGER "ledger_rows_marked" AFTER INSERT OR UPDATE ON "ledger_rows" FOR EACH ROW EXECUTE FUNCTION "mark_for_the_record"();
--> statement-breakpoint
CREATE TRIGGER "treasuries_marked" AFTER INSERT OR UPDATE ON "treasuries" FOR EACH ROW EXECUTE FUNCTION "mark_for_the_record"();
--> statement-breakpoint
CREATE TRIGGER "commits_marked" AFTER INSERT OR UPDATE ON "commits" FOR EACH ROW EXECUTE FUNCTION "mark_for_the_record"();
--> statement-breakpoint
INSERT INTO "cold_changes" ("tbl", "id", "seq") SELECT 'documents', "id", nextval('cold_change_seq') FROM "documents";
--> statement-breakpoint
INSERT INTO "cold_changes" ("tbl", "id", "seq") SELECT 'ledger_rows', "id", nextval('cold_change_seq') FROM "ledger_rows";
--> statement-breakpoint
INSERT INTO "cold_changes" ("tbl", "id", "seq") SELECT 'treasuries', "id", nextval('cold_change_seq') FROM "treasuries";
--> statement-breakpoint
INSERT INTO "cold_changes" ("tbl", "id", "seq") SELECT 'commits', "id", nextval('cold_change_seq') FROM "commits";

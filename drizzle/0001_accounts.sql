CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"subject" text,
	"ip_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_canonical" text NOT NULL,
	"code_hash" text NOT NULL,
	"ip_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_canonical" text NOT NULL,
	"avatar" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_canonical" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"verification_level" integer DEFAULT 1 NOT NULL,
	"age_band" text,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'frozen', 'banned')),
	CONSTRAINT "users_verification_level_check" CHECK ("users"."verification_level" >= 1),
	CONSTRAINT "users_age_band_check" CHECK ("users"."age_band" in ('under_18', '18_plus'))
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_event_type_at_idx" ON "audit_log" USING btree ("event_type","at");--> statement-breakpoint
CREATE INDEX "auth_otps_email_created_idx" ON "auth_otps" USING btree ("email_canonical","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_user_id_key" ON "characters" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_name_canonical_key" ON "characters" USING btree ("name_canonical");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_window_key" ON "rate_limits" USING btree ("key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_canonical_key" ON "users" USING btree ("email_canonical");--> statement-breakpoint
-- audit_log is append-only, enforced by the database rather than by convention.
-- UPDATE and DELETE raise, so a compromised application cannot rewrite history.
-- TRUNCATE is deliberately left permitted: the test harness drops and recreates
-- the schema, and a table owner can bypass triggers anyway, which is why a
-- least-privilege role for the app is recorded as a later hardening task.
CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
	BEFORE UPDATE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
	BEFORE DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();--> statement-breakpoint

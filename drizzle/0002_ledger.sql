-- The ledger. Money is created, moved and destroyed only here.
--
-- Every guarantee below is enforced by the database, not by the module that
-- usually writes these tables: a migration, a repair script or a future agent
-- must not be able to leave the ledger unbalanced, rewrite history or edit a
-- balance by hand. The module is the polite way in, not the only way in.

CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"code" text UNIQUE,
	"owner_user_id" uuid UNIQUE,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_kind_check" CHECK ("kind" in ('player', 'system', 'treasury', 'escrow')),
	CONSTRAINT "accounts_owner_or_code_check" CHECK (
		("kind" = 'player' and "owner_user_id" is not null and "code" is null)
		or ("kind" <> 'player' and "owner_user_id" is null and "code" is not null)
	),
	CONSTRAINT "accounts_player_only_freeze_check" CHECK ("frozen_at" is null or "kind" = 'player')
);
--> statement-breakpoint
CREATE TABLE "account_balances" (
	"account_id" uuid PRIMARY KEY NOT NULL REFERENCES "accounts"("id"),
	"balance_kobo" bigint DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"allow_negative" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_balances_overdraft_check" CHECK ("balance_kobo" >= 0 or "allow_negative")
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"request_fingerprint" text NOT NULL,
	"category" text NOT NULL,
	"actor_user_id" uuid,
	"reverses_transaction_id" uuid UNIQUE REFERENCES "ledger_transactions"("id"),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL REFERENCES "ledger_transactions"("id"),
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"amount_kobo" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_non_zero_check" CHECK ("amount_kobo" <> 0)
);
--> statement-breakpoint
CREATE INDEX "ledger_entries_account_id_id_idx" ON "ledger_entries" ("account_id", "id");
--> statement-breakpoint
CREATE INDEX "ledger_transactions_created_at_idx" ON "ledger_transactions" ("created_at");
--> statement-breakpoint
-- Guarantee 1: a transaction balances, and has at least two entries.
--
-- Deferred to commit on purpose: entries are inserted after their transaction, so
-- the check can only be made once everything for this transaction exists. A raw
-- SQL insert that forgets the second entry is rejected as hard as a module bug.
CREATE FUNCTION "ledger_check_transaction_balances"("check_id" uuid) RETURNS void AS $$
DECLARE
	entry_count integer;
	entry_sum numeric;
BEGIN
	SELECT count(*), coalesce(sum("amount_kobo"), 0)
		INTO entry_count, entry_sum
		FROM "ledger_entries"
	 WHERE "transaction_id" = "check_id";

	IF entry_count < 2 THEN
		RAISE EXCEPTION 'ledger transaction % has % entries; at least 2 are required', "check_id", entry_count
			USING ERRCODE = 'check_violation';
	END IF;

	IF entry_sum <> 0 THEN
		RAISE EXCEPTION 'ledger transaction % does not balance: entries sum to % kobo', "check_id", entry_sum
			USING ERRCODE = 'check_violation';
	END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "ledger_transactions_must_balance"() RETURNS trigger AS $$
BEGIN
	PERFORM "ledger_check_transaction_balances"(NEW."id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "ledger_entries_must_balance"() RETURNS trigger AS $$
BEGIN
	PERFORM "ledger_check_transaction_balances"(NEW."transaction_id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_transactions_must_balance"
	AFTER INSERT ON "ledger_transactions"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION "ledger_transactions_must_balance"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_must_balance"
	AFTER INSERT ON "ledger_entries"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION "ledger_entries_must_balance"();
--> statement-breakpoint
-- Guarantee 2: the ledger is append-only. Corrections are compensating entries
-- (D-115, AGENTS.md 3.3), never an edit and never a delete.
CREATE FUNCTION "ledger_reject_change"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION '% on % is not allowed: the ledger is append-only', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ledger_transactions_no_update" BEFORE UPDATE ON "ledger_transactions"
	FOR EACH ROW EXECUTE FUNCTION "ledger_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "ledger_transactions_no_delete" BEFORE DELETE ON "ledger_transactions"
	FOR EACH ROW EXECUTE FUNCTION "ledger_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_update" BEFORE UPDATE ON "ledger_entries"
	FOR EACH ROW EXECUTE FUNCTION "ledger_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_delete" BEFORE DELETE ON "ledger_entries"
	FOR EACH ROW EXECUTE FUNCTION "ledger_reject_change"();
--> statement-breakpoint
-- Guarantee 3: balances are written only while app.ledger_write is 'on', which the
-- module sets with SET LOCAL inside its own transaction. Anything else that edits
-- a balance is refused, so a stray UPDATE cannot invent or destroy money.
-- allow_negative is copied from the account and never changes afterwards.
CREATE FUNCTION "account_balances_guard"() RETURNS trigger AS $$
BEGIN
	IF coalesce(current_setting('app.ledger_write', true), '') <> 'on' THEN
		RAISE EXCEPTION 'account_balances is written only by the ledger module'
			USING ERRCODE = 'insufficient_privilege';
	END IF;

	IF TG_OP = 'UPDATE' AND NEW."allow_negative" <> OLD."allow_negative" THEN
		RAISE EXCEPTION 'account_balances.allow_negative is immutable'
			USING ERRCODE = 'insufficient_privilege';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "account_balances_write_guard" BEFORE INSERT OR UPDATE ON "account_balances"
	FOR EACH ROW EXECUTE FUNCTION "account_balances_guard"();
--> statement-breakpoint
-- The three fixed system accounts, seeded once, looked up by code.
--
-- SYSTEM_MINT is the only account allowed to go negative: it is where new money
-- comes from, so its balance is the total money supply, held as a negative.
-- SYSTEM_BURN is the only place destroyed money goes and never goes negative.
-- TREASURY holds government money.
DO $$
DECLARE
	seeded record;
BEGIN
	PERFORM set_config('app.ledger_write', 'on', true);

	INSERT INTO "accounts" ("kind", "code", "allow_negative")
	VALUES
		('system', 'SYSTEM_MINT', true),
		('system', 'SYSTEM_BURN', false),
		('treasury', 'TREASURY', false)
	ON CONFLICT ("code") DO NOTHING;

	FOR seeded IN SELECT "id", "allow_negative" FROM "accounts" WHERE "code" IS NOT NULL LOOP
		INSERT INTO "account_balances" ("account_id", "allow_negative")
		VALUES (seeded."id", seeded."allow_negative")
		ON CONFLICT ("account_id") DO NOTHING;
	END LOOP;
END;
$$;

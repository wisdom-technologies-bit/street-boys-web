-- Transfers: one player paying another, recorded as a domain row and moved by the ledger.
--
-- The row is the story (who sent what, how much tax, whether it is still pending) and
-- the ledger is the money. They commit together or not at all, which is why the send
-- path opens one database transaction and posts through the ledger's joined-client
-- API rather than posting and recording in two steps.

CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"receiver_user_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"tax_kobo" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"release_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	CONSTRAINT "transfers_status_check" CHECK ("status" in ('completed', 'pending', 'cancelled', 'held')),
	CONSTRAINT "transfers_amount_check" CHECK ("amount_kobo" > 0 and "tax_kobo" >= 0),
	CONSTRAINT "transfers_distinct_users_check" CHECK ("sender_user_id" <> "receiver_user_id")
);
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_receiver_user_id_users_id_fk" FOREIGN KEY ("receiver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- One key per sender, so a retried request finds its own transfer and nobody else's.
CREATE UNIQUE INDEX "transfers_sender_idempotency_key_idx" ON "transfers" ("sender_user_id", "idempotency_key");--> statement-breakpoint
-- The two reads the product makes: a player's sent history and their received history.
CREATE INDEX "transfers_sender_created_at_idx" ON "transfers" ("sender_user_id", "created_at");--> statement-breakpoint
CREATE INDEX "transfers_receiver_created_at_idx" ON "transfers" ("receiver_user_id", "created_at");--> statement-breakpoint
-- The release job's query: everything due, oldest deadline first.
CREATE INDEX "transfers_status_release_at_idx" ON "transfers" ("status", "release_at");--> statement-breakpoint
-- The escrow account that holds a pending transfer's money.
--
-- Seeded the same way the three system accounts were (0002), including its balance
-- row, because a transfer in flight is money that has left the sender and has not
-- reached the receiver: it is held here, not created and not destroyed.
DO $$
DECLARE
	seeded record;
BEGIN
	PERFORM set_config('app.ledger_write', 'on', true);

	INSERT INTO "accounts" ("kind", "code", "allow_negative")
	VALUES ('escrow', 'ESCROW_TRANSFERS', false)
	ON CONFLICT ("code") DO NOTHING;

	FOR seeded IN SELECT "id", "allow_negative" FROM "accounts" WHERE "code" = 'ESCROW_TRANSFERS' LOOP
		INSERT INTO "account_balances" ("account_id", "allow_negative")
		VALUES (seeded."id", seeded."allow_negative")
		ON CONFLICT ("account_id") DO NOTHING;
	END LOOP;
END;
$$;

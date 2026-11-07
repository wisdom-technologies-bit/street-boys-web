-- The insert guard: ledger rows are written only by the ledger module.
--
-- The gate `app.ledger_write` already protects balances. It did not protect the
-- ledger itself: a script could insert a transaction and entries that balance,
-- and the deferred trigger would happily accept it. This closes that door at the
-- same gate the posting function sets with SET LOCAL, so there is one switch, not
-- two, and no way to be inside the module without it being on.
--
-- What this stops: an accidental insert from a migration, a repair script, a
-- dashboard, a future agent that decides to "just add the grant here". What it
-- does not stop: the table owner, who can disable a trigger or set the setting
-- themselves. That is a boundary of Postgres, not of this schema; the answer is a
-- least-privilege role, which is a later task, and every write still leaves a
-- permanent, append-only record that the verifier checks.

CREATE FUNCTION "ledger_insert_guard"() RETURNS trigger AS $$
BEGIN
	IF coalesce(current_setting('app.ledger_write', true), '') <> 'on' THEN
		RAISE EXCEPTION 'ledger rows are written only by the ledger module'
			USING ERRCODE = 'insufficient_privilege';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ledger_transactions_insert_guard" BEFORE INSERT ON "ledger_transactions"
	FOR EACH ROW EXECUTE FUNCTION "ledger_insert_guard"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_insert_guard" BEFORE INSERT ON "ledger_entries"
	FOR EACH ROW EXECUTE FUNCTION "ledger_insert_guard"();

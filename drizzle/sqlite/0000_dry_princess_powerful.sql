CREATE TABLE `commits` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`data` text NOT NULL,
	`embedding` text,
	`doc_type` text,
	`genre` text,
	`owner_cert_uid` text,
	`signature` text,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_namespace_idx` ON `documents` (`namespace`);--> statement-breakpoint
CREATE INDEX `documents_namespace_type_idx` ON `documents` (`namespace`,`doc_type`);--> statement-breakpoint
CREATE INDEX `documents_owner_idx` ON `documents` (`owner_cert_uid`);--> statement-breakpoint
CREATE TABLE `ledger_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`seq` integer NOT NULL,
	`prev_seq` integer NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`signature` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_rows_owner_seq_idx` ON `ledger_rows` (`owner_uid`,`seq`);--> statement-breakpoint
CREATE INDEX `ledger_rows_type_idx` ON `ledger_rows` (`type`);--> statement-breakpoint
CREATE TABLE `treasuries` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`gold` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

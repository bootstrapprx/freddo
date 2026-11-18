CREATE TABLE `action_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bench_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`operation_id` text,
	`provider` text,
	`summary` text,
	`logs` text,
	`created_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `action_logs_owner_idx` ON `action_logs` (`owner_id`);--> statement-breakpoint
CREATE INDEX `action_logs_bench_idx` ON `action_logs` (`bench_id`);--> statement-breakpoint
CREATE TABLE `telemetry_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bench_id` text NOT NULL,
	`node_id` text NOT NULL,
	`cpu_pct` real DEFAULT 0 NOT NULL,
	`ram_pct` real DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'unavailable' NOT NULL,
	`collected_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telemetry_samples_owner_idx` ON `telemetry_samples` (`owner_id`);--> statement-breakpoint
CREATE INDEX `telemetry_samples_bench_collected_idx` ON `telemetry_samples` (`bench_id`,`collected_at`);--> statement-breakpoint
ALTER TABLE `benches` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `benches` ADD `telemetry_source` text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE `deployments` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `logs` text;
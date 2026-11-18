CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `benches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`node_id` text NOT NULL,
	`name` text NOT NULL,
	`port` integer DEFAULT 8080 NOT NULL,
	`domain` text,
	`site_name` text,
	`frappe_version` text,
	`env_tag` text DEFAULT 'dev' NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`cpu_pct` real DEFAULT 0 NOT NULL,
	`ram_pct` real DEFAULT 0 NOT NULL,
	`created_date` text NOT NULL,
	`updated_date` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `benches_node_id_idx` ON `benches` (`node_id`);--> statement-breakpoint
CREATE TABLE `cost_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bench_id` text NOT NULL,
	`node_id` text NOT NULL,
	`date` text NOT NULL,
	`cpu_pct` real DEFAULT 0 NOT NULL,
	`ram_pct` real DEFAULT 0 NOT NULL,
	`allocated_cost` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cost_allocations_date_idx` ON `cost_allocations` (`date`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bench_id` text NOT NULL,
	`bench_name` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`duration_s` real,
	`summary` text,
	`created_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deployments_bench_id_idx` ON `deployments` (`bench_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`ip` text NOT NULL,
	`provider` text,
	`region` text,
	`vcpu` integer DEFAULT 0 NOT NULL,
	`ram_gb` real DEFAULT 0 NOT NULL,
	`monthly_cost` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`ssh_user` text,
	`created_date` text NOT NULL,
	`updated_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`monthly_budget` real DEFAULT 100 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`alert_threshold` real DEFAULT 0.8 NOT NULL,
	`billing_cycle` text DEFAULT 'monthly' NOT NULL,
	`region` text
);
--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`two_factor_enabled` integer DEFAULT false,
	`role` text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
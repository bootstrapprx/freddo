ALTER TABLE `settings` ADD `owner_id` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `settings` SET `owner_id` = 'legacy-' || `id` WHERE `owner_id` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `settings_owner_id_unique` ON `settings` (`owner_id`);
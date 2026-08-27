CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_project_members_user` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner` ON `projects` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `surveys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`quarter` text NOT NULL,
	`imported_by` text NOT NULL,
	`source_file_count` integer DEFAULT 0 NOT NULL,
	`source_object_keys` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_surveys_project_quarter` ON `surveys` (`project_id`,`quarter`);--> statement-breakpoint
CREATE INDEX `idx_surveys_project` ON `surveys` (`project_id`);--> statement-breakpoint
CREATE TABLE `traffic_records` (
	`id` text PRIMARY KEY NOT NULL,
	`survey_id` text NOT NULL,
	`project_id` text NOT NULL,
	`quarter` text NOT NULL,
	`road_id` text NOT NULL,
	`road_name` text NOT NULL,
	`day_type` text NOT NULL,
	`direction_code` text NOT NULL,
	`direction_name` text NOT NULL,
	`hour_interval` text NOT NULL,
	`motorcycle` integer DEFAULT 0 NOT NULL,
	`small_vehicle` integer DEFAULT 0 NOT NULL,
	`large_vehicle` integer DEFAULT 0 NOT NULL,
	`special_vehicle` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`survey_id`) REFERENCES `surveys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_traffic_record_identity` ON `traffic_records` (`survey_id`,`road_id`,`day_type`,`direction_code`,`hour_interval`);--> statement-breakpoint
CREATE INDEX `idx_traffic_filter` ON `traffic_records` (`project_id`,`quarter`,`day_type`);--> statement-breakpoint
CREATE INDEX `idx_traffic_road` ON `traffic_records` (`project_id`,`road_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);
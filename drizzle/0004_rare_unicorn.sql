ALTER TABLE `traffic_records` ADD `source_file_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `traffic_records` ADD `source_sheet_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `traffic_records` ADD `source_row` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `traffic_records` ADD `source_range` text DEFAULT '' NOT NULL;
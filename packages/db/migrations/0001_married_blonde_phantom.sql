CREATE TABLE `barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`variant_id` text NOT NULL,
	`code` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barcodes_store_code_idx` ON `barcodes` (`store_id`,`code`);--> statement-breakpoint
CREATE INDEX `barcodes_variant_idx` ON `barcodes` (`variant_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_store_name_idx` ON `categories` (`store_id`,`name`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`product_id` text NOT NULL,
	`name` text,
	`price_cents` integer,
	`cost_cents` integer,
	`volume_pricing` text,
	`sat_product_key` text,
	`sat_unit_key` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`price_cents` integer NOT NULL,
	`controls_inventory` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_store_idx` ON `products` (`store_id`);
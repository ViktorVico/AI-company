CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_agent" text NOT NULL,
	"to_agent" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"task_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"department" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"description" text NOT NULL,
	"system_prompt" text NOT NULL,
	"input_format" text NOT NULL,
	"output_format" text NOT NULL,
	"model" text NOT NULL,
	"effort" text DEFAULT 'medium' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"current_task_id" uuid,
	"max_iterations" integer DEFAULT 12 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" jsonb,
	"risk" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"task_id" uuid,
	"workflow_run_id" uuid,
	"workflow_node_id" text,
	"decision_note" text,
	"result" jsonb,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"for_date" text NOT NULL,
	"data" jsonb NOT NULL,
	"narrative" text,
	"delivered_via" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"format" text NOT NULL,
	"title" text NOT NULL,
	"hook" text,
	"caption" text,
	"script" text,
	"body" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"production_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"brand_check" jsonb,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_id" text,
	"external_url" text,
	"publish_error" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics_updated_at" timestamp with time zone,
	"created_by_agent" text,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"kind" text DEFAULT 'comment' NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"external_id" text,
	"content_item_id" uuid,
	"sentiment" text,
	"priority" text,
	"is_lead_signal" boolean DEFAULT false NOT NULL,
	"draft_reply" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"agent_id" text,
	"task_id" uuid,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"credentials" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_docs" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"file_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"title" text,
	"email" text,
	"website" text,
	"linkedin" text,
	"source" text,
	"score" integer,
	"score_reason" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"draft_outreach" text,
	"last_contact_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"crm_id" text,
	"created_by_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"agent_id" text,
	"kind" text DEFAULT 'note' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"kind" text DEFAULT 'log' NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"parent_task_id" uuid,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_run_id" uuid,
	"workflow_node_id" text,
	"summary" text,
	"output" text,
	"data" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"quality_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_step_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"task_id" uuid,
	"approval_id" uuid,
	"output" text,
	"branch" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"schedule" text,
	"event_type" text,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_to_idx" ON "agent_messages" USING btree ("to_agent","read_at");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_status_idx" ON "content_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "memories_scope_idx" ON "memories" USING btree ("scope","agent_id");--> statement-breakpoint
CREATE INDEX "task_logs_task_idx" ON "task_logs" USING btree ("task_id","id");--> statement-breakpoint
CREATE INDEX "tasks_agent_idx" ON "tasks" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_run_idx" ON "tasks" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_wf_idx" ON "workflow_runs" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE INDEX "wsr_run_idx" ON "workflow_step_runs" USING btree ("run_id");
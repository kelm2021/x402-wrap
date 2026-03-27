import { index, jsonb, pgTable, text, timestamp, bigserial, integer } from "drizzle-orm/pg-core";

export const endpoints = pgTable("endpoints", {
  id: text("id").primaryKey(),
  originUrl: text("origin_url").notNull(),
  price: text("price").notNull(),
  walletAddress: text("wallet_address").notNull(),
  pathPattern: text("path_pattern").notNull().default("*"),
  encryptedHeaders: jsonb("encrypted_headers"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    requestPath: text("request_path").notNull(),
    method: text("method").notNull(),
    paidAmount: text("paid_amount"),
    statusCode: integer("status_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("usage_endpoint_time_idx").on(table.endpointId, table.createdAt)],
);

export type Endpoint = typeof endpoints.$inferSelect;
export type NewEndpoint = typeof endpoints.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

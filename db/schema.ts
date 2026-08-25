import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_users_email").on(table.email)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    code: text("code").notNull().default(""),
    clientName: text("client_name").notNull().default(""),
    description: text("description").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_projects_owner").on(table.ownerUserId)],
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["viewer", "editor"] })
      .notNull()
      .default("viewer"),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("idx_project_members_user").on(table.userId),
  ],
);

export const surveys = sqliteTable(
  "surveys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    quarter: text("quarter").notNull(),
    importedBy: text("imported_by")
      .notNull()
      .references(() => users.id),
    sourceFileCount: integer("source_file_count").notNull().default(0),
    sourceObjectKeys: text("source_object_keys").notNull().default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_surveys_project_quarter").on(
      table.projectId,
      table.quarter,
    ),
    index("idx_surveys_project").on(table.projectId),
  ],
);

export const trafficRecords = sqliteTable(
  "traffic_records",
  {
    id: text("id").primaryKey(),
    surveyId: text("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    quarter: text("quarter").notNull(),
    roadId: text("road_id").notNull(),
    roadName: text("road_name").notNull(),
    dayType: text("day_type", { enum: ["平日", "假日"] }).notNull(),
    directionCode: text("direction_code").notNull(),
    directionName: text("direction_name").notNull(),
    hourInterval: text("hour_interval").notNull(),
    motorcycle: integer("motorcycle").notNull().default(0),
    smallVehicle: integer("small_vehicle").notNull().default(0),
    largeVehicle: integer("large_vehicle").notNull().default(0),
    specialVehicle: integer("special_vehicle").notNull().default(0),
    surveyType: text("survey_type", { enum: ["road", "intersection"] })
      .notNull()
      .default("road"),
    turnData: text("turn_data").notNull().default(""),
    /**
     * 「往B、往C…」格式保留的各目的地原始車輛數。
     * 沒有存這一欄的話，重新載入後就只剩匯入當下算好的左／直／右三格，
     * 多岔路口的「駛入各支線」會退回舊的單一目的地推法而嚴重失真，
     * 之後在「路口幾何」調整角度也無法重新分類。
     */
    destinationCounts: text("destination_counts").notNull().default(""),
    vehicleCounts: text("vehicle_counts").notNull().default(""),
    vehicleLabels: text("vehicle_labels").notNull().default(""),
    sourceFileName: text("source_file_name").notNull().default(""),
    sourceSheetName: text("source_sheet_name").notNull().default(""),
    sourceRow: integer("source_row").notNull().default(0),
    sourceRange: text("source_range").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_traffic_record_identity").on(
      table.surveyId,
      table.roadId,
      table.dayType,
      table.directionCode,
      table.hourInterval,
    ),
    index("idx_traffic_filter").on(
      table.projectId,
      table.quarter,
      table.dayType,
    ),
    index("idx_traffic_road").on(table.projectId, table.roadId),
  ],
);

export const roadAliases = sqliteTable(
  "road_aliases",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    aliasKey: text("alias_key").notNull(),
    aliasName: text("alias_name").notNull(),
    roadId: text("road_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.aliasKey] }),
    index("idx_road_aliases_road").on(table.projectId, table.roadId),
  ],
);

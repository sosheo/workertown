import {
  type ColumnType,
  type Migrations,
  type Selectable,
  sql,
} from "@workertown/internal-storage";
import { SqliteStorageAdapter as BaseSqliteStorageAdapter } from "@workertown/internal-storage/sqlite";

import { DEFAULT_SORT_FIELD } from "../constants.js";
import {
  type GetDocumentsOptions,
  type SearchDocument,
  type StorageAdapter,
  type UpsertSearchDocumentBody,
} from "./storage-adapter.js";

interface SearchDocumentTable {
  id: string;
  tenant: string;
  index: string;
  data: string;
  created_at: ColumnType<number, number, never>;
  updated_at: ColumnType<number, number, number>;
}

type SearchDocumentRow = Selectable<SearchDocumentTable> & { tags?: string };

interface SearchTagTable {
  tag: string;
  search_document_id: string;
}

export interface DatabaseSchema {
  wt_search_documents: SearchDocumentTable;
  wt_search_tags: SearchTagTable;
}

const MIGRATIONS: Migrations = [
  {
    name: "1688823193041_add_initial_tables_and_indexes",
    migration: {
      async up(db) {
        await db.schema
          .createTable("wt_search_documents")
          .ifNotExists()
          .addColumn("id", "text", (col) => col.notNull())
          .addColumn("tenant", "text", (col) => col.notNull())
          .addColumn("index", "text", (col) => col.notNull())
          .addColumn("data", "text", (col) => col.notNull())
          .addColumn("created_at", "integer", (col) => col.notNull())
          .addColumn("updated_at", "integer", (col) => col.notNull())
          .execute();

        await db.schema
          .createTable("wt_search_tags")
          .ifNotExists()
          .addColumn("tag", "text", (col) => col.notNull())
          .addColumn("search_document_id", "text", (col) => col.notNull())
          .execute();

        await db.schema
          .createIndex("wt_search_documents_id_idx")
          .unique()
          .ifNotExists()
          .on("wt_search_documents")
          .columns(["id"])
          .execute();

        await db.schema
          .createIndex("wt_search_documents_tenant_idx")
          .ifNotExists()
          .on("wt_search_documents")
          .columns(["tenant", DEFAULT_SORT_FIELD, "id"])
          .execute();

        await db.schema
          .createIndex("wt_search_documents_tenant_index_idx")
          .ifNotExists()
          .on("wt_search_documents")
          .columns(["tenant", "index", DEFAULT_SORT_FIELD, "id"])
          .execute();

        await db.schema
          .createIndex("wt_search_tags_unique_idx")
          .unique()
          .ifNotExists()
          .on("wt_search_tags")
          .columns(["tag", "search_document_id"])
          .execute();
      },
      async down(db) {
        await db.schema
          .dropIndex("wt_search_tags_unique_idx")
          .ifExists()
          .execute();

        await db.schema
          .dropIndex("wt_search_documents_tenant_index_idx")
          .ifExists()
          .execute();

        await db.schema
          .dropIndex("wt_search_documents_tenant_idx")
          .ifExists()
          .execute();

        await db.schema
          .dropIndex("wt_search_documents_id_idx")
          .ifExists()
          .execute();

        await db.schema.dropTable("wt_search_tags").ifExists().execute();

        await db.schema.dropTable("wt_search_documents").ifExists().execute();
      },
    },
  },
];

export class SqliteStorageAdapter
  extends BaseSqliteStorageAdapter<DatabaseSchema>
  implements StorageAdapter
{
  public readonly migrations = MIGRATIONS;

  public readonly migrationsPrefix = "wt_search";

  private _formatDocument(document: SearchDocumentRow): SearchDocument {
    return {
      id: document.id,
      tenant: document.tenant,
      index: document.index,
      data: JSON.parse(document.data),
      tags: document.tags ? document.tags.split(",") : [],
      createdAt: new Date(document.created_at),
      updatedAt: new Date(document.updated_at),
    };
  }

  public async getDocuments(
    options: GetDocumentsOptions,
  ): Promise<SearchDocument[]> {
    let query = this.client
      .selectFrom("wt_search_documents")
      .leftJoin("wt_search_tags", "wt_search_tags.search_document_id", "id")
      .where("wt_search_documents.tenant", "=", options.tenant);

    if (options.index) {
      query = query.where("index", "=", options.index);
    }

    const records = await query
      .select([
        "wt_search_documents.id",
        "wt_search_documents.tenant",
        "wt_search_documents.index",
        "wt_search_documents.data",
        "wt_search_documents.created_at",
        "wt_search_documents.updated_at",
        sql<string>`group_concat(wt_search_tags.tag, ',')`.as("tags"),
      ])
      .groupBy("wt_search_documents.id")
      .orderBy("wt_search_documents.updated_at", "desc")
      .limit(options.limit)
      .execute();

    return records.map((record) => this._formatDocument(record));
  }

  public async getDocumentsByTags(
    tags: string[],
    options: GetDocumentsOptions,
  ) {
    let query = this.client
      .selectFrom("wt_search_tags")
      .leftJoin(
        "wt_search_documents",
        "wt_search_tags.search_document_id",
        "wt_search_documents.id",
      )
      .where("wt_search_tags.tag", "in", tags)
      .where("wt_search_documents.tenant", "=", options.tenant);

    if (options?.index) {
      query = query.where("wt_search_documents.index", "=", options.index);
    }

    const records = await query
      .select([
        "wt_search_documents.id",
        "wt_search_documents.tenant",
        "wt_search_documents.index",
        "wt_search_documents.data",
        "wt_search_documents.created_at",
        "wt_search_documents.updated_at",
        sql<string>`group_concat(wt_search_tags.tag, ',')`.as("tags"),
      ])
      .groupBy("wt_search_documents.id")
      .having((eb) => eb.fn.count("wt_search_documents.id"), "=", tags.length)
      .orderBy("wt_search_documents.updated_at", "desc")
      .limit(options.limit)
      .execute();

    return records.map((record) =>
      this._formatDocument(record as SearchDocumentRow),
    );
  }

  public async getDocument(id: string) {
    const result = await this.client
      .selectFrom("wt_search_documents")
      .leftJoin(
        "wt_search_tags",
        "wt_search_tags.search_document_id",
        "wt_search_documents.id",
      )
      .select([
        "wt_search_documents.id",
        "wt_search_documents.tenant",
        "wt_search_documents.index",
        "wt_search_documents.data",
        "wt_search_documents.created_at",
        "wt_search_documents.updated_at",
        sql<string>`group_concat(wt_search_tags.tag, ',')`.as("tags"),
      ])
      .groupBy("wt_search_documents.id")
      .where("id", "=", id)
      .executeTakeFirst();

    if (!result) {
      return null;
    }

    return this._formatDocument(result);
  }

  public async upsertDocument(
    document: UpsertSearchDocumentBody,
    tags: string[] = [],
  ) {
    const now = new Date();
    const existing = await this.client
      .selectFrom("wt_search_documents")
      .select(["id", "created_at"])
      .where("id", "=", document.id)
      .where("tenant", "=", document.tenant)
      .where("index", "=", document.index)
      .executeTakeFirst();

    if (!existing) {
      await this.client
        .insertInto("wt_search_documents")
        .values({
          ...document,
          data: JSON.stringify(document.data),
          created_at: now.getTime(),
          updated_at: now.getTime(),
        })
        .execute();
    } else {
      await this.client
        .updateTable("wt_search_documents")
        .where("id", "=", document.id)
        .set({
          data: JSON.stringify(document.data),
          updated_at: now.getTime(),
        })
        .execute();
    }

    if (tags.length > 0) {
      const existingTags = await this.client
        .selectFrom("wt_search_tags")
        .select("tag")
        .where("search_document_id", "=", document.id)
        .execute();
      const tagSet = new Set(existingTags.map((tag) => tag.tag));
      const tagsToAdd = tags.filter((tag) => !tagSet.has(tag));
      const tagsToRemove = existingTags.filter(
        (existingTag) => !tagSet.has(existingTag.tag),
      );

      if (tagsToAdd.length > 0) {
        await this.client
          .insertInto("wt_search_tags")
          .values(
            tagsToAdd.map((tag) => ({ tag, search_document_id: document.id })),
          )
          .execute();
      }

      if (tagsToRemove.length > 0) {
        await this.client
          .deleteFrom("wt_search_tags")
          .where("search_document_id", "=", document.id)
          .where(
            "tag",
            "in",
            tagsToRemove.map((tag) => tag.tag),
          )
          .execute();
      }
    }

    return {
      ...document,
      tags,
      createdAt: existing?.created_at ? new Date(existing.created_at) : now,
      updatedAt: now,
    };
  }

  public async deleteDocument(id: string) {
    await this.client
      .deleteFrom("wt_search_documents")
      .where("id", "=", id)
      .execute();
    await this.client
      .deleteFrom("wt_search_tags")
      .where("search_document_id", "=", id)
      .execute();
  }

  public async getTags() {
    const tags = await this.client
      .selectFrom("wt_search_tags")
      .select("tag")
      .distinct()
      .execute();

    return tags.map(({ tag }) => tag);
  }
}

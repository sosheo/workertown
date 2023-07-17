import { D1Database } from "@cloudflare/workers-types";
import {
  type ColumnType,
  type Dialect,
  Kysely,
  type MigrationInfo,
  Migrator,
  type Selectable,
} from "kysely";
import { D1Dialect } from "kysely-d1";

import { DEFAULT_SORT_FIELD } from "../constants.js";
import { DefaultMigrationProvider } from "./migrations.js";
import {
  GetDocumentsOptions,
  SearchDocument,
  StorageAdapter,
} from "./storage-adapter.js";

interface SearchDocumentTable {
  id: string;
  tenant: string;
  index: string;
  data: string;
  created_at: ColumnType<Date | number, number, never>;
  updated_at: ColumnType<Date | number, number, number>;
}

type SearchDocumentRow = Selectable<SearchDocumentTable>;

interface SearchTagTable {
  tag: string;
  search_document_id: string;
}

export interface DatabaseSchema {
  search_documents: SearchDocumentTable;
  search_tags: SearchTagTable;
}

const MIGRATIONS: MigrationInfo[] = [
  {
    name: "1688823193041_add_initial_tables_and_indexes",
    migration: {
      async up(db) {
        await db.schema
          .createTable("search_documents")
          .ifNotExists()
          .addColumn("id", "text", (col) => col.notNull())
          .addColumn("tenant", "text", (col) => col.notNull())
          .addColumn("index", "text", (col) => col.notNull())
          .addColumn("data", "text", (col) => col.notNull())
          .addColumn("created_at", "integer", (col) => col.notNull())
          .addColumn("updated_at", "integer", (col) => col.notNull())
          .execute();

        await db.schema
          .createTable("search_tags")
          .ifNotExists()
          .addColumn("tag", "text", (col) => col.notNull())
          .addColumn("search_document_id", "text", (col) => col.notNull())
          .execute();

        await db.schema
          .createIndex("search_documents_id_idx")
          .unique()
          .ifNotExists()
          .on("search_documents")
          .columns(["id"])
          .execute();

        await db.schema
          .createIndex("search_documents_tenant_idx")
          .ifNotExists()
          .on("search_documents")
          .columns(["tenant", DEFAULT_SORT_FIELD, "id"])
          .execute();

        await db.schema
          .createIndex("search_documents_tenant_index_idx")
          .ifNotExists()
          .on("search_documents")
          .columns(["tenant", "index", DEFAULT_SORT_FIELD, "id"])
          .execute();

        await db.schema
          .createIndex("search_tags_unique_idx")
          .unique()
          .ifNotExists()
          .on("search_tags")
          .columns(["tag", "search_document_id"])
          .execute();
      },
      async down(db) {
        await db.schema
          .dropIndex("search_tags_unique_idx")
          .ifExists()
          .execute();

        await db.schema
          .dropIndex("search_documents_tenant_index_idx")
          .ifExists()
          .execute();

        await db.schema
          .dropIndex("search_documents_tenant_idx")
          .ifExists()
          .execute();

        await db.schema
          .dropIndex("search_documents_id_idx")
          .ifExists()
          .execute();

        await db.schema.dropTable("search_tags").ifExists().execute();

        await db.schema.dropTable("search_documents").ifExists().execute();
      },
    },
  },
];

interface D1StorageAdapterOptions {
  db: D1Database;
}

export class D1StorageAdapter extends StorageAdapter {
  private readonly _client: Kysely<DatabaseSchema>;

  constructor(options: D1StorageAdapterOptions) {
    super();

    this._client = new Kysely<DatabaseSchema>({
      // The `as unknown as Dialect` is a workaround for a bug in the kysely-d1
      // types
      dialect: new D1Dialect({ database: options.db }) as unknown as Dialect,
    });
  }

  private _formatDocument(document: SearchDocumentRow): SearchDocument {
    return {
      id: document.id,
      tenant: document.tenant,
      index: document.index,
      data: JSON.parse(document.data),
      createdAt: new Date(document.created_at),
      updatedAt: new Date(document.updated_at),
    };
  }

  async getDocuments(options: GetDocumentsOptions): Promise<SearchDocument[]> {
    let query = this._client
      .selectFrom("search_documents")
      .where("search_documents.tenant", "=", options.tenant);

    if (options.index) {
      query = query.where("index", "=", options.index);
    }

    const records = await query
      .selectAll()
      .orderBy("search_documents.updated_at", "desc")
      .limit(options?.limit)
      .execute();

    return records.map((record) => this._formatDocument(record));
  }

  async getDocumentsByTags(tags: string[], options: GetDocumentsOptions) {
    let query = this._client
      .selectFrom("search_tags")
      .innerJoin(
        "search_documents",
        "search_tags.search_document_id",
        "search_documents.id"
      )
      .where("search_tags.tag", "in", tags)
      .where("search_documents.tenant", "=", options.tenant);

    if (options?.index) {
      query = query.where("search_documents.index", "=", options.index);
    }

    const records = await query
      .selectAll("search_documents")
      .groupBy("search_documents.id")
      .having((eb) => eb.fn.count("search_documents.id"), "=", tags.length)
      .orderBy("search_documents.updated_at", "desc")
      .limit(options?.limit)
      .execute();

    return records.map((record) => this._formatDocument(record));
  }

  async getDocument(id: string) {
    const result = await this._client
      .selectFrom("search_documents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!result) {
      return null;
    }

    return this._formatDocument(result);
  }

  async indexDocument(
    document: Pick<SearchDocument, "id" | "tenant" | "index" | "data">,
    tags: string[] = []
  ) {
    const now = new Date();
    const existing = await this._client
      .selectFrom("search_documents")
      .select(["id", "created_at"])
      .where("id", "=", document.id)
      .where("tenant", "=", document.tenant)
      .where("index", "=", document.index)
      .executeTakeFirst();

    if (!existing) {
      await this._client
        .insertInto("search_documents")
        .values({
          ...document,
          data: JSON.stringify(document.data),
          created_at: now.getTime(),
          updated_at: now.getTime(),
        })
        .execute();
    } else {
      await this._client
        .updateTable("search_documents")
        .where("id", "=", document.id)
        .where("tenant", "=", document.tenant)
        .where("index", "=", document.index)
        .set({
          data: JSON.stringify(document.data),
          updated_at: now.getTime(),
        })
        .execute();
    }

    if (tags.length > 0) {
      const existingTags = await this._client
        .selectFrom("search_tags")
        .selectAll()
        .where("search_document_id", "=", document.id)
        .execute();
      const tagsToAdd = tags.filter(
        (tag) =>
          existingTags.find((existingTag) => existingTag.tag === tag) ===
          undefined
      );
      const tagsToRemove = existingTags.filter(
        (existingTag) =>
          tags.find((tag) => tag === existingTag.tag) === undefined
      );

      if (tagsToAdd.length > 0) {
        await this._client
          .insertInto("search_tags")
          .values(
            tagsToAdd.map((tag) => ({ tag, search_document_id: document.id }))
          )
          .execute();
      }

      if (tagsToRemove.length > 0) {
        await this._client
          .deleteFrom("search_tags")
          .where("search_document_id", "=", document.id)
          .where(
            "tag",
            "in",
            tagsToRemove.map((tag) => tag.tag)
          )
          .execute();
      }
    }

    return {
      ...document,
      createdAt: existing?.created_at ? new Date(existing.created_at) : now,
      updatedAt: now,
    };
  }

  async deleteDocument(id: string) {
    await this._client
      .deleteFrom("search_documents")
      .where("id", "=", id)
      .execute();
    await this._client
      .deleteFrom("search_tags")
      .where("search_document_id", "=", id)
      .execute();
  }

  async getTags() {
    const tags = await this._client
      .selectFrom("search_tags")
      .select("tag")
      .distinct()
      .execute();

    return tags.map(({ tag }) => tag);
  }

  async tagDocument(id: string, tag: string) {
    await this._client
      .insertInto("search_tags")
      .onConflict((oc) => oc.columns(["search_document_id", "tag"]).doNothing())
      .values({ search_document_id: id, tag })
      .execute();
  }

  async untagDocument(id: string, tag: string) {
    await this._client
      .deleteFrom("search_tags")
      .where("search_document_id", "=", id)
      .where("tag", "=", tag)
      .execute();
  }

  async runMigrations() {
    const migrator = new Migrator({
      db: this._client,
      provider: new DefaultMigrationProvider(MIGRATIONS),
    });

    await migrator.migrateToLatest();
  }
}

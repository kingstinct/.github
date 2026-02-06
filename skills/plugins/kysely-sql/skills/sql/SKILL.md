---
description: SQL database access using Kysely query builder with platform-specific drivers
---

# SQL Database Guidelines

Use **Kysely** as the type-safe SQL query builder for all database operations. Choose the appropriate driver based on the project type.

## Expo Projects (React Native)

Use `expo-sqlite` with `kysely-expo`:

```bash
npx expo install expo-sqlite
bun add kysely kysely-expo
```

Setup:

```typescript
import * as SQLite from 'expo-sqlite';
import { Kysely } from 'kysely';
import { ExpoDialect } from 'kysely-expo';

const db = new Kysely<Database>({
  dialect: new ExpoDialect({
    database: SQLite.openDatabaseSync('app.db'),
  }),
});

// Always set busy timeout to prevent locked database errors
await db.executeQuery(sql`pragma busy_timeout = 5000;`.compile(db));
```

Reference: https://docs.expo.dev/versions/latest/sdk/sqlite/

## Bun Backend Projects

Use Bun's built-in SQLite with `kysely-bun-sqlite`:

```bash
bun add kysely kysely-bun-sqlite
```

Setup:

```typescript
import { Kysely } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import { Database } from 'bun:sqlite';

const db = new Kysely<Database>({
  dialect: new BunSqliteDialect({
    database: new Database('app.db'),
  }),
});

// Always set busy timeout to prevent locked database errors
await db.executeQuery(sql`pragma busy_timeout = 5000;`.compile(db));
```

Reference: https://bun.sh/docs/api/sqlite

## Critical: Busy Timeout

**Always run this pragma immediately after creating the database connection:**

```typescript
import { sql } from 'kysely';

await db.executeQuery(sql`pragma busy_timeout = 5000;`.compile(db));
```

This prevents "database is locked" errors when multiple operations try to access the database simultaneously. The timeout (5000ms = 5 seconds) tells SQLite to wait and retry instead of immediately failing.

## Kysely Best Practices

### Type-Safe Schema Definition

```typescript
interface Database {
  users: {
    id: string;
    email: string;
    name: string;
    created_at: string;
  };
  posts: {
    id: string;
    user_id: string;
    title: string;
    content: string;
    created_at: string;
  };
}
```

### Migrations

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').execute();
}
```

### Query Examples

```typescript
// Insert
const user = await db
  .insertInto('users')
  .values({ id: crypto.randomUUID(), email: 'user@example.com', name: 'John' })
  .returningAll()
  .executeTakeFirst();

// Select with join
const posts = await db
  .selectFrom('posts')
  .innerJoin('users', 'users.id', 'posts.user_id')
  .select(['posts.id', 'posts.title', 'users.name as author'])
  .where('users.id', '=', userId)
  .execute();

// Update
await db
  .updateTable('users')
  .set({ name: 'Jane' })
  .where('id', '=', userId)
  .execute();

// Delete
await db
  .deleteFrom('posts')
  .where('id', '=', postId)
  .execute();

// Transaction
await db.transaction().execute(async (trx) => {
  await trx.insertInto('users').values(user).execute();
  await trx.insertInto('posts').values(post).execute();
});
```

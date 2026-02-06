---
description: TypeScript best practices for type safety and ergonomic code
---

# TypeScript Guidelines

Write type-safe, ergonomic TypeScript. Prioritize correctness and developer experience.

## TSConfig Requirements

Always ensure these compiler options are enabled:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "strictNullChecks": true
  }
}
```

## Core Principles

### Avoid `any`

Everything should be typed. If you need escape hatches:

```typescript
// Bad
const data: any = fetchData();

// Better - use unknown and narrow
const data: unknown = fetchData();
if (isUser(data)) {
  console.log(data.name);
}

// Or use generics
function fetchData<T>(): T { ... }
```

### Prefer Existing Types

Reuse types from libraries and codebase. Use `Pick`/`Omit` for ergonomics:

```typescript
// Bad - duplicating types
interface CreateUserInput {
  name: string;
  email: string;
}

// Good - derive from existing
type CreateUserInput = Pick<User, 'name' | 'email'>;

// Good - omit what you don't need
type UserWithoutId = Omit<User, 'id' | 'createdAt'>;

// Good - for function params
function updateUser(id: string, data: Partial<Pick<User, 'name' | 'email'>>) { ... }
```

### Prefer Interfaces Over Types

```typescript
// Preferred
interface User {
  id: string;
  name: string;
}

// Use type for unions, intersections, mapped types
type Status = 'pending' | 'active' | 'inactive';
type UserWithRole = User & { role: Role };
```

### Let TypeScript Infer When Trivial

```typescript
// Unnecessary - TypeScript infers this
const name: string = 'John';
const count: number = 0;
const users: User[] = [];

// Better - let inference work
const name = 'John';
const count = 0;
const users: User[] = []; // Keep when empty array needs type
```

### Avoid Type Casting When Possible

```typescript
// Bad - casting
const user = data as User;

// Better - use generics
const user = fetchData<User>();

// Better - type the variable
const user: User = { id: '1', name: 'John' };

// Better - use type guards
if (isUser(data)) {
  // data is User here
}
```

### Pragmatic Typing for Isolated Scopes

When a type is complex and isolated, focus on input/output ergonomics:

```typescript
// Input and output are well-typed, internal casting is acceptable
function transformData(input: RawData): ProcessedData {
  const intermediate = input.items.map(item => {
    // Complex transformation - casting ok here if isolated
    return processItem(item) as ProcessedItem;
  });
  return { items: intermediate };
}
```

## Type Narrowing

Use TypeScript's narrowing capabilities. Reference: https://www.typescriptlang.org/docs/handbook/2/narrowing.html

### Discriminated Unions

```typescript
interface LoadingState {
  status: 'loading';
}

interface SuccessState {
  status: 'success';
  data: User[];
}

interface ErrorState {
  status: 'error';
  error: Error;
}

type State = LoadingState | SuccessState | ErrorState;

function render(state: State) {
  switch (state.status) {
    case 'loading':
      return <Spinner />;
    case 'success':
      return <UserList users={state.data} />;
    case 'error':
      return <Error message={state.error.message} />;
  }
}
```

### instanceof

```typescript
function handleError(error: unknown) {
  if (error instanceof ValidationError) {
    return { field: error.field, message: error.message };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: 'Unknown error' };
}
```

### in Operator

```typescript
interface Dog { bark(): void; }
interface Cat { meow(): void; }

function speak(animal: Dog | Cat) {
  if ('bark' in animal) {
    animal.bark();
  } else {
    animal.meow();
  }
}
```

### Type Predicates

Essential for filter functions:

```typescript
// Type predicate
function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

// Usage with filter
const users: (User | null)[] = [...];
const validUsers: User[] = users.filter(isNonNull);

// Without predicate, TypeScript doesn't narrow
const broken = users.filter(u => u != null); // Still (User | null)[]
```

## Functional Programming

Prefer functional patterns:

```typescript
// Bad - imperative loop
const results: string[] = [];
for (const user of users) {
  if (user.active) {
    results.push(user.name);
  }
}

// Good - functional
const results = users
  .filter(user => user.active)
  .map(user => user.name);

// Good - with type predicate
const activeNames = users
  .filter((user): user is ActiveUser => user.active)
  .map(user => user.name);
```

## Task Completion Requirements

**A task is NOT complete until all type errors are resolved in modified files.**

Before marking any task as done:

1. Run `bun run typecheck` (or `tsc --noEmit`)
2. Fix ALL type errors in files you modified
3. Verify the typecheck passes cleanly

If the typecheck hook reports errors after your edits, you must fix them before proceeding to the next task.

## Quick Reference

| Do | Don't |
|----|-------|
| `interface User` | `type User = { ... }` (for objects) |
| `Pick<User, 'name'>` | Duplicate type definitions |
| `const x = 5` | `const x: number = 5` |
| `fetchData<User>()` | `fetchData() as User` |
| `.filter(isNonNull)` | `.filter(x => x != null)` without predicate |
| `.map().filter()` | `for` loops for transformations |

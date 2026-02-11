---
description: React best practices for hooks, components, and performance
---

# React Guidelines

Write maintainable, performant React code. Prioritize simplicity and single responsibility.

> **First:** Check if React Compiler is enabled (`babel-plugin-react-compiler` in package.json). If enabled, skip all manual memoization (`memo`, `useMemo`, `useCallback`).

## Keep Logic Outside React

### Move Non-React Code Out of Components

Constants, pure functions, and business logic don't need to live inside React components or hooks. Keep them outside for better performance, testability, and reusability.

```typescript
// Bad - constants recreated or needlessly inside component
function UserList() {
  const PAGE_SIZE = 20;
  const statusLabels = { active: 'Active', inactive: 'Inactive' };

  const formatDate = (date: Date) => date.toLocaleDateString();

  return ...;
}

// Good - outside React entirely
const PAGE_SIZE = 20;
const STATUS_LABELS = { active: 'Active', inactive: 'Inactive' } as const;

function formatDate(date: Date) {
  return date.toLocaleDateString();
}

function UserList() {
  // Component only contains React-specific logic
  return ...;
}
```

### Business Logic Belongs Outside React

```typescript
// Bad - business logic buried in component
function PricingCard({ product }: { product: Product }) {
  const calculateDiscount = () => {
    if (product.quantity > 100) return 0.2;
    if (product.quantity > 50) return 0.1;
    return 0;
  };

  const finalPrice = product.price * (1 - calculateDiscount());
  return <div>${finalPrice}</div>;
}

// Good - pure function, testable, reusable
function calculateDiscount(quantity: number): number {
  if (quantity > 100) return 0.2;
  if (quantity > 50) return 0.1;
  return 0;
}

function calculateFinalPrice(product: Product): number {
  return product.price * (1 - calculateDiscount(product.quantity));
}

function PricingCard({ product }: { product: Product }) {
  return <div>${calculateFinalPrice(product)}</div>;
}
```

### Prefer External State Libraries Over React Context

If the project has a state management library (Zustand, Jotai, Legend State, Redux, etc.), use it for shared state instead of React Context. External stores:

- Don't cause unnecessary re-renders
- Work outside React (API layers, utilities)
- Are easier to test and debug

```typescript
// Avoid - Context for frequently updating state
const CartContext = createContext<CartState | null>(null);

function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be within CartProvider');
  return context;
}

// Prefer - External store (example with Zustand)
import { create } from 'zustand';

const useCartStore = create<CartState>((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  removeItem: (id) => set((state) => ({ items: state.items.filter(i => i.id !== id) })),
  total: 0,
}));

// Can be used anywhere - components, utilities, API handlers
function addToCart(item: CartItem) {
  useCartStore.getState().addItem(item);
}

// Components subscribe to only what they need
function CartCount() {
  const count = useCartStore((state) => state.items.length);
  return <span>{count}</span>;
}
```

**Use React Context for:**
- Dependency injection (theme, i18n, feature flags)
- Values that rarely change
- When you don't have an external state library

**Use external state libraries for:**
- Frequently updating state
- State accessed by many components
- State needed outside React components
- Complex state logic

## Hook Design Principles

### Keep Hooks Lean

Hooks should do ONE thing and return 1-3 values. If a hook does more, split it.

```typescript
// Bad - hook does too much
function useUser(id: string) {
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // ... fetches user, posts, comments, handles errors

  return { user, posts, comments, loading, error, refetch, updateUser };
}

// Good - separate concerns
function useUser(id: string) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(id).then(setUser).finally(() => setLoading(false));
  }, [id]);

  return { user, loading };
}

function useUserPosts(userId: string) {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    fetchPosts(userId).then(setPosts);
  }, [userId]);

  return posts;
}
```

### Return Value Guidelines

| Return Count | Use Case |
|-------------|----------|
| 1 value | Simple derived state, fetched data |
| 2 values | Data + loading, value + setter |
| 3 values | Data + loading + error (max recommended) |
| 4+ values | Split into multiple hooks |

```typescript
// Good - returns 1 value
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return width;
}

// Good - returns 2 values (tuple)
function useToggle(initial = false) {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue(v => !v), []);

  return [value, toggle] as const;
}

// Good - returns 3 values (object for clarity)
function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(url)
      .then(res => res.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [url]);

  return { data, loading, error };
}
```

### Composition Over Complexity

Build complex behavior from simple hooks:

```typescript
// Compose simple hooks
function useUserDashboard(userId: string) {
  const { user, loading: userLoading } = useUser(userId);
  const posts = useUserPosts(userId);
  const { notifications } = useNotifications(userId);

  return {
    user,
    posts,
    notifications,
    loading: userLoading,
  };
}
```

## Component Patterns

### Keep Components Small

Smaller components are always better for:
- **Performance** - Smaller components re-render less when state changes
- **Memoization** - React Compiler and `memo()` work better with focused components
- **Readability** - Easier to understand and maintain

```typescript
// Bad - large component with multiple concerns
function UserDashboard({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // ... lots of logic, effects, handlers

  return (
    <div>
      {/* 200 lines of JSX */}
    </div>
  );
}

// Good - split into focused components
function UserDashboard({ userId }: { userId: string }) {
  return (
    <div>
      <UserHeader userId={userId} />
      <UserPosts userId={userId} />
      <UserActivity userId={userId} />
    </div>
  );
}

function UserHeader({ userId }: { userId: string }) {
  const { user } = useUser(userId);
  return <header>{user?.name}</header>;
}

function UserPosts({ userId }: { userId: string }) {
  const posts = useUserPosts(userId);
  return <PostList posts={posts} />;
}
```

When a component grows beyond ~100 lines or handles multiple concerns, split it.

### Prefer Function Components

```typescript
// Good
function UserCard({ user }: { user: User }) {
  return (
    <div>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  );
}

// Good - with memo for expensive renders (skip if React Compiler is enabled)
const UserList = memo(function UserList({ users }: { users: User[] }) {
  return (
    <ul>
      {users.map(user => (
        <UserCard key={user.id} user={user} />
      ))}
    </ul>
  );
});
```

### Props Interface Naming

```typescript
// Good - Props suffix
interface UserCardProps {
  user: User;
  onSelect?: (user: User) => void;
}

function UserCard({ user, onSelect }: UserCardProps) {
  // ...
}
```

### Avoid Inline Object/Array Props

```typescript
// Bad - creates new reference every render
<UserList filters={{ active: true }} />
<TagList tags={['react', 'typescript']} />

// Good - stable reference
const filters = useMemo(() => ({ active: true }), []);
<UserList filters={filters} />

// Good - define outside component if static
const defaultTags = ['react', 'typescript'];
<TagList tags={defaultTags} />
```

## State Management

### Colocate State

Keep state as close as possible to where it's used:

```typescript
// Bad - lifting state unnecessarily
function App() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div>
      <Header />
      <SearchBar query={searchQuery} onQueryChange={setSearchQuery} />
      <Results query={searchQuery} />
    </div>
  );
}

// Good - if only SearchBar needs the input state
function SearchBar({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState('');

  return (
    <input
      value={query}
      onChange={e => setQuery(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onSearch(query)}
    />
  );
}
```

### Derive State When Possible

```typescript
// Bad - redundant state
const [items, setItems] = useState<Item[]>([]);
const [itemCount, setItemCount] = useState(0);

useEffect(() => {
  setItemCount(items.length);
}, [items]);

// Good - derive from existing state
const [items, setItems] = useState<Item[]>([]);
const itemCount = items.length;

// Good - memoize expensive derivations
const expensiveValue = useMemo(() =>
  items.filter(complexFilter).map(complexTransform),
  [items]
);
```

## Performance

### Check for React Compiler

Before applying manual memoization, check if the project uses React Compiler (React 19+):

```bash
# Check for babel-plugin-react-compiler or react-compiler in dependencies
grep -E "react-compiler|babel-plugin-react-compiler" package.json
```

**If React Compiler is enabled:**
- Skip `memo()`, `useMemo()`, `useCallback()` - the compiler handles this automatically
- Write simple, straightforward code without manual optimization
- The compiler analyzes and memoizes automatically

**If React Compiler is NOT enabled:**
- Apply manual memoization where beneficial (see below)
- Use `memo()` for expensive components
- Use `useMemo()`/`useCallback()` for expensive computations and stable references

### Use useCallback for Event Handlers Passed to Children

> Skip this if React Compiler is enabled

```typescript
// Good - stable reference for child optimization
function Parent() {
  const handleClick = useCallback((id: string) => {
    // handle click
  }, []);

  return <Child onClick={handleClick} />;
}

// Skip useCallback for handlers used only in this component
function Simple() {
  const handleClick = () => {
    // handle click
  };

  return <button onClick={handleClick}>Click</button>;
}
```

### Avoid Premature Optimization

> With React Compiler, skip manual memoization entirely

Only add `memo`, `useMemo`, `useCallback` when:
- React Compiler is NOT enabled in the project
- You've measured a performance problem
- Component re-renders are expensive
- Props are passed to memoized children

## Error Boundaries

Use error boundaries to catch rendering errors and show fallback UI:

```typescript
// Use react-error-boundary or create your own
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

// Wrap sections that might fail
<ErrorBoundary FallbackComponent={ErrorFallback}>
  <UserProfile userId={id} />
</ErrorBoundary>
```

**When to use:**
- Around route-level components
- Around third-party components
- Around components that fetch data
- NOT around event handlers (use try/catch there)

## Keys

### Use Stable, Unique Keys

```typescript
// Bad - index as key (causes bugs with reordering, filtering)
{items.map((item, index) => (
  <Item key={index} data={item} />
))}

// Bad - non-unique keys
{items.map(item => (
  <Item key={item.category} data={item} />
))}

// Good - unique identifier
{items.map(item => (
  <Item key={item.id} data={item} />
))}

// Good - composite key when no single unique field
{items.map(item => (
  <Item key={`${item.category}-${item.name}`} data={item} />
))}
```

Index as key is only safe when:
- List is static (never reordered or filtered)
- Items have no state or controlled inputs
- Items are never added/removed from the middle

## Controlled vs Uncontrolled Inputs

### Controlled - React owns the state

```typescript
// Good for: validation, formatting, conditional logic
function ControlledInput() {
  const [value, setValue] = useState('');

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Can validate, format, or conditionally update
    const newValue = e.target.value.toUpperCase();
    setValue(newValue);
  };

  return <input value={value} onChange={handleChange} />;
}
```

### Uncontrolled - DOM owns the state

```typescript
// Good for: simple forms, file inputs, integration with non-React code
function UncontrolledInput() {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    console.log(inputRef.current?.value);
  };

  return <input ref={inputRef} defaultValue="initial" />;
}
```

**Prefer controlled** unless you have a specific reason for uncontrolled.

## useEffect Cleanup

### Always clean up subscriptions and async operations

```typescript
// Good - cleanup subscription
useEffect(() => {
  const subscription = eventEmitter.subscribe(handler);
  return () => subscription.unsubscribe();
}, []);

// Good - cleanup timer
useEffect(() => {
  const timer = setTimeout(doSomething, 1000);
  return () => clearTimeout(timer);
}, []);

// Good - abort fetch on unmount or dependency change
useEffect(() => {
  const controller = new AbortController();

  fetch(url, { signal: controller.signal })
    .then(res => res.json())
    .then(setData)
    .catch(err => {
      if (err.name !== 'AbortError') {
        setError(err);
      }
    });

  return () => controller.abort();
}, [url]);

// Good - prevent state updates after unmount
useEffect(() => {
  let cancelled = false;

  fetchData().then(data => {
    if (!cancelled) {
      setData(data);
    }
  });

  return () => { cancelled = true; };
}, []);
```

## Context

### When to Use Context

- Theme, locale, auth state (app-wide, rarely changes)
- Avoiding prop drilling through many levels
- NOT for frequently updating state (causes re-renders)

### Split Contexts by Update Frequency

```typescript
// Bad - one context for everything
const AppContext = createContext({ user: null, theme: 'light', notifications: [] });

// Good - separate contexts
const UserContext = createContext<User | null>(null);
const ThemeContext = createContext<'light' | 'dark'>('light');
const NotificationsContext = createContext<Notification[]>([]);

// Components only re-render when their specific context changes
```

### Separate State and Dispatch

```typescript
// Good - consumers of dispatch don't re-render on state changes
const StateContext = createContext<State>(initialState);
const DispatchContext = createContext<Dispatch<Action>>(() => {});

function Provider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}
```

## Refs

### Valid Use Cases

```typescript
// Good - DOM access
const inputRef = useRef<HTMLInputElement>(null);
const focusInput = () => inputRef.current?.focus();

// Good - mutable value that shouldn't trigger re-render
const renderCount = useRef(0);
useEffect(() => { renderCount.current++; });

// Good - previous value
const prevValue = useRef(value);
useEffect(() => { prevValue.current = value; }, [value]);

// Good - interval/timeout IDs
const intervalRef = useRef<number>();
```

### Invalid Use Cases

```typescript
// Bad - using ref for state that should trigger re-render
const countRef = useRef(0);
const increment = () => { countRef.current++; }; // UI won't update!

// Good - use state instead
const [count, setCount] = useState(0);
const increment = () => setCount(c => c + 1);
```

## Suspense and Lazy Loading

### Lazy Load Routes and Heavy Components

```typescript
import { lazy, Suspense } from 'react';

// Lazy load route components
const Dashboard = lazy(() => import('./Dashboard'));
const Settings = lazy(() => import('./Settings'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}

// Lazy load heavy components
const HeavyChart = lazy(() => import('./HeavyChart'));

function Analytics() {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <HeavyChart data={data} />
    </Suspense>
  );
}
```

## Event Handler Naming

### Consistent Convention

```typescript
// Props: onX (what happened)
// Handlers: handleX (how to respond)

interface ButtonProps {
  onClick?: () => void;       // on + event
  onHover?: () => void;
  onSubmit?: (data: FormData) => void;
}

function Form({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const handleSubmit = (e: FormEvent) => {    // handle + event
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit(data);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    // ...
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

## Children Patterns

### Compound Components

```typescript
// Good - flexible, composable API
<Select value={selected} onChange={setSelected}>
  <Select.Trigger>Choose option</Select.Trigger>
  <Select.Options>
    <Select.Option value="a">Option A</Select.Option>
    <Select.Option value="b">Option B</Select.Option>
  </Select.Options>
</Select>

// Implementation using context
const SelectContext = createContext<SelectContextValue | null>(null);

function Select({ children, value, onChange }: SelectProps) {
  const [open, setOpen] = useState(false);

  return (
    <SelectContext.Provider value={{ value, onChange, open, setOpen }}>
      <div className="select">{children}</div>
    </SelectContext.Provider>
  );
}

Select.Trigger = function Trigger({ children }: { children: ReactNode }) {
  const ctx = useContext(SelectContext)!;
  return <button onClick={() => ctx.setOpen(o => !o)}>{children}</button>;
};
```

### Render Props (when needed)

```typescript
// Good - when child needs parent's internal state
<MouseTracker>
  {({ x, y }) => (
    <div>Mouse at: {x}, {y}</div>
  )}
</MouseTracker>

function MouseTracker({ children }: { children: (pos: { x: number; y: number }) => ReactNode }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => setPosition({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  return <>{children(position)}</>;
}
```

## Form Handling

### Controlled Forms with Validation

```typescript
function ContactForm({ onSubmit }: { onSubmit: (data: ContactData) => void }) {
  const [values, setValues] = useState({ name: '', email: '' });
  const [errors, setErrors] = useState<Partial<ContactData>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = (name: string, value: string) => {
    if (name === 'email' && !value.includes('@')) {
      return 'Invalid email';
    }
    if (name === 'name' && value.length < 2) {
      return 'Name too short';
    }
    return undefined;
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setValues(v => ({ ...v, [name]: value }));

    // Validate on change after first blur
    if (touched[name]) {
      setErrors(err => ({ ...err, [name]: validate(name, value) }));
    }
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTouched(t => ({ ...t, [name]: true }));
    setErrors(err => ({ ...err, [name]: validate(name, value) }));
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        name="name"
        value={values.name}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {touched.name && errors.name && <span>{errors.name}</span>}
    </form>
  );
}
```

## Conditional Rendering

### Prefer Early Returns

```typescript
// Bad - deeply nested ternaries
function UserProfile({ user, loading, error }: Props) {
  return (
    <div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Error message={error.message} />
      ) : user ? (
        <Profile user={user} />
      ) : (
        <NotFound />
      )}
    </div>
  );
}

// Good - early returns
function UserProfile({ user, loading, error }: Props) {
  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;
  if (!user) return <NotFound />;

  return <Profile user={user} />;
}
```

### Boolean Gotcha

```typescript
// Bad - renders "0" when count is 0
{count && <Badge count={count} />}

// Good - explicit boolean check
{count > 0 && <Badge count={count} />}

// Good - ternary
{count ? <Badge count={count} /> : null}
```

## Fragments

```typescript
// Good - short syntax when no key needed
function List() {
  return (
    <>
      <Header />
      <Content />
      <Footer />
    </>
  );
}

// Good - explicit Fragment when key is needed
function ItemList({ items }: { items: Item[] }) {
  return items.map(item => (
    <Fragment key={item.id}>
      <dt>{item.term}</dt>
      <dd>{item.definition}</dd>
    </Fragment>
  ));
}
```

## Custom Hook Naming

Always prefix with `use`:

```typescript
// Good
function useWindowSize() { ... }
function useLocalStorage<T>(key: string) { ... }
function useDebounce<T>(value: T, delay: number) { ... }

// Bad - not recognized as hook, rules of hooks won't apply
function getWindowSize() { ... }
function createLocalStorage<T>(key: string) { ... }
```

## Quick Reference

| Do | Don't |
|----|-------|
| Keep components small and focused | Large components with multiple concerns |
| Check for React Compiler first | Manually memoize when compiler handles it |
| Constants/functions outside components | Recreate inside components |
| External state library for shared state | React Context for everything |
| Return 1-3 values from hooks | Return 4+ values from a single hook |
| Split hooks by concern | Create "god" hooks that do everything |
| Colocate state | Lift state unnecessarily |
| Derive state | Sync state with useEffect |
| `memo()` expensive components (no compiler) | `memo()` everything |
| Stable references for child props (no compiler) | Inline objects/arrays as props |
| `useCallback` for handlers to children (no compiler) | `useCallback` for local handlers |
| Stable, unique keys (IDs) | Index as key for dynamic lists |
| Clean up effects | Leave subscriptions/timers dangling |
| Split contexts by update frequency | One giant context for everything |
| Early returns for conditions | Deeply nested ternaries |
| `use` prefix for custom hooks | Non-`use` prefixed hooks |
| Error boundaries around risky UI | try/catch in render |
| Lazy load routes/heavy components | Bundle everything upfront |

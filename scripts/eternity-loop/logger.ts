function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
}

export function log(...args: unknown[]): void {
  console.log(timestamp(), ...args);
}

export function logErr(...args: unknown[]): void {
  console.error(timestamp(), ...args);
}

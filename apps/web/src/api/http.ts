import { reactive } from 'vue';
export const notices = reactive<{ id: number; text: string; tone: string }[]>([]);
let nextNotice = 0;
export function notify(text: string, tone = 'success') {
  const id = ++nextNotice;
  notices.push({ id, text, tone });
  setTimeout(() => {
    const index = notices.findIndex((n) => n.id === id);
    if (index >= 0) notices.splice(index, 1);
  }, 5000);
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body.error?.message || '请求失败');
  return body;
}
export const api = {
  get: <T>(url: string) =>
    request<{ data: T; total?: number; page?: number; page_size?: number }>(url),
  post: <T>(url: string, body: unknown = {}) =>
    request<{ data: T }>(url, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: <T>(url: string, body: unknown) =>
    request<{ data: T }>(url, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (url: string) => request<{ data: boolean }>(url, { method: 'DELETE' }),
};
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  notify('已复制');
}
